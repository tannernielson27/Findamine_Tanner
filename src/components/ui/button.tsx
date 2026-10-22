/**
 * Buttons for the overhauled UI.
 *
 * One trail-orange `primary` per screen (the Trail-marker rule). Sizes follow
 * the house targets: md 48px, lg 56px, xl 64px (in-play primary actions).
 * `ButtonLink` renders the same look as a Next.js link.
 */
import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils/cn";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 font-bold transition-colors duration-150 ease-out select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:bg-themed-border disabled:text-themed-muted disabled:shadow-none",
  {
    variants: {
      variant: {
        primary: "bg-brand text-white hover:bg-brand-dark",
        secondary: "border border-themed-border bg-surface text-themed-text hover:bg-themed-bg",
        ink: "bg-ink text-white hover:bg-ink-raised",
        "on-ink": "bg-white/15 text-white hover:bg-white/25",
        light: "bg-white text-juniper-deep hover:bg-white/90",
        ghost: "text-themed-text hover:bg-themed-text/5",
      },
      size: {
        md: "min-h-12 rounded-[14px] px-5 text-base",
        lg: "min-h-14 rounded-2xl px-6 text-[17px]",
        xl: "min-h-16 rounded-[20px] px-6 text-[19px]",
      },
      block: { true: "w-full", false: "" },
      elevated: { true: "shadow-cta", false: "" },
    },
    defaultVariants: { variant: "primary", size: "md", block: false, elevated: false },
  }
);

type Variants = VariantProps<typeof buttonVariants>;

export interface ButtonProps extends ComponentProps<"button">, Variants {}

export function Button({ className, variant, size, block, elevated, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size, block, elevated }), className)} {...props} />;
}

export interface ButtonLinkProps extends ComponentProps<typeof Link>, Variants {}

export function ButtonLink({ className, variant, size, block, elevated, ...props }: ButtonLinkProps) {
  return <Link className={cn(buttonVariants({ variant, size, block, elevated }), "no-underline", className)} {...props} />;
}
