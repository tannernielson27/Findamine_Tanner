import Link from "next/link";
import Image from "next/image";
import { headers } from "next/headers";
import { MapPin, Users, Trophy, Compass, BookOpen, Shield, ChevronRight, Footprints } from "lucide-react";
import { selectHeroBanner, getHeroBannerContext } from "@/lib/services/hero-banner";

export default async function Home() {
  const headersList = await headers();
  const geoCtx = getHeroBannerContext(headersList);
  const hero = selectHeroBanner(geoCtx);

  return (
    <main className="min-h-screen bg-[#FEFCF6] overflow-hidden">
      {/* ─── Hero ─────────────────────────────────────────── */}
      <section className="relative">
        {/* Background image */}
        <div className="absolute inset-0">
          <Image
            src={hero.src}
            alt={hero.alt}
            fill
            className="object-cover"
            priority
            sizes="100vw"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#FEFCF6]/85 via-[#FEFCF6]/50 to-[#FEFCF6]" />
        </div>

        {/* Nav bar */}
        <nav className="relative z-10 mx-auto max-w-5xl px-6 pt-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Image
              src="/logo-findamine.png"
              alt="findamine"
              width={140}
              height={35}
              priority
              className="h-auto"
              style={{ objectFit: "contain" }}
            />
          </div>
          <div className="flex items-center gap-4">
            <Link href="/login" className="flex min-h-11 items-center px-1 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
              Sign In
            </Link>
            <Link
              href="/register"
              className="flex min-h-11 items-center rounded-full bg-brand px-4 text-sm font-semibold text-white shadow-md shadow-brand/20 hover:shadow-lg hover:-translate-y-0.5 transition-all"
            >
              Get Started
            </Link>
          </div>
        </nav>

        {/* Hero content */}
        <div className="relative z-10 mx-auto max-w-4xl px-6 pt-16 pb-20 sm:pt-24 sm:pb-28 text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/80 backdrop-blur-sm px-4 py-1.5 text-xs font-semibold text-amber-700 shadow-sm mb-6 border border-amber-200/60">
            <Compass className="w-3.5 h-3.5 animate-[spin_8s_linear_infinite]" />
            GPS-Powered Learning Adventures
          </div>

          <h1 className="font-[family-name:var(--font-display)] text-4xl sm:text-5xl md:text-6xl font-bold text-gray-900 leading-[1.1] tracking-tight">
            Turn the World Into
            <br />
            <span className="bg-gradient-to-r from-sky-500 via-emerald-500 to-amber-500 bg-clip-text text-transparent">
              Your Classroom
            </span>
          </h1>

          <p className="mt-5 text-lg sm:text-xl text-gray-600 max-w-xl mx-auto leading-relaxed">
            Create GPS scavenger hunts that make learning an outdoor adventure.
            For classrooms, families, and curious explorers of every age.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href="/register"
              className="group inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-amber-500 via-sky-500 to-emerald-500 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-sky-500/25 hover:shadow-xl hover:shadow-sky-500/30 hover:-translate-y-0.5 transition-all"
            >
              Start Your Adventure
              <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <Link
              href="/browse"
              className="inline-flex items-center gap-2 rounded-full border-2 border-gray-200 bg-white/80 backdrop-blur-sm px-6 py-3 text-sm font-semibold text-gray-700 hover:border-brand hover:text-brand transition-all"
            >
              <MapPin className="w-4 h-4" />
              Browse Hunts
            </Link>
          </div>

          {/* Floating highlights — deliberately not numbers: nothing here is a live count. */}
          <div className="mt-12 flex justify-center gap-8 sm:gap-12">
            {[
              { label: "Real GPS navigation", value: "Outdoors" },
              { label: "Solo or team play", value: "Together" },
              { label: "Badges for effort", value: "Rewarding" },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="font-[family-name:var(--font-display)] text-2xl sm:text-3xl font-bold text-gray-900">{stat.value}</div>
                <div className="text-xs text-gray-500 mt-0.5">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Decorative wave divider */}
        <div className="absolute bottom-0 left-0 right-0">
          <svg viewBox="0 0 1440 60" fill="none" className="w-full h-auto">
            <path d="M0 60L48 54C96 48 192 36 288 30C384 24 480 24 576 28C672 32 768 40 864 42C960 44 1056 40 1152 34C1248 28 1344 20 1392 16L1440 12V60H0Z" fill="#FEFCF6" />
          </svg>
        </div>
      </section>

      {/* ─── Stop Flow ────────────────────────────────────── */}
      <section className="relative py-16">
        <div className="mx-auto max-w-4xl px-6">
          <div className="text-center mb-10">
            <span className="font-[family-name:var(--font-handwritten)] text-xl text-amber-600">How it works</span>
            <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold text-gray-900 mt-1">
              The 6-Step Adventure
            </h2>
          </div>

          {/* Connected path visualization */}
          <div className="relative">
            {/* Dotted path connecting steps */}
            <div className="absolute top-12 left-8 right-8 h-0.5 border-t-2 border-dashed border-amber-300/60 hidden lg:block" />

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { step: 1, icon: BookOpen, name: "Prime", desc: "Review a concept before you explore", color: "from-sky-400 to-blue-500" },
                { step: 2, icon: Compass, name: "Clue", desc: "Decode the clue to find your next spot", color: "from-emerald-400 to-teal-500" },
                { step: 3, icon: Footprints, name: "Navigate", desc: "Walk there using the hot/cold GPS meter", color: "from-amber-400 to-orange-500" },
                { step: 4, icon: Trophy, name: "Challenge", desc: "Solve a location-based challenge", color: "from-violet-400 to-purple-500" },
                { step: 5, icon: MapPin, name: "Capture", desc: "Take a geo-selfie to prove you were there", color: "from-rose-400 to-pink-500" },
                { step: 6, icon: Shield, name: "Feedback", desc: "Get personalized growth-mindset feedback", color: "from-teal-400 to-cyan-500" },
              ].map((s) => {
                const Icon = s.icon;
                return (
                  <div
                    key={s.step}
                    className="group relative rounded-2xl bg-white p-5 shadow-sm border border-gray-100/80 hover:shadow-lg hover:-translate-y-1 transition-all duration-300"
                  >
                    <div className={`inline-flex rounded-xl bg-gradient-to-br ${s.color} p-2.5 text-white shadow-md mb-3`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="absolute top-3 right-4 font-[family-name:var(--font-handwritten)] text-3xl font-bold text-gray-200 group-hover:text-brand-light transition-colors">
                      {s.step}
                    </div>
                    <h3 className="font-[family-name:var(--font-display)] font-semibold text-base text-gray-900">{s.name}</h3>
                    <p className="text-sm text-gray-500 mt-1">{s.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ─── Features ─────────────────────────────────────── */}
      <section className="py-16 bg-white">
        <div className="mx-auto max-w-5xl px-6">
          <div className="text-center mb-10">
            <span className="font-[family-name:var(--font-handwritten)] text-xl text-emerald-600">Why findamine?</span>
            <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold text-gray-900 mt-1">
              Learning That Moves
            </h2>
            <p className="text-gray-500 text-sm max-w-md mx-auto mt-2">
              Built on research-backed pedagogy. Every hunt follows a proven learning cycle.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              icon={<MapPin className="w-5 h-5" />}
              title="GPS Navigation"
              description="Hot/cold proximity meter guides explorers to each stop. Real GPS, real adventure."
              accent="bg-sky-500"
            />
            <FeatureCard
              icon={<Users className="w-5 h-5" />}
              title="Team Play"
              description="Cooperative scoring, consensus voting, mentoring, and real-time team chat."
              accent="bg-violet-500"
            />
            <FeatureCard
              icon={<Trophy className="w-5 h-5" />}
              title="Badges to Earn"
              description="Mastery, creativity, teamwork, exploration. Growth-mindset rewards that celebrate effort."
              accent="bg-amber-500"
            />
            <FeatureCard
              icon={<Compass className="w-5 h-5" />}
              title="Age-Adaptive"
              description="The entire UI transforms per age group. Playful for kids, sleek for teens, refined for adults."
              accent="bg-emerald-500"
            />
            <FeatureCard
              icon={<BookOpen className="w-5 h-5" />}
              title="Curriculum Tasks"
              description="Standards-aligned tasks across science, math, history, and more. Or create your own."
              accent="bg-rose-500"
            />
            <FeatureCard
              icon={<Shield className="w-5 h-5" />}
              title="COPPA Safe"
              description="Privacy-first for kids. No data selling, ever. Parental controls and research-grade security."
              accent="bg-slate-600"
            />
          </div>
        </div>
      </section>

      {/* ─── Audience Bands ───────────────────────────────── */}
      <section className="py-16">
        <div className="mx-auto max-w-4xl px-6">
          <div className="text-center mb-10">
            <span className="font-[family-name:var(--font-handwritten)] text-xl text-violet-600">For everyone</span>
            <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold text-gray-900 mt-1">
              One App, Four Experiences
            </h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {[
              { band: "Ages 7-9", color: "border-amber-300 bg-amber-50/50", dot: "bg-amber-400", desc: "Big buttons, playful animations, guided hints, warm colors" },
              { band: "Ages 10-12", color: "border-sky-300 bg-sky-50/50", dot: "bg-sky-400", desc: "Balanced challenge, team features, badge progression" },
              { band: "Ages 13-17", color: "border-indigo-300 bg-indigo-50/50", dot: "bg-indigo-400", desc: "Sleek interface, advanced challenges, minimal scaffolding" },
              { band: "Adults 18+", color: "border-gray-300 bg-gray-50/50", dot: "bg-gray-600", desc: "Professional design, research tools, educator features" },
            ].map((b) => (
              <div key={b.band} className={`rounded-2xl border-2 ${b.color} p-5`}>
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-3 h-3 rounded-full ${b.dot}`} />
                  <span className="font-[family-name:var(--font-display)] font-semibold text-gray-900">{b.band}</span>
                </div>
                <p className="text-sm text-gray-600">{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA ──────────────────────────────────────────── */}
      <section className="py-16 bg-white">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <div className="font-[family-name:var(--font-handwritten)] text-5xl text-amber-500 mb-2">
            Ready?
          </div>
          <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold text-gray-900 mb-3">
            Your Adventure Starts Here
          </h2>
          <p className="text-gray-500 mb-8">
            Teachers, parents, and learners of all ages. Free to start, always.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              href="/register"
              className="rounded-full bg-gradient-to-r from-amber-500 via-sky-500 to-emerald-500 px-7 py-3 text-sm font-bold text-white shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all"
            >
              Create Free Account
            </Link>
            <Link
              href="/login"
              className="rounded-full border-2 border-gray-200 bg-white px-7 py-3 text-sm font-semibold text-gray-700 hover:border-brand transition-all"
            >
              Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Footer ───────────────────────────────────────── */}
      <footer className="border-t border-gray-200/60 bg-[#FEFCF6]">
        <div className="mx-auto max-w-5xl px-6 py-8 flex flex-wrap items-center justify-between gap-4 text-sm text-gray-500">
          <div className="flex items-center gap-2">
            <Image
              src="/logo-findamine.png"
              alt="findamine"
              width={100}
              height={25}
              className="h-auto opacity-60"
              style={{ objectFit: "contain" }}
            />
          </div>
          <div className="flex gap-6">
            <Link href="/browse" className="hover:text-gray-700 transition-colors">Browse Hunts</Link>
            <Link href="/register" className="hover:text-gray-700 transition-colors">Sign Up</Link>
            <Link href="/login" className="hover:text-gray-700 transition-colors">Sign In</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  accent,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  accent: string;
}) {
  return (
    <div className="group rounded-2xl bg-[#FEFCF6] p-5 border border-gray-100/80 hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
      <div className={`inline-flex rounded-xl ${accent} p-2.5 text-white shadow-sm mb-3 group-hover:scale-110 transition-transform`}>
        {icon}
      </div>
      <h3 className="font-[family-name:var(--font-display)] font-semibold text-gray-900 mb-1">{title}</h3>
      <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
    </div>
  );
}
