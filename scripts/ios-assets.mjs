#!/usr/bin/env node
/**
 * Renders the iOS app icon and launch splash from public/icon.svg (the
 * compass mark used for the favicon and PWA icons) into the Xcode asset
 * catalog. Run with `npm run ios:assets`; the output is committed, so this is
 * only needed when the mark changes.
 *
 * - AppIcon: 1024x1024 PNG, no alpha channel (App Store requirement), compass
 *   on the app's warm paper background with a soft sky glow. iOS applies the
 *   rounded-corner mask itself.
 * - Splash: 2732x2732 PNG (Capacitor's template size, drawn aspect-fill), the
 *   compass centred on the same paper colour as capacitor.config.ts
 *   backgroundColor, so launch -> web app has no colour flash.
 *
 * Uses sharp, which Next.js already installs. (@capacitor/assets would do the
 * same, but its current release pins @capacitor/cli 5.)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = resolve(root, "ios/App/App/Assets.xcassets");
const PAPER = "#FEFCF6";

const mark = readFileSync(resolve(root, "public/icon.svg"));

async function renderMark(size) {
  return sharp(mark, { density: Math.ceil((72 * size) / 32) }).resize(size, size).png().toBuffer();
}

function backgroundSvg(size, glow) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <defs>
        <radialGradient id="g" cx="50%" cy="46%" r="60%">
          <stop offset="0%" stop-color="#BAE6FD" stop-opacity="${glow}"/>
          <stop offset="100%" stop-color="${PAPER}" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="${PAPER}"/>
      <rect width="100%" height="100%" fill="url(#g)"/>
    </svg>`
  );
}

async function compose(size, markSize, glow) {
  const markPng = await renderMark(markSize);
  const offset = Math.round((size - markSize) / 2);
  return sharp(backgroundSvg(size, glow))
    .composite([{ input: markPng, left: offset, top: offset }])
    .flatten({ background: PAPER })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const icon = await compose(1024, 700, 0.85);
writeFileSync(resolve(catalog, "AppIcon.appiconset/AppIcon-512@2x.png"), icon);

const splash = await compose(2732, 420, 0.5);
for (const name of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
  writeFileSync(resolve(catalog, "Splash.imageset", name), splash);
}

const meta = await sharp(icon).metadata();
console.log(`ios-assets: icon ${meta.width}x${meta.height} alpha=${meta.hasAlpha}; splash 2732x2732 x3`);
