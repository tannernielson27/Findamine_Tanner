import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { getGrowthMindsetMessage } from "@/lib/services/scoring";
import { scoreAnswer, totalSolveMs, type TimedCompletion } from "../../_lib/answer-scoring";
import { awardReferralPoints } from "@/lib/services/referral";
import { recordPrivacyNotice, type PrivacyNotice } from "@/lib/services/privacy-notice";
import { logger } from "@/lib/utils/logger";
import { playLimiter } from "@/lib/utils/rate-limit";
import { evaluateBadges, updateStreak } from "@/lib/services/gamification";
import { getCompletion } from "../../_lib/completions";
import { gradeAnswer } from "../../_lib/grading";
import { bandForUser } from "@/lib/utils/age-band";
import { isOwnAudioPath, parseAudioAnswer } from "@/lib/play/audio-answer";
import { internalError } from "@/lib/utils/internal-error";
import { runAfter } from "@/lib/utils/run-after";
import { assertStopOpen } from "../../_lib/stop-access";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ huntId: string }> }
) {
  const start = performance.now();
  try {
    const { huntId } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    await playLimiter.check(request, user.id);

    const body = await request.json();
    const { find_id, answer } = body;

    if (!find_id || answer === undefined) {
      throw new ApiError(400, "find_id and answer are required");
    }

    const supabase = await createSupabaseServiceClient();

    // The session, the find's task, the player's age band and the hunt's
    // metadata are independent reads: fetch them together.
    const [{ data: session }, { data: find }, { data: profile }, { data: hunt }] =
      await Promise.all([
        supabase
          .from("play_sessions")
          .select("id, metadata, started_at")
          .eq("hunt_id", huntId)
          .eq("user_id", user.id)
          .eq("status", "active")
          .single(),
        supabase.from("finds").select("tasks(id, content, challenge_type)").eq("id", find_id).single(),
        supabase.from("user_profiles").select("effective_band").eq("user_id", user.id).maybeSingle(),
        supabase.from("hunts").select("metadata").eq("id", huntId).maybeSingle(),
      ]);

    if (!session) throw new ApiError(404, "No active play session");

    // Clue delivery: only the player's current stop (any stop in all-at-once mode).
    // On a scheduled hunt this also refuses a stop that is not released, and
    // any answer once the hunt has ended; it returns when the stop was released.
    const { releasedAt } = await assertStopOpen(supabase, { huntId, userId: user.id, session, findId: find_id, route: "/api/v1/play/[huntId]/answer" });

    // Get completion record (may already exist from prime-viewed/arrive steps)
    const completion = await getCompletion(supabase, session.id, find_id);

    if (!completion?.arrived_at) throw new ApiError(400, "Must arrive at location first");
    if (completion.completed_at) throw new ApiError(409, "Already completed this find");

    // Count previous attempts
    const metadata = (completion.metadata || {}) as Record<string, unknown>;
    const attemptCount = ((metadata.attempt_count as number) || 0) + 1;
    const maxAttempts = 5;

    if (attemptCount > maxAttempts) {
      throw new ApiError(400, "Maximum attempts reached");
    }

    const task = find?.tasks as unknown as {
      id: string;
      content: Record<string, unknown>;
      challenge_type: string;
    } | null;

    // A spoken answer must reference this player's own upload for this stop
    // (POST ../audio), or for a child, say the recording stayed on the device.
    if (task?.challenge_type === "audio_response") {
      const audio = parseAudioAnswer(answer);
      const valid = audio && (audio.path === null
        ? user.role === "child"
        : user.role !== "child" && isOwnAudioPath(audio.path, user.id, completion.id));
      if (!valid) {
        throw new ApiError(400, "Your recording wasn't saved. Please record your answer again.");
      }
    }

    // Determine correctness. Open-ended tasks (no answer key) accept any real
    // submission; a blank one is rejected without using up an attempt.
    const { isCorrect, partialCredit, openEnded } = gradeAnswer(task, answer);
    if (openEnded && !isCorrect) {
      throw new ApiError(400, "Please enter an answer before submitting");
    }

    // Score under the hunt's scoring version (issue #11). All times are the
    // server's: version 2 measures this stop from its own start, version 1
    // from the start of the session as it always has. A hunt's version can't
    // change once it has play sessions, so one board never mixes scales.
    const answeredAt = Date.now();
    const scored = scoreAnswer({
      huntMetadata: (hunt?.metadata as Record<string, unknown> | null) ?? null,
      isCorrect,
      partialCredit,
      attemptNumber: attemptCount,
      completion,
      sessionStartedAt: session.started_at,
      answeredAt,
      expectedTimeSeconds: (task?.content?.expected_time_seconds as number) || undefined,
      challengeType: task?.challenge_type || "short_text",
      // Scheduled hunts: half the time points are for how soon after the
      // stop's release it was solved (version 2 only). Null on other hunts.
      releasedAt,
    });

    const ageBand = bandForUser(profile?.effective_band, user.role);
    const gmMessage = getGrowthMindsetMessage(
      scored.feedbackType,
      ageBand,
      attemptCount
    );

    // Update completion
    const isNowComplete = isCorrect || attemptCount >= maxAttempts;

    const { error: updateError } = await supabase
      .from("find_completions")
      .update({
        answer_value: String(answer),
        score: scored.totalScore,
        feedback: gmMessage.main,
        completed_at: isNowComplete ? new Date(answeredAt).toISOString() : null,
        metadata: {
          ...metadata,
          attempt_count: attemptCount,
          // scoring_version, scoring_breakdown and, on version 2, scoring_timing.
          ...scored.record,
          last_answer: String(answer),
          is_correct: isCorrect,
        },
      })
      .eq("id", completion.id);

    if (updateError) throw internalError("/api/v1/play/[huntId]/answer", updateError);

    let privacyNotice: PrivacyNotice | null = null;
    let badgesEarned: string[] = [];

    // Everything below is independent (the completion row is already saved), so
    // run it together.
    const storeFeedback = supabase.from("answer_feedback").insert({
      completion_id: completion.id,
      feedback_type: scored.feedbackType,
      main_message: gmMessage.main,
      explanation: gmMessage.explanation,
      next_steps: gmMessage.nextSteps,
      generated_by: "template",
      tone: "growth_mindset",
    });

    if (!isNowComplete) {
      await storeFeedback;
    } else {
      // Just-in-time privacy notice (storyline S6, migration 063). Skipped for
      // hunts that hide scores: a notice about who can see "this score" would
      // be about a score the player is never shown. recordPrivacyNotice never
      // throws, so scoring cannot fail because of it.
      const huntHidesScores = !!(hunt?.metadata as Record<string, unknown> | null)?.hide_scores;

      // Badges and the daily streak. These must never fail a scored answer.
      const gamify = async (): Promise<string[]> => {
        try {
          const [streak, findBadges] = await Promise.all([
            updateStreak(user.id),
            evaluateBadges(user.id, "find_complete"),
          ]);
          return [...streak.badgesEarned, ...findBadges];
        } catch (gamificationError) {
          logger.error("play.answer.gamification_error", {
            userId: user.id,
            huntId,
            findId: find_id,
            error: gamificationError instanceof Error ? gamificationError.message : String(gamificationError),
          });
          return [];
        }
      };

      // Update the session's total score and total solve time (the leaderboard
      // tiebreak) from all its completions.
      const updateTotal = async () => {
        const { data: allCompletions } = await supabase
          .from("find_completions")
          .select("score, started_at, arrived_at, created_at, completed_at")
          .eq("play_session_id", session.id);
        const rows = (allCompletions || []) as (TimedCompletion & { score: number | null })[];
        const totalScore = rows.reduce((sum, c) => sum + (c.score || 0), 0);
        const { error: totalError } = await supabase
          .from("play_sessions")
          .update({ total_score: totalScore, total_solve_ms: totalSolveMs(rows) })
          .eq("id", session.id);
        if (totalError) {
          // total_solve_ms comes with migration 085. Without it, still save
          // the score: a missing tiebreak must never cost a player their total.
          logger.warn("play.answer.total_solve_ms_failed", { huntId, error: totalError.message });
          await supabase.from("play_sessions").update({ total_score: totalScore }).eq("id", session.id);
        }
      };

      const [, , , notice, badges] = await Promise.all([
        storeFeedback,
        // The ledger adds up points from hunts on either scoring version (tiers,
        // profile totals), so a stop is entered out of 100 whatever its version.
        supabase.from("points_ledger").insert({
          user_id: user.id,
          amount: scored.comparablePoints,
          source_type: "challenge",
          source_id: find_id,
          hunt_id: huntId,
          description:
            scored.version === 1
              ? `Scored ${scored.totalScore} on find`
              : `Scored ${scored.totalScore} of ${scored.maxScore} on find (${scored.comparablePoints} points)`,
        }),
        updateTotal(),
        huntHidesScores
          ? Promise.resolve(null)
          : recordPrivacyNotice(user.id, { findId: find_id, huntId }),
        gamify(),
      ]);
      privacyNotice = notice;
      badgesEarned = badges;

      // Referral economy: a recruiter earns a share when their minion scores.
      // Not part of the response, so it runs after it is sent.
      // The share is taken from the common-scale points, like the ledger entry.
      runAfter("referral_points", () =>
        awardReferralPoints(user.id, scored.comparablePoints, find_id, huntId)
      );
    }

    logger.info("play.answer", { userId: user.id, huntId, findId: find_id, score: scored.totalScore, scoringVersion: scored.version, correct: isCorrect, attempt: attemptCount, durationMs: Math.round(performance.now() - start) });

    return Response.json({
      score: scored.totalScore,
      scoring_version: scored.version,
      max_score: scored.maxScore,
      // Version 2 only: how long this stop took, for the plain-language breakdown.
      solve_ms: scored.solveMs,
      breakdown: scored.breakdown,
      feedback: {
        type: scored.feedbackType,
        main: gmMessage.main,
        explanation: gmMessage.explanation,
        next_steps: gmMessage.nextSteps,
      },
      attempt: attemptCount,
      can_retry: scored.canRetry,
      is_complete: isNowComplete,
      privacy_notice: privacyNotice,
      badges_earned: badgesEarned,
    });
  } catch (error) {
    logger.error("play.answer.error", { durationMs: Math.round(performance.now() - start), error: error instanceof Error ? error.message : String(error) });
    return errorResponse(error);
  }
}
