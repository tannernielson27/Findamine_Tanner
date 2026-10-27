#!/usr/bin/env node
/**
 * Renders the Android launcher icons and launch splash from public/icon.svg,
 * matching the iOS assets (scripts/ios-assets.mjs). Run with
 * `npm run android:assets`; the output is committed, so this is only needed
 * when the mark changes.
 *
 * - Adaptive icon (Android 8+): the compass on a transparent 108dp foreground,
 *   inside the 66dp safe zone, over the paper colour
 *   (values/ic_launcher_background.xml).
 * - Legacy square and round icons for older launchers.
 * - Splash: the compass centred on paper, at each density and orientation.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const res = resolve(root, "android/app/src/main/res");
const PAPER = "#FEFCF6";
const mark = readFileSync(resolve(root, "public/icon.svg"));

/** px per dp, by density bucket. */
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
/** Capacitor's template splash sizes (portrait); landscape is the same, swapped. */
const SPLASH_PORTRAIT = {
  mdpi: [320, 480],
  hdpi: [480, 800],
  xhdpi: [720, 1280],
  xxhdpi: [960, 1600],
  xxxhdpi: [1280, 1920],
};

async function renderMark(size) {
  return sharp(mark, { density: Math.ceil((72 * size) / 32) }).resize(size, size).png().toBuffer();
}

function backgroundSvg(width, height, glow, round) {
  const shape = round
    ? `<circle cx="${width / 2}" cy="${height / 2}" r="${width / 2}" fill="${PAPER}"/><circle cx="${width / 2}" cy="${height / 2}" r="${width / 2}" fill="url(#g)"/>`
    : `<rect width="100%" height="100%" fill="${PAPER}"/><rect width="100%" height="100%" fill="url(#g)"/>`;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <radialGradient id="g" cx="50%" cy="46%" r="60%">
          <stop offset="0%" stop-color="#BAE6FD" stop-opacity="${glow}"/>
          <stop offset="100%" stop-color="${PAPER}" stop-opacity="0"/>
        </radialGradient>
      </defs>
      ${shape}
    </svg>`
  );
}

async function compose(width, height, markSize, glow, { round = false } = {}) {
  const markPng = await renderMark(markSize);
  return sharp(backgroundSvg(width, height, glow, round))
    .composite([{ input: markPng, left: Math.round((width - markSize) / 2), top: Math.round((height - markSize) / 2) }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function foreground(size) {
  const markSize = Math.round(size * 0.56);
  const markPng = await renderMark(markSize);
  const offset = Math.round((size - markSize) / 2);
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: markPng, left: offset, top: offset }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function write(relPath, buffer) {
  const out = resolve(res, relPath);
  if (!existsSync(dirname(out))) throw new Error(`missing resource folder for ${relPath}; run npx cap add android first`);
  writeFileSync(out, buffer);
}

for (const [bucket, scale] of Object.entries(DENSITIES)) {
  const legacy = Math.round(48 * scale);
  write(`mipmap-${bucket}/ic_launcher.png`, await compose(legacy, legacy, Math.round(legacy * 0.68), 0.85));
  write(`mipmap-${bucket}/ic_launcher_round.png`, await compose(legacy, legacy, Math.round(legacy * 0.62), 0.85, { round: true }));
  write(`mipmap-${bucket}/ic_launcher_foreground.png`, await foreground(Math.round(108 * scale)));

  const [w, h] = SPLASH_PORTRAIT[bucket];
  const markSize = Math.round(Math.min(w, h) * 0.32);
  write(`drawable-port-${bucket}/splash.png`, await compose(w, h, markSize, 0.5));
  write(`drawable-land-${bucket}/splash.png`, await compose(h, w, markSize, 0.5));
}
write("drawable/splash.png", await compose(480, 320, 102, 0.5));

console.log("android-assets: launcher icons (legacy, round, adaptive foreground) and splash at 5 densities");
