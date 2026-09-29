import Leaderboard from "@/components/social/leaderboard";

export default function LeaderboardPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <header className="mb-5">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold text-themed-text text-balance">
          Leaderboard
        </h1>
        <p className="mt-1 text-base text-themed-muted">
          See where you stand — then go climb.
        </p>
      </header>
      <Leaderboard />
    </main>
  );
}
