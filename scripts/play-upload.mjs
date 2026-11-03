#!/usr/bin/env node
/**
 * Uploads the signed Android bundle to Google Play through the Play Developer
 * API, using a service account. Run with `npm run android:upload -- [options]`.
 *
 *   --check            sign in and show the latest uploaded versionCode and the
 *                      track's releases, then discard the edit (changes nothing)
 *   --track <name>     production (default), beta, alpha or internal
 *   --aab <path>       bundle to upload (default: the gradle bundleRelease output)
 *   --notes <text>     en-US release notes
 *   --submit           make the release live on the track, which sends it to
 *                      Google for review. Without it the release is saved as a
 *                      draft for you to send from Publishing overview.
 *
 * The key file is read from PLAY_SERVICE_ACCOUNT, or by default from
 * ~/Desktop/Findamine/android-signing/play-service-account.json (outside the
 * repo, next to the upload key). See docs/android-build.md for how to make one.
 */
import { createSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_NAME = "app.findamine";
const TRACKS = ["production", "beta", "alpha", "internal"];
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}`;
const UPLOAD_API = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE_NAME}`;
const DEFAULT_KEY = resolve(homedir(), "Desktop/Findamine/android-signing/play-service-account.json");
const DEFAULT_AAB = resolve(root, "android/app/build/outputs/bundle/release/app-release.aab");

function fail(message) {
  console.error(`play-upload: ${message}`);
  process.exit(1);
}

function readOptions() {
  const { values } = parseArgs({
    options: {
      check: { type: "boolean", default: false },
      track: { type: "string", default: "production" },
      aab: { type: "string", default: DEFAULT_AAB },
      notes: { type: "string" },
      submit: { type: "boolean", default: false },
    },
  });
  if (!TRACKS.includes(values.track)) fail(`--track must be one of ${TRACKS.join(", ")}`);
  if (!values.check && !existsSync(values.aab)) fail(`bundle not found: ${values.aab}`);
  return values;
}

function readServiceAccount() {
  const path = process.env.PLAY_SERVICE_ACCOUNT || DEFAULT_KEY;
  if (!existsSync(path)) fail(`service account key not found: ${path}`);
  const key = JSON.parse(readFileSync(path, "utf8"));
  if (key.type !== "service_account" || !key.client_email || !key.private_key) {
    fail(`${path} is not a service account key file`);
  }
  return key;
}

const base64url = (input) => Buffer.from(input).toString("base64url");

/** Trades a signed JWT for a one-hour OAuth access token. */
async function getAccessToken(key) {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = key.token_uri || "https://oauth2.googleapis.com/token";
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 3600 })
  );
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(key.private_key, "base64url");

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  const body = await res.json();
  if (!res.ok) fail(`sign-in failed (${res.status}): ${body.error_description || body.error}`);
  return body.access_token;
}

function apiClient(token) {
  return async function call(method, url, { json, data, contentType } = {}) {
    const headers = { Authorization: `Bearer ${token}` };
    let body;
    if (json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(json);
    } else if (data !== undefined) {
      headers["Content-Type"] = contentType;
      body = data;
    }
    const res = await fetch(url, { method, headers, body });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const error = new Error(parsed.error?.message || `${method} ${url} returned ${res.status}`);
      error.status = res.status;
      throw error;
    }
    return parsed;
  };
}

function describeTrack(track) {
  const releases = track.releases ?? [];
  if (releases.length === 0) return "no releases";
  return releases
    .map((r) => `${r.name ?? "(unnamed)"} [${r.status}] versionCodes ${(r.versionCodes ?? []).join(", ")}`)
    .join("; ");
}

async function check(call, editUrl, trackName) {
  const { bundles = [] } = await call("GET", `${editUrl}/bundles`);
  const latest = bundles.reduce((max, b) => Math.max(max, b.versionCode), 0);
  const track = await call("GET", `${editUrl}/tracks/${trackName}`);
  console.log(`Signed in. Latest uploaded versionCode: ${latest || "none"}.`);
  console.log(`${trackName}: ${describeTrack(track)}`);
  console.log(`The next upload needs versionCode ${latest + 1} or higher in android/app/build.gradle.`);
}

async function upload(call, editUrl, editId, options) {
  console.log(`Uploading ${options.aab} ...`);
  const bundle = await call(
    "POST",
    `${UPLOAD_API}/edits/${editId}/bundles?uploadType=media`,
    { data: readFileSync(options.aab), contentType: "application/octet-stream" }
  );
  console.log(`Uploaded versionCode ${bundle.versionCode}.`);

  const release = {
    versionCodes: [String(bundle.versionCode)],
    status: options.submit ? "completed" : "draft",
    ...(options.notes ? { releaseNotes: [{ language: "en-US", text: options.notes }] } : {}),
  };
  await call("PUT", `${editUrl}/tracks/${options.track}`, {
    json: { track: options.track, releases: [release] },
  });
  await call("POST", `${editUrl}:commit`);

  console.log(
    options.submit
      ? `Committed to ${options.track} and sent to Google for review.`
      : `Saved as a draft on ${options.track}. Send it from Publishing overview in Play Console, or rerun with --submit.`
  );
}

async function main() {
  const options = readOptions();
  const call = apiClient(await getAccessToken(readServiceAccount()));
  const { id: editId } = await call("POST", `${API}/edits`);
  const editUrl = `${API}/edits/${editId}`;

  try {
    if (options.check) {
      await check(call, editUrl, options.track);
      await call("DELETE", editUrl);
    } else {
      await upload(call, editUrl, editId, options);
    }
  } catch (error) {
    // An uncommitted edit would block the next run until it expires.
    await call("DELETE", editUrl).catch(() => {});
    if (error.status === 401 || error.status === 403) {
      fail(`${error.message}\nIs the service account invited in Play Console (Users and permissions) with release access to this app?`);
    }
    fail(error.message);
  }
}

main().catch((error) => fail(error.message));
