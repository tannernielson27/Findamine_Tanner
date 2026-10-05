"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import TeamChat from "@/components/social/team-chat";

interface Team {
  id: string;
  name: string;
  hunt_id: string;
  status: string;
  team_members: { user_id: string; role: string; users: { display_name: string | null } | null }[];
}

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string>("");

  useEffect(() => {
    async function load() {
      const [teamsRes, meRes] = await Promise.all([
        fetch("/api/v1/teams?mine=true"),
        fetch("/api/v1/auth/me"),
      ]);
      if (teamsRes.ok) {
        const data = await teamsRes.json();
        setTeams(data.teams || []);
      }
      if (meRes.ok) {
        const data = await meRes.json();
        setCurrentUserId(data.user?.id || "");
      }
      setLoading(false);
    }
    load();
  }, []);

  return (
    <main className="mx-auto max-w-4xl px-4 py-4">
      <Link href="/dashboard" className="text-sm text-brand hover:underline mb-4 inline-block">
        &larr; Dashboard
      </Link>
      <h1 className="text-base font-semibold text-gray-900 mb-2">My Teams</h1>
      <p className="text-sm text-gray-500 mb-6">Teams you belong to across all hunts.</p>

      {loading ? (
        <div className="animate-pulse space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-lg" />)}
        </div>
      ) : teams.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-200 p-12 text-center text-gray-500">
          <p>You haven&apos;t joined any teams yet.</p>
          <p className="text-xs mt-1">Teams are set up by the teacher or organizer running a hunt. Once you&apos;re placed on one, it shows up here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {teams.map((team) => (
            <div key={team.id} className="rounded-lg border border-gray-200 bg-white">
              <div className="p-4 flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-gray-900">{team.name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${
                      team.status === "active" ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-600"
                    }`}>
                      {team.status}
                    </span>
                    <span className="text-xs text-gray-500">
                      {team.team_members?.length || 0} members
                    </span>
                  </div>
                  {team.team_members && (
                    <p className="text-xs text-gray-500 mt-1">
                      {team.team_members.map((m) => m.users?.display_name || "Player").join(", ")}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => setActiveChat(activeChat === team.id ? null : team.id)}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                >
                  {activeChat === team.id ? "Close Chat" : "Open Chat"}
                </button>
              </div>

              {activeChat === team.id && currentUserId && (
                <div className="border-t border-gray-100 p-4">
                  <TeamChat teamId={team.id} currentUserId={currentUserId} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
