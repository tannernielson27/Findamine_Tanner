/**
 * Hunt cover art. Shows the creator's uploaded photo when there is one;
 * otherwise generated contour-line art in one of three tones, picked from the
 * hunt so the same hunt always gets the same cover.
 */
/* eslint-disable @next/next/no-img-element -- covers come from Supabase storage with arbitrary sizes */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export type CoverTone = "blaze" | "juniper" | "sky";

const TONES: readonly CoverTone[] = ["blaze", "juniper", "sky"];

/** Category words that map to a tone before falling back to a hash. */
const TONE_HINTS: Array<[RegExp, CoverTone]> = [
  [/ecolog|nature|water|river|garden|tree|science|bio/i, "juniper"],
  [/art|architect|history|heritage|museum|library|culture/i, "sky"],
  [/challenge|race|navigator|sprint|ultimate/i, "blaze"],
];

/** Stable tone for a hunt: keyword match on the title, else a hash of the id. Pure. */
export function toneForHunt(id: string, title?: string | null): CoverTone {
  if (title) {
    for (const [pattern, tone] of TONE_HINTS) {
      if (pattern.test(title)) return tone;
    }
  }
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return TONES[hash % TONES.length];
}

interface TopoCoverProps {
  tone: CoverTone;
  imageUrl?: string | null;
  /** Alt text for an uploaded photo. Generated art is decorative. */
  alt?: string;
  className?: string;
  children?: ReactNode;
}

export function TopoCover({ tone, imageUrl, alt = "", className, children }: TopoCoverProps) {
  return (
    <div className={cn("relative overflow-hidden", !imageUrl && `fm-cover-${tone}`, className)}>
      {imageUrl && (
        <img src={imageUrl} alt={alt} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      )}
      {children}
    </div>
  );
}
