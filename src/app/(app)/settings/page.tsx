"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Settings, RefreshCw, Shield, BookOpen, Users } from "lucide-react";
import { restartOnboardingTour } from "@/components/layout/onboarding";

export default function SettingsPage() {
  const [user, setUser] = useState<{ display_name: string; email: string; role: string } | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [tourRestarted, setTourRestarted] = useState(false);

  useEffect(() => {
    fetch("/api/v1/auth/me")
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load settings");
        const data = await res.json();
        if (!data.user) throw new Error("Could not load settings");
        setUser(data.user);
        setDisplayName(data.user.display_name || "");
      })
      .catch(() => setLoadFailed(true));
  }, [loadAttempt]);

  function retryLoad() {
    setLoadFailed(false);
    setLoadAttempt((n) => n + 1);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      const res = await fetch("/api/v1/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: displayName }),
      });
      setMessage(res.ok ? "Saved!" : "Failed to save.");
    } catch {
      setMessage("Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  if (!user && loadFailed) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12 text-center">
        <p role="alert" className="text-sm text-gray-700">
          We couldn&apos;t load your settings.
        </p>
        <button
          onClick={retryLoad}
          className="mt-4 min-h-11 rounded-xl border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Try again
        </button>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12 text-center">
        <div className="fm-shimmer space-y-4">
          <div className="h-8 w-32 bg-gray-100 rounded-xl mx-auto" />
          <div className="h-40 bg-gray-100 rounded-2xl" />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-gray-900 flex items-center gap-2 mb-6">
        <Settings className="w-6 h-6 text-brand" />
        Settings
      </h1>

      <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6 mb-6">
        <form onSubmit={handleSave} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <p className="text-sm text-gray-500 bg-gray-50 rounded-xl px-4 py-2.5">{user.email}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <p className="text-sm text-gray-500 bg-gray-50 rounded-xl px-4 py-2.5 capitalize">{user.role}</p>
          </div>

          <div>
            <label htmlFor="displayName" className="block text-sm font-medium text-gray-700 mb-1">
              Explorer Name
            </label>
            <input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="block w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm focus:bg-white focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 transition"
            />
          </div>

          {message && (
            <p className={`text-sm font-medium ${message === "Saved!" ? "text-green-600" : "text-red-600"}`}>
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-brand px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50 transition"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </form>
      </div>

      <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6 space-y-4">
        <h2 className="font-[family-name:var(--font-display)] font-semibold text-gray-900">More</h2>

        <div>
          <button
            onClick={() => {
              restartOnboardingTour();
              setTourRestarted(true);
            }}
            className="flex items-center gap-2 text-sm text-brand hover:underline font-medium"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            Run welcome tutorial again
          </button>
          <p role="status" className="mt-1 text-xs text-gray-500">
            {tourRestarted ? "The welcome tour has been restarted. Skip it any time to come back here." : ""}
          </p>
        </div>

        <Link
          href="/settings/privacy"
          className="flex items-center gap-2 text-sm text-brand hover:underline font-medium"
        >
          <Shield className="w-4 h-4" />
          Privacy settings
        </Link>

        <Link
          href="/dashboard/join-class"
          className="flex items-center gap-2 text-sm text-brand hover:underline font-medium"
        >
          <Users className="w-4 h-4" />
          Join a class with a code
        </Link>

        <Link
          href="/debrief"
          className="flex items-center gap-2 text-sm text-brand hover:underline font-medium"
        >
          <BookOpen className="w-4 h-4" />
          About this research study
        </Link>
      </div>
    </main>
  );
}
