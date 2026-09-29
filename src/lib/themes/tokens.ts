/**
 * Age-Band Theme Tokens
 *
 * 4 skins: primary (7-9), intermediate (10-12), teen (13-17), adult (18+)
 * Each defines colors, typography, spacing, and component defaults.
 * Applied via CSS custom properties on <html data-age-band="...">
 */

export type AgeBand = "primary" | "intermediate" | "teen" | "adult";

export interface ThemeTokens {
  // Colors
  colorPrimary: string;
  colorPrimaryLight: string;
  colorPrimaryDark: string;
  colorSecondary: string;
  colorAccent: string;
  colorBackground: string;
  colorSurface: string;
  colorText: string;
  colorTextSecondary: string;
  colorBorder: string;
  colorSuccess: string;
  colorWarning: string;
  colorError: string;

  // Typography
  fontFamily: string;
  fontSizeBase: string;
  fontSizeSm: string;
  fontSizeLg: string;
  fontSizeXl: string;
  fontSizeHeading: string;
  lineHeight: string;
  fontWeight: string;

  // Spacing & Layout
  borderRadius: string;
  borderRadiusLg: string;
  touchTarget: string;
  spacing: string;
  cardPadding: string;

  // Navigation
  navStyle: "bottom-tabs" | "tabs" | "sidebar-tabs" | "sidebar";
  navIconSize: string;

  // Animations
  animationDuration: string;
  animationStyle: "playful" | "moderate" | "subtle" | "minimal";

  // Scaffolding defaults
  defaultTier: number;
  hintDelay: string;
  aiAssistLevel: number;
}

export const THEME_TOKENS: Record<AgeBand, ThemeTokens> = {
  primary: {
    colorPrimary: "#B45309",      // Amber
    colorPrimaryLight: "#FEF3C7",
    colorPrimaryDark: "#92400E",
    colorSecondary: "#B42318",     // Red
    colorAccent: "#047857",        // Emerald
    colorBackground: "#FAF7F0",    // Trail paper
    colorSurface: "#FFFFFF",
    colorText: "#1C2430",
    colorTextSecondary: "#5B6472",
    colorBorder: "#E6E0D4",
    colorSuccess: "#2F6B55",
    colorWarning: "#B45309",
    colorError: "#B42318",

    fontFamily: "'Nunito', 'Comic Sans MS', sans-serif",
    fontSizeBase: "18px",
    fontSizeSm: "16px",
    fontSizeLg: "22px",
    fontSizeXl: "28px",
    fontSizeHeading: "32px",
    lineHeight: "1.6",
    fontWeight: "600",

    borderRadius: "12px",
    borderRadiusLg: "16px",
    touchTarget: "44px",
    spacing: "12px",
    cardPadding: "16px",

    navStyle: "bottom-tabs",
    navIconSize: "24px",

    animationDuration: "0.4s",
    animationStyle: "playful",

    defaultTier: 1,
    hintDelay: "0s",
    aiAssistLevel: 3,
  },

  intermediate: {
    colorPrimary: "#0369A1",      // Sky blue
    colorPrimaryLight: "#E0F2FE",
    colorPrimaryDark: "#075985",
    colorSecondary: "#0F766E",     // Teal
    colorAccent: "#B45309",        // Amber
    colorBackground: "#FAF7F0",    // Trail paper
    colorSurface: "#FFFFFF",
    colorText: "#1C2430",
    colorTextSecondary: "#5B6472",
    colorBorder: "#E6E0D4",
    colorSuccess: "#2F6B55",
    colorWarning: "#B45309",
    colorError: "#B42318",

    fontFamily: "'Inter', system-ui, sans-serif",
    fontSizeBase: "16px",
    fontSizeSm: "14px",
    fontSizeLg: "20px",
    fontSizeXl: "24px",
    fontSizeHeading: "28px",
    lineHeight: "1.5",
    fontWeight: "500",

    borderRadius: "8px",
    borderRadiusLg: "12px",
    touchTarget: "44px",
    spacing: "10px",
    cardPadding: "12px",

    navStyle: "tabs",
    navIconSize: "20px",

    animationDuration: "0.3s",
    animationStyle: "moderate",

    defaultTier: 2,
    hintDelay: "60s",
    aiAssistLevel: 2,
  },

  teen: {
    colorPrimary: "#C2410C",      // Trail-blaze orange
    colorPrimaryLight: "#FDE7DA",
    colorPrimaryDark: "#9A3412",
    colorSecondary: "#2F6B55",     // Juniper
    colorAccent: "#1A6FA6",        // Sky pin (links, map)
    colorBackground: "#FAF7F0",    // Trail paper
    colorSurface: "#FFFFFF",
    colorText: "#1C2430",
    colorTextSecondary: "#5B6472",
    colorBorder: "#E6E0D4",
    colorSuccess: "#2F6B55",
    colorWarning: "#B45309",
    colorError: "#B42318",

    fontFamily: "'DM Sans', 'Inter', system-ui, sans-serif",
    fontSizeBase: "16px",
    fontSizeSm: "14px",
    fontSizeLg: "18px",
    fontSizeXl: "22px",
    fontSizeHeading: "26px",
    lineHeight: "1.5",
    fontWeight: "400",

    borderRadius: "6px",
    borderRadiusLg: "10px",
    touchTarget: "44px",
    spacing: "8px",
    cardPadding: "12px",

    navStyle: "sidebar-tabs",
    navIconSize: "18px",

    animationDuration: "0.2s",
    animationStyle: "subtle",

    defaultTier: 3,
    hintDelay: "120s",
    aiAssistLevel: 1,
  },

  adult: {
    colorPrimary: "#C2410C",      // Trail-blaze orange
    colorPrimaryLight: "#FDE7DA",
    colorPrimaryDark: "#9A3412",
    colorSecondary: "#2F6B55",     // Juniper
    colorAccent: "#1A6FA6",        // Sky pin (links, map)
    colorBackground: "#FAF7F0",
    colorSurface: "#FFFFFF",
    colorText: "#1C2430",
    colorTextSecondary: "#5B6472",
    colorBorder: "#E6E0D4",
    colorSuccess: "#2F6B55",
    colorWarning: "#B45309",
    colorError: "#B42318",

    fontFamily: "'Inter', system-ui, sans-serif",
    fontSizeBase: "16px",
    fontSizeSm: "14px",
    fontSizeLg: "16px",
    fontSizeXl: "20px",
    fontSizeHeading: "24px",
    lineHeight: "1.5",
    fontWeight: "400",

    borderRadius: "6px",
    borderRadiusLg: "8px",
    touchTarget: "44px",
    spacing: "8px",
    cardPadding: "10px",

    navStyle: "sidebar",
    navIconSize: "16px",

    animationDuration: "0.15s",
    animationStyle: "minimal",

    defaultTier: 4,
    hintDelay: "0s",
    aiAssistLevel: 0,
  },
};

/**
 * Convert theme tokens to CSS custom properties.
 */
export function tokensToCssVars(tokens: ThemeTokens): Record<string, string> {
  return {
    "--color-primary": tokens.colorPrimary,
    "--color-primary-light": tokens.colorPrimaryLight,
    "--color-primary-dark": tokens.colorPrimaryDark,
    "--color-secondary": tokens.colorSecondary,
    "--color-accent": tokens.colorAccent,
    "--color-background": tokens.colorBackground,
    "--color-surface": tokens.colorSurface,
    "--color-text": tokens.colorText,
    "--color-text-secondary": tokens.colorTextSecondary,
    "--color-border": tokens.colorBorder,
    "--color-success": tokens.colorSuccess,
    "--color-warning": tokens.colorWarning,
    "--color-error": tokens.colorError,
    "--font-family": tokens.fontFamily,
    "--font-size-base": tokens.fontSizeBase,
    "--font-size-sm": tokens.fontSizeSm,
    "--font-size-lg": tokens.fontSizeLg,
    "--font-size-xl": tokens.fontSizeXl,
    "--font-size-heading": tokens.fontSizeHeading,
    "--line-height": tokens.lineHeight,
    "--font-weight": tokens.fontWeight,
    "--border-radius": tokens.borderRadius,
    "--border-radius-lg": tokens.borderRadiusLg,
    "--touch-target": tokens.touchTarget,
    // Not "--spacing": Tailwind v4 uses that as its spacing unit, so emitting
    // it here silently scaled every p-/m-/w-/gap- utility 2–3×.
    "--band-spacing": tokens.spacing,
    "--card-padding": tokens.cardPadding,
    "--nav-icon-size": tokens.navIconSize,
    "--animation-duration": tokens.animationDuration,
  };
}
