#!/usr/bin/env node
/**
 * Upload resized scene images to Supabase Storage.
 * Run: node scripts/upload-scene-images.mjs
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.
 * SCENE_IMAGE_DIR overrides the folder of resized PNGs to upload.
 * Creates a 'hero-scenes' bucket if it doesn't exist.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const BUCKET = "hero-scenes";
const IMAGE_DIR = process.env.SCENE_IMAGE_DIR || "../6-Apps/EdTech/Findamine/hero-images/resized";

async function main() {
  // Create bucket if needed (public for CDN access)
  const { error: bucketError } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    fileSizeLimit: 5 * 1024 * 1024, // 5MB
  });
  if (bucketError && !bucketError.message.includes("already exists")) {
    console.error("Bucket creation failed:", bucketError.message);
    process.exit(1);
  }
  console.log(`Bucket '${BUCKET}' ready.`);

  // Upload each image
  const files = readdirSync(IMAGE_DIR).filter((f) => f.endsWith(".png"));
  console.log(`Found ${files.length} images to upload.`);

  for (const file of files) {
    const filePath = join(IMAGE_DIR, file);
    const fileData = readFileSync(filePath);

    const { error } = await supabase.storage.from(BUCKET).upload(file, fileData, {
      contentType: "image/png",
      upsert: true,
    });

    if (error) {
      console.error(`  ✗ ${file}: ${error.message}`);
    } else {
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(file);
      console.log(`  ✓ ${file} → ${data.publicUrl}`);
    }
  }

  // Print the base URL for hero-banner.ts
  const { data: example } = supabase.storage.from(BUCKET).getPublicUrl("scene-adventure-day.png");
  const baseUrl = example.publicUrl.replace("scene-adventure-day.png", "");
  console.log(`\nBase URL for hero-banner.ts:\n  const SCENE_BASE = "${baseUrl}";`);
}

main().catch(console.error);
