/**
 * Round icon-only button (48px default; 52px for the play HUD). Always needs
 * an accessible label because there is no visible text.
 */
import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils/cn";

type Tone = "surface" | "floating" | "tint";
type Size = "md" | "lg";

const TONE: Record<Tone, string> = {
  surface: "border border-themed-border bg-surface text-themed-text hover:bg-themed-bg",
  floating: "bg-white/95 text-themed-text shadow-raised hover:bg-white",
  tint: "bg-brand-light text-brand-dark hover:bg-brand-light/80",
};

const SIZE: Record<Size, string> = { md: "h-12 w-12", lg: "h-[52px] w-[52px]" };

function classes(tone: Tone, size: Size, className?: string) {
  return cn(
    "relative inline-flex shrink-0 items-center justify-center rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
    TONE[tone],
    SIZE[size],
    className
  );
}

interface CommonProps {
  label: string;
  tone?: Tone;
  size?: Size;
}

export function IconButton({
  label,
  tone = "surface",
  size = "md",
  className,
  type = "button",
  ...props
}: CommonProps & Omit<ComponentProps<"button">, "aria-label">) {
  return <button type={type} aria-label={label} className={classes(tone, size, className)} {...props} />;
}

export function IconLink({
  label,
  tone = "surface",
  size = "md",
  className,
  ...props
}: CommonProps & Omit<ComponentProps<typeof Link>, "aria-label">) {
  return <Link aria-label={label} className={classes(tone, size, className)} {...props} />;
}
