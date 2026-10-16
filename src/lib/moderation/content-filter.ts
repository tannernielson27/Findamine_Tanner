/**
 * Objectionable-content filter for user-generated text (App Store guideline
 * 1.2: "a method for filtering objectionable material").
 *
 * Pure and dependency-free so it runs the same in route handlers and tests.
 * Text is normalised before matching so the usual evasions still match:
 *   - case, accents, full-width and look-alike (Cyrillic/Greek) letters
 *   - leetspeak (sh1t, f@g, $lut) and masking (f*ck, sh**)
 *   - stretched letters (fuuuuck) and spaced/dotted letters (f u c k, s.h.i.t)
 *
 * Terms match whole words (plus common suffixes) unless marked `inside`, which
 * keeps innocent words like "class", "hello", "Scunthorpe" or "grape" clean.
 *
 * Two levels:
 *   standard - everyone: slurs, strong profanity, sexual content, threats and
 *              self-harm encouragement.
 *   strict   - children: everything above plus mild swearing and insults.
 */

export type FilterLevel = "standard" | "strict";

export type FilterCategory = "slur" | "profanity" | "sexual" | "harassment" | "self_harm" | "insult";

export type FilterResult =
  | { allowed: true }
  | { allowed: false; category: FilterCategory; level: FilterLevel };

interface Term {
  /** Lowercase letters; a space separates the words of a phrase. */
  text: string;
  category: FilterCategory;
  level: FilterLevel;
  /** Match anywhere inside a word (only for roots with no innocent superstrings). */
  inside?: boolean;
}

const t = (
  category: FilterCategory,
  level: FilterLevel,
  words: string[],
  inside = false
): Term[] => words.map((text) => ({ text, category, level, inside }));

const TERMS: Term[] = [
  // ── Slurs (standard) ─────────────────────────────────────────
  ...t("slur", "standard", ["nigger", "nigga", "faggot", "retard"], true),
  ...t("slur", "standard", [
    "fag", "spic", "chink", "kike", "wetback", "dyke", "tranny", "coon", "gook",
    "beaner", "raghead", "towelhead", "kkk", "heil hitler", "white power",
  ]),
  // ── Strong profanity (standard) ──────────────────────────────
  ...t("profanity", "standard", ["fuck", "shit", "bitch", "asshole", "dumbass", "jackass", "dickhead", "motherf"], true),
  ...t("profanity", "standard", ["cunt", "bastard", "twat", "wanker", "prick", "dick", "cock", "bullshit", "wtf", "stfu", "fml"]),
  // ── Sexual (standard) ────────────────────────────────────────
  ...t("sexual", "standard", ["porn", "blowjob", "handjob", "dildo", "whore", "slut", "hentai"], true),
  ...t("sexual", "standard", [
    "pussy", "horny", "cum", "jizz", "nudes", "rape", "raping", "rapist", "milf", "boner", "tits",
    "send nudes", "jerk off", "suck my", "sit on my face",
  ]),
  // ── Threats and self-harm encouragement (standard) ───────────
  ...t("self_harm", "standard", [
    "kys", "kill yourself", "kill urself", "kill ur self", "kill your self", "go die",
    "hope you die", "hope u die", "neck yourself", "slit your wrists", "end yourself",
  ]),
  ...t("harassment", "standard", [
    "i will kill you", "ill kill you", "i ll kill you", "im going to kill you", "i will hurt you",
    "i know where you live",
  ]),
  // ── Mild swearing and insults (strict / children only) ──────
  ...t("profanity", "strict", ["damn", "hell", "crap", "piss", "ass", "arse", "frick", "freaking", "sucks"]),
  ...t("sexual", "strict", ["sex", "sexy", "boobs", "penis", "vagina", "naked", "nude", "kiss me"]),
  ...t("insult", "strict", [
    "stupid", "idiot", "dumb", "moron", "loser", "ugly", "fatso", "fatty", "freak", "weirdo",
    "dummy", "shut up", "hate you", "you suck", "nobody likes you", "go away", "lame",
  ]),
];

/** Endings allowed after a whole-word term (fucks, bitches, retarded, crappy...). */
const SUFFIX = "(?:s|es|ed|er|ers|ing|y|ies|z)?";

/** Real words a term would otherwise catch (whole tokens, after normalising). */
const ALLOWED_TOKENS = new Set(["cocky", "spicy", "shiitake", "shitake", "cumin", "scunthorpe", "dickens"]);

/** Letters and their look-alikes / leetspeak stand-ins. */
const CHAR_MAP: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b",
  "@": "a", "$": "s", "!": "i", "|": "i", "+": "t", "€": "e", "£": "l",
  // Cyrillic and Greek homoglyphs
  "а": "a", "в": "b", "е": "e", "к": "k", "м": "m", "н": "h", "о": "o", "р": "p",
  "с": "c", "т": "t", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s",
  "α": "a", "β": "b", "ε": "e", "ι": "i", "κ": "k", "ν": "v", "ο": "o", "ρ": "p",
  "τ": "t", "υ": "u", "χ": "x",
};

const ZERO_WIDTH = /[​-‍⁠﻿­]/g;
const COMBINING = /\p{M}+/gu;
/** Characters kept inside a token: letters, the leet stand-ins above, and "*" masks. */
const TOKEN_CHARS = /[\p{L}0-9@$!|+€£*]+/gu;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Pattern for one word: every letter may repeat (fuuuck), and after the first
 * letter any letter may be masked with "*" (f*ck, sh**).
 */
function wordPattern(word: string): string {
  return [...word]
    .map((ch, i) => {
      const c = escapeRegExp(ch);
      return i === 0 ? `${c}+` : `(?:${c}|\\*)+`;
    })
    .join("");
}

interface CompiledTerm extends Term {
  re: RegExp;
}

function compile(term: Term): CompiledTerm {
  const words = term.text.split(" ");
  const body = words.map(wordPattern).join(" ");
  const source = term.inside ? body : `(?:^| )${body}${SUFFIX}(?= |$)`;
  return { ...term, re: new RegExp(source) };
}

const COMPILED: CompiledTerm[] = TERMS.map(compile);

/** Normalise one token: map look-alikes, drop anything that isn't a letter or mask. */
function normaliseToken(raw: string): string {
  // Trailing "!" / "|" are punctuation ("wow!!"), not leetspeak.
  const trimmed = raw.replace(/[!|]+$/, "");
  let out = "";
  for (const ch of trimmed) {
    const mapped = CHAR_MAP[ch] ?? ch;
    if (/[a-z*]/.test(mapped)) out += mapped;
  }
  // A token that is only masks ("***") carries no letters to match.
  return /[a-z]/.test(out) ? out : "";
}

/**
 * Normalise text into a space-separated string of tokens. Runs of three or
 * more single letters ("f u c k", "s.h.i.t") are also joined into one token.
 */
export function normalizeForFilter(text: string): string {
  const base = text.normalize("NFKD").replace(ZERO_WIDTH, "").replace(COMBINING, "").toLowerCase();
  const tokens = (base.match(TOKEN_CHARS) || []).map(normaliseToken).filter(Boolean);

  const joined: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length >= 3) joined.push(run.join(""));
    run = [];
  };
  for (const tok of tokens) {
    if (tok.length === 1) run.push(tok);
    else flush();
  }
  flush();

  return [...tokens, ...joined].filter((tok) => !ALLOWED_TOKENS.has(tok)).join(" ");
}

/** Check text against the filter. Children should be checked at "strict". */
export function checkText(text: string, level: FilterLevel = "standard"): FilterResult {
  if (!text) return { allowed: true };
  const normalised = normalizeForFilter(text);
  if (!normalised) return { allowed: true };

  for (const term of COMPILED) {
    if (term.level === "strict" && level !== "strict") continue;
    if (term.re.test(normalised)) {
      return { allowed: false, category: term.category, level: term.level };
    }
  }
  return { allowed: true };
}

/** Children get the strictest filter; everyone else the standard one. */
export function filterLevelForRole(role: string | null | undefined): FilterLevel {
  return role === "child" ? "strict" : "standard";
}
