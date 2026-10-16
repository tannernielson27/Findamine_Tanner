import Link from "next/link";
import Image from "next/image";
import { CONTACT_EMAIL, LAST_UPDATED, PRIVACY_PATH, TERMS_PATH, formatLegalDate } from "@/lib/constants/legal";

/**
 * Shared shell for the public legal pages (/privacy, /terms). Server component,
 * no auth: both pages must load for signed-out visitors, App Review and parents.
 */

export interface LegalSectionProps {
  id: string;
  title: string;
  children: React.ReactNode;
}

export function LegalSection({ id, title, children }: LegalSectionProps) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-6">
      <h2
        id={`${id}-heading`}
        className="font-[family-name:var(--font-display)] text-xl font-semibold text-gray-900 mb-3"
      >
        {title}
      </h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-gray-700 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_strong]:text-gray-900">
        {children}
      </div>
    </section>
  );
}

export function ContactEmail() {
  return (
    <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-brand hover:underline">
      {CONTACT_EMAIL}
    </a>
  );
}

interface LegalPageProps {
  title: string;
  intro: React.ReactNode;
  sections: ReadonlyArray<{ id: string; title: string }>;
  children: React.ReactNode;
}

export default function LegalPage({ title, intro, sections, children }: LegalPageProps) {
  return (
    <main className="min-h-screen bg-[#FEFCF6] px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-8">
          <Link href="/" className="inline-block mb-6">
            <Image
              src="/logo-findamine.png"
              alt="findamine home"
              width={140}
              height={35}
              className="h-auto"
              style={{ objectFit: "contain" }}
            />
          </Link>
          <h1 className="font-[family-name:var(--font-display)] text-3xl sm:text-4xl font-bold text-gray-900">
            {title}
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Last updated <time dateTime={LAST_UPDATED}>{formatLegalDate(LAST_UPDATED)}</time>
          </p>
          <div className="mt-4 text-[15px] leading-relaxed text-gray-700 space-y-3">{intro}</div>
        </header>

        <nav aria-label="On this page" className="mb-8 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">On this page</p>
          <ol className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 text-sm list-decimal pl-5">
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-gray-700 hover:text-brand hover:underline">
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="rounded-2xl border border-gray-100 bg-white p-6 sm:p-8 shadow-sm space-y-10">
          {children}
        </article>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-4 text-sm text-gray-500">
          <p>
            Questions? <ContactEmail />
          </p>
          <nav aria-label="Legal" className="flex flex-wrap gap-5">
            <Link href="/" className="hover:text-gray-700">Home</Link>
            <Link href={PRIVACY_PATH} className="hover:text-gray-700">Privacy Policy</Link>
            <Link href={TERMS_PATH} className="hover:text-gray-700">Terms of Use</Link>
          </nav>
        </footer>
      </div>
    </main>
  );
}
