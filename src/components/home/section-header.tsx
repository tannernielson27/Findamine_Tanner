import Link from "next/link";

interface SectionHeaderProps {
  id: string;
  title: string;
  /** Optional "See all" style link on the right. */
  link?: { href: string; label: string };
  className?: string;
}

/** Home section title (Fredoka 22px) with an optional trailing link. */
export function SectionHeader({ id, title, link, className }: SectionHeaderProps) {
  return (
    <div className={`flex items-baseline justify-between gap-3 px-5 pb-3 ${className ?? ""}`}>
      <h2 id={id} className="m-0 font-[family-name:var(--font-display)] text-[22px] font-semibold">
        {title}
      </h2>
      {link && (
        <Link href={link.href} className="inline-flex min-h-11 items-center text-[15px] font-semibold text-link no-underline hover:text-link-dark">
          {link.label}
        </Link>
      )}
    </div>
  );
}
