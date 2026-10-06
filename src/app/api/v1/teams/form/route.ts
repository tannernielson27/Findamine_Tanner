import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { formationMethodFor, latestPerUser, liveTeams } from "../team-rules";

type FormationStrategy = "random" | "teacher_assigned" | "personality_similar" |
  "personality_diverse" | "performance_similar" | "performance_diverse" | "balanced";

const VALID_STRATEGIES: FormationStrategy[] = [
  "random", "teacher_assigned", "personality_similar", "personality_diverse",
  "performance_similar", "performance_diverse", "balanced",
];

/**
 * Form teams from a roster for a specific hunt.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    requireRole(user, "teacher", "hunt_creator", "admin", "researcher");

    const body = await request.json();
    const { hunt_id, roster_id, strategy, team_size = 4, assignments } = body;

    if (!hunt_id) throw new ApiError(400, "hunt_id required");
    if (!roster_id && strategy !== "teacher_assigned") throw new ApiError(400, "roster_id required");
    if (!VALID_STRATEGIES.includes(strategy)) throw new ApiError(400, `Invalid strategy. Valid: ${VALID_STRATEGIES.join(", ")}`);

    const teamSizeClamped = Math.max(2, Math.min(10, parseInt(team_size) || 4));
    const supabase = await createSupabaseServiceClient();

    // Verify hunt exists and user owns it
    const { data: hunt } = await supabase
      .from("hunts")
      .select("id, created_by")
      .eq("id", hunt_id)
      .single();

    if (!hunt) throw new ApiError(404, "Hunt not found");
    if (hunt.created_by !== user.id && !["admin", "researcher"].includes(user.role)) {
      throw new ApiError(403, "You can only form teams for your own hunts");
    }

    // A player may be on only one team per hunt, so forming again must not
    // stack a second set of teams on top of the first. Pass replace: true to
    // retire the existing teams (kept for history as disbanded/removed).
    const existingTeams = await liveTeams(supabase, hunt_id);
    if (existingTeams.length > 0 && body.replace !== true) {
      throw new ApiError(409, "This hunt already has teams. Send replace: true to form them again.");
    }
    // Called once the request is known to be valid, just before creating teams.
    const retireExistingTeams = async () => {
      const oldIds = existingTeams.map((t) => t.id);
      if (oldIds.length === 0) return;
      await supabase.from("team_members").update({ status: "removed" }).in("team_id", oldIds).eq("status", "active");
      await supabase.from("teams").update({ status: "disbanded" }).in("id", oldIds);
    };

    // Get roster members
    let studentIds: string[] = [];

    if (strategy === "teacher_assigned" && assignments) {
      // Teacher provides explicit team assignments
      // assignments: [{ team_name: "Team A", student_ids: ["id1", "id2"] }, ...]
      if (!Array.isArray(assignments)) throw new ApiError(400, "assignments must be a list");
      const seen = new Set<string>();
      const cleaned = assignments.map((a: { team_name?: unknown; student_ids?: unknown }, i: number) => {
        const ids = Array.isArray(a?.student_ids)
          ? [...new Set(a.student_ids.filter((s: unknown): s is string => typeof s === "string" && s.length > 0))]
          : [];
        for (const sid of ids) {
          if (seen.has(sid)) throw new ApiError(400, "A student can only be on one team per hunt");
          seen.add(sid);
        }
        const name = typeof a?.team_name === "string" && a.team_name.trim() ? a.team_name.trim().slice(0, 40) : `Team ${i + 1}`;
        return { name, ids: ids as string[] };
      });

      await retireExistingTeams();
      const teams: { id: string; name: string; members: string[] }[] = [];
      for (const assignment of cleaned) {
        const { data: team } = await supabase
          .from("teams")
          .insert({
            hunt_id,
            name: assignment.name,
            formation_method: "manual",
            max_size: Math.max(teamSizeClamped, assignment.ids.length),
            status: "ready",
          })
          .select("id")
          .single();

        if (!team) throw new ApiError(500, "Could not create teams");

        if (assignment.ids.length > 0) {
          const { error: memberError } = await supabase.from("team_members").insert(
            assignment.ids.map((sid, j) => ({
              team_id: team.id,
              user_id: sid,
              role: j === 0 ? "captain" : "member",
            }))
          );
          if (memberError) throw new ApiError(400, "Could not add those students. Check the student ids.");
        }

        teams.push({ id: team.id, name: assignment.name, members: assignment.ids });
      }

      return Response.json({ teams, strategy: "teacher_assigned" }, { status: 201 });
    }

    // Get students from roster
    const { data: entries } = await supabase
      .from("roster_entries")
      .select("student_id")
      .eq("roster_id", roster_id);

    studentIds = (entries || []).map((e) => e.student_id);

    if (studentIds.length < 2) {
      throw new ApiError(400, "Need at least 2 students to form teams");
    }

    // Execute formation strategy
    let groupedStudents: string[][];

    switch (strategy) {
      case "random":
        groupedStudents = shuffleAndChunk(studentIds, teamSizeClamped);
        break;

      case "personality_similar":
      case "personality_diverse": {
        // Get personality scores. A retake adds a row, so keep only each
        // student's latest: a duplicate would put them on two teams.
        const { data: allAssessments } = await supabase
          .from("player_assessments")
          .select("user_id, scores, assessed_at")
          .in("user_id", studentIds)
          .eq("assessment_type", "personality")
          .order("assessed_at", { ascending: false });
        const assessments = latestPerUser(allAssessments || []);

        if (!assessments || assessments.length < studentIds.length / 2) {
          // Not enough assessments — fall back to random
          groupedStudents = shuffleAndChunk(studentIds, teamSizeClamped);
        } else {
          groupedStudents = clusterByScores(
            assessments.map((a) => ({ id: a.user_id, scores: a.scores as Record<string, number> })),
            teamSizeClamped,
            strategy === "personality_similar"
          );
          // Add un-assessed students randomly
          const assessed = new Set(assessments.map((a) => a.user_id));
          const unassessed = studentIds.filter((id) => !assessed.has(id));
          distributeRemaining(groupedStudents, unassessed, teamSizeClamped);
        }
        break;
      }

      case "performance_similar":
      case "performance_diverse": {
        // Get past scores
        const { data: sessions } = await supabase
          .from("play_sessions")
          .select("user_id, total_score")
          .in("user_id", studentIds)
          .eq("status", "completed")
          .order("total_score", { ascending: false });

        if (!sessions || sessions.length === 0) {
          groupedStudents = shuffleAndChunk(studentIds, teamSizeClamped);
        } else {
          // Average score per student
          const scoreMap = new Map<string, number[]>();
          for (const s of sessions) {
            if (!scoreMap.has(s.user_id)) scoreMap.set(s.user_id, []);
            scoreMap.get(s.user_id)!.push(s.total_score || 0);
          }
          const ranked = studentIds
            .map((id) => {
              const scores = scoreMap.get(id) || [50];
              return { id, avg: scores.reduce((a, b) => a + b, 0) / scores.length };
            })
            .sort((a, b) => a.avg - b.avg);

          if (strategy === "performance_similar") {
            // Group adjacent students (similar performance)
            groupedStudents = chunkArray(ranked.map((r) => r.id), teamSizeClamped);
          } else {
            // Interleave high/low performers
            groupedStudents = interleaveChunk(ranked.map((r) => r.id), teamSizeClamped);
          }
        }
        break;
      }

      case "balanced":
      default:
        // Balanced: just random for now (full balanced algorithm needs personality + performance)
        groupedStudents = shuffleAndChunk(studentIds, teamSizeClamped);
        break;
    }

    // Create teams in database
    await retireExistingTeams();
    const teams: { id: string; name: string; members: string[] }[] = [];
    for (let i = 0; i < groupedStudents.length; i++) {
      const members = groupedStudents[i];
      const { data: team } = await supabase
        .from("teams")
        .insert({
          hunt_id,
          name: `Team ${i + 1}`,
          // teams.formation_method only allows a few values; inserting the
          // strategy name failed the CHECK and silently created no teams.
          formation_method: formationMethodFor(strategy),
          // Chunking can fold a leftover student into the last team.
          max_size: Math.max(teamSizeClamped, members.length),
          status: "ready",
        })
        .select("id")
        .single();

      if (!team) throw new ApiError(500, "Could not create teams");

      // First member is captain
      const memberInserts = members.map((sid, j) => ({
        team_id: team.id,
        user_id: sid,
        role: j === 0 ? "captain" : "member",
      }));

      await supabase.from("team_members").insert(memberInserts);
      teams.push({ id: team.id, name: `Team ${i + 1}`, members });
    }

    // Save formation config
    await supabase.from("team_formation_configs").insert({
      hunt_id,
      strategy,
      min_team_size: 2,
      max_team_size: teamSizeClamped,
      config: { roster_id, student_count: studentIds.length },
    }).then(() => {}, () => {});

    return Response.json({
      teams,
      strategy,
      total_students: studentIds.length,
      total_teams: teams.length,
    }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

// ── Helper functions ──

function shuffleAndChunk(arr: string[], size: number): string[][] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return chunkArray(shuffled, size);
}

function chunkArray(arr: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  // If last chunk is too small, merge with previous
  if (chunks.length > 1 && chunks[chunks.length - 1].length < 2) {
    const last = chunks.pop()!;
    chunks[chunks.length - 1].push(...last);
  }
  return chunks;
}

function interleaveChunk(sortedArr: string[], size: number): string[][] {
  const numTeams = Math.ceil(sortedArr.length / size);
  const teams: string[][] = Array.from({ length: numTeams }, () => []);
  for (let i = 0; i < sortedArr.length; i++) {
    teams[i % numTeams].push(sortedArr[i]);
  }
  return teams.filter((t) => t.length >= 2);
}

function clusterByScores(
  students: { id: string; scores: Record<string, number> }[],
  teamSize: number,
  similar: boolean
): string[][] {
  // Simple clustering: sort by first score dimension, then chunk (similar) or interleave (diverse)
  const sorted = [...students].sort((a, b) => {
    const aVal = Object.values(a.scores)[0] || 0;
    const bVal = Object.values(b.scores)[0] || 0;
    return aVal - bVal;
  });
  const ids = sorted.map((s) => s.id);
  return similar ? chunkArray(ids, teamSize) : interleaveChunk(ids, teamSize);
}

function distributeRemaining(groups: string[][], remaining: string[], maxSize: number) {
  for (const id of remaining) {
    // Find smallest group that isn't full
    const smallest = groups
      .filter((g) => g.length < maxSize)
      .sort((a, b) => a.length - b.length)[0];
    if (smallest) {
      smallest.push(id);
    } else {
      groups.push([id]);
    }
  }
}
export const maxDuration = 60;
