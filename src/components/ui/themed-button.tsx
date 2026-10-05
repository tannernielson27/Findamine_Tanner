"use client";

import { forwardRef } from "react";
import { motion } from "framer-motion";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";
import { useAgeBand } from "@/lib/themes/age-band-provider";

const buttonVariants = cva(
  "inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "",
        secondary: "",
        outline: "border-2 bg-transparent",
        ghost: "bg-transparent",
        danger: "",
      },
      size: {
        sm: "",
        md: "",
        lg: "",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

// Age-band-specific style overrides.
// Sizes shorter than 44px carry max-sm:min-h-11 so they stay a comfortable tap
// target on phones without changing the denser desktop look.
const bandStyles = {
  primary: {
    base: "rounded-2xl shadow-lg font-bold tracking-wide",
    variants: {
      primary: "bg-[var(--color-primary)] text-white hover:brightness-110 active:scale-95",
      secondary: "bg-[var(--color-secondary)] text-white hover:brightness-110",
      outline: "border-[var(--color-primary)] text-[var(--color-primary)] hover:bg-[var(--color-primary-light)]",
      ghost: "text-[var(--color-primary)] hover:bg-[var(--color-primary-light)]",
      danger: "bg-[var(--color-error)] text-white hover:brightness-110",
    },
    sizes: {
      sm: "max-sm:min-h-11 h-10 px-4 text-base min-w-[48px]",
      md: "h-14 px-6 text-lg min-w-[48px]",
      lg: "h-16 px-8 text-xl min-w-[48px]",
    },
  },
  intermediate: {
    base: "rounded-xl shadow-md font-semibold",
    variants: {
      primary: "bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-dark)]",
      secondary: "bg-[var(--color-secondary)] text-white hover:brightness-110",
      outline: "border-[var(--color-primary)] text-[var(--color-primary)] hover:bg-[var(--color-primary-light)]",
      ghost: "text-[var(--color-primary)] hover:bg-[var(--color-primary-light)]",
      danger: "bg-[var(--color-error)] text-white hover:brightness-110",
    },
    sizes: {
      sm: "max-sm:min-h-11 h-9 px-3 text-sm",
      md: "h-11 px-5 text-base",
      lg: "h-13 px-6 text-lg",
    },
  },
  teen: {
    base: "rounded-lg shadow-sm font-medium",
    variants: {
      primary: "bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-dark)]",
      secondary: "bg-[var(--color-secondary)] text-white hover:brightness-110",
      outline: "border-[var(--color-border)] text-[var(--color-text)] hover:bg-gray-50",
      ghost: "text-[var(--color-primary)] hover:bg-gray-50",
      danger: "bg-[var(--color-error)] text-white hover:brightness-110",
    },
    sizes: {
      sm: "max-sm:min-h-11 h-8 px-3 text-sm",
      md: "max-sm:min-h-11 h-10 px-4 text-sm",
      lg: "h-12 px-6 text-base",
    },
  },
  adult: {
    base: "rounded-md font-medium",
    variants: {
      primary: "bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-dark)]",
      secondary: "bg-[var(--color-secondary)] text-white hover:brightness-110",
      outline: "border-[var(--color-border)] text-[var(--color-text)] hover:bg-gray-50",
      ghost: "text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-gray-50",
      danger: "bg-[var(--color-error)] text-white hover:brightness-110",
    },
    sizes: {
      sm: "max-sm:min-h-11 h-7 px-2 text-xs",
      md: "max-sm:min-h-11 h-9 px-4 text-sm",
      lg: "max-sm:min-h-11 h-10 px-5 text-sm",
    },
  },
};

// Animation variants per band
const tapAnimations = {
  primary: { scale: 0.92, transition: { type: "spring" as const, stiffness: 400 } },
  intermediate: { scale: 0.96 },
  teen: { scale: 0.98 },
  adult: { opacity: 0.8 },
};

interface ThemedButtonProps
  extends VariantProps<typeof buttonVariants> {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
}

const ThemedButton = forwardRef<HTMLButtonElement, ThemedButtonProps>(
  ({ className, variant = "primary", size = "md", children, onClick, disabled, type = "button" }, ref) => {
    const { band } = useAgeBand();
    const styles = bandStyles[band];

    return (
      <motion.button
        ref={ref}
        type={type}
        onClick={onClick}
        disabled={disabled}
        whileTap={tapAnimations[band]}
        whileHover={band === "primary" ? { scale: 1.03 } : undefined}
        className={cn(
          buttonVariants({ variant, size }),
          styles.base,
          styles.variants[variant || "primary"],
          styles.sizes[size || "md"],
          className
        )}
      >
        {children}
      </motion.button>
    );
  }
);

ThemedButton.displayName = "ThemedButton";
export { ThemedButton };
