/**
 * Study-scale load test for Findamine (production-safe).
 *
 *   node scripts/load-test/loadtest.mjs setup  <N>
 *   node scripts/load-test/loadtest.mjs burst                 # all N log in at once
 *   node scripts/load-test/loadtest.mjs soak   <VUs> <secs>   # sustained play-like traffic
 *   node scripts/load-test/loadtest.mjs teardown              # see teardown.sql
 *
 * Accounts: lt-###@loadtest.invalid, users.metadata.load_test = TAG, role adult,
 * research consent DECLINED (form_version 'loadtest') so enrollParticipant never
 * assigns a condition or writes study rows. Reads credentials from
 * .env.findamine-tanner.local. Writes state to scripts/load-test/.state.json.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { randomBytes, randomUUID } from "crypto";

const TAG = "lt_2026_11";
const DOMAIN = "loadtest.invalid";
const SITE = process.env.LT_SITE ?? "https://findamine-tanner.vercel.app";
const STATE = new URL("./.state.json", import.meta.url);

const env = Object.fromEntries(
  readFileSync(".env.findamine-tanner.local", "utf8")
    .split(/\r?\n/)
    .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()))
    .filter(Boolean)
    .map(([, k, v]) => [k, v.replace(/^"(.*)"$/, "$1")])
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const SRK = env.SUPABASE_SERVICE_ROLE_KEY;
const svc = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };

const BROWSER = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  "Accept-Language": "en-US,en;q=0.9",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const loadState = () => JSON.parse(readFileSync(STATE, "utf8"));

async function rest(path, init = {}) {
  const res = await fetch(`${SB}${path}`, { ...init, headers: { ...svc, ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function setup(n) {
  const password = `Lt-${randomBytes(9).toString("base64url")}`;
  const accounts = [];
  for (let i = 1; i <= n; i++) {
    const email = `lt-${String(i).padStart(3, "0")}@${DOMAIN}`;
    const authUser = await rest("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { load_test: TAG } }),
    });
    const [row] = await rest("/rest/v1/users", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        auth_id: authUser.id,
        email,
        display_name: `Load Test ${i}`,
        role: "adult",
        metadata: { load_test: TAG, demo_account: true },
      }),
    });
    accounts.push({ email, authId: authUser.id, userId: row.id });
    if (i % 25 === 0) console.log(`created ${i}/${n}`);
  }
  const ids = accounts.map((a) => a.userId);
  await rest("/rest/v1/user_profiles", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(ids.map((user_id) => ({ user_id, age_band: "adult" }))),
  });
  await rest("/rest/v1/consent_records", {
    method: "POST",
    body: JSON.stringify(
      ids.map((user_id) => ({ user_id, consent_type: "research", granted: false, form_version: "loadtest" }))
    ),
  });
  writeFileSync(STATE, JSON.stringify({ password, accounts }, null, 2));
  console.log(`setup done: ${n} accounts`);
}

/* ─── measurement ─── */
const stats = new Map();
function record(name, ms, status) {
  const s = stats.get(name) ?? { lat: [], codes: {} };
  s.lat.push(ms);
  s.codes[status] = (s.codes[status] ?? 0) + 1;
  stats.set(name, s);
}
const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))];
function report(wallSecs) {
  let total = 0;
  const rows = [];
  for (const [name, s] of [...stats].sort()) {
    s.lat.sort((a, b) => a - b);
    total += s.lat.length;
    const ok = Object.entries(s.codes).filter(([c]) => c < 400).reduce((a, [, v]) => a + v, 0);
    rows.push({
      endpoint: name,
      n: s.lat.length,
      ok_pct: +((100 * ok) / s.lat.length).toFixed(1),
      p50: pct(s.lat, 50),
      p95: pct(s.lat, 95),
      p99: pct(s.lat, 99),
      max: s.lat.at(-1),
      codes: JSON.stringify(s.codes),
    });
  }
  console.table(rows);
  if (wallSecs) console.log(`throughput: ${(total / wallSecs).toFixed(1)} req/s over ${wallSecs.toFixed(0)} s`);
  return rows;
}

async function timed(name, url, init = {}) {
  const t0 = performance.now();
  let status = 0;
  let res;
  try {
    res = await fetch(url, { redirect: "manual", ...init, headers: { ...BROWSER, ...(init.headers ?? {}) } });
    status = res.status;
    await res.arrayBuffer();
  } catch (e) {
    status = `ERR:${e.cause?.code ?? e.name}`;
  }
  record(name, Math.round(performance.now() - t0), status);
  return res;
}

async function login(acct, password) {
  const res = await timed("POST /api/v1/auth/login", `${SITE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email: acct.email, password }),
  });
  if (!res || res.status >= 400) return null;
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

async function burst() {
  const { password, accounts } = loadState();
  const t0 = performance.now();
  const cookies = await Promise.all(accounts.map((a) => login(a, password)));
  const wall = (performance.now() - t0) / 1000;
  console.log(`burst: ${cookies.filter(Boolean).length}/${accounts.length} logged in, wall ${wall.toFixed(1)} s`);
  report(wall);
}

/** One participant: log in, then loop through a play-like session. */
async function virtualUser(acct, password, until) {
  const cookie = acct.cookie ?? (await login(acct, password));
  if (!cookie) return;
  const page = (p) => timed(`GET ${p}`, `${SITE}${p}`, { headers: { Cookie: cookie, Accept: "text/html" } });
  const api = (p, init = {}) =>
    timed(`${init.method ?? "GET"} ${p}`, `${SITE}${p}`, {
      ...init,
      headers: { Cookie: cookie, Accept: "application/json", "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
  const sessionId = randomUUID();
  while (Date.now() < until) {
    await page("/dashboard");
    await api("/api/v1/notifications");
    await sleep(1500 + Math.random() * 3000);
    await page("/browse");
    await sleep(1500 + Math.random() * 3000);
    await page("/settings/privacy");
    await page("/surveys");
    // Telemetry shape the new instrumentation will send (batched screen views).
    await api("/api/v1/events/batch", {
      method: "POST",
      body: JSON.stringify({
        events: Array.from({ length: 10 }, (_, i) => ({
          session_id: sessionId,
          event_type: "load_test",
          event_name: `screen_view_${i}`,
          payload: { load_test: TAG },
        })),
      }),
    });
    await sleep(2000 + Math.random() * 4000);
    await page("/leaderboard");
    await sleep(1500 + Math.random() * 3000);
  }
}

async function soak(vus, secs) {
  const { password, accounts } = loadState();
  // Reuse saved sessions round-robin (several VUs may share one account).
  const withCookie = accounts.filter((a) => a.cookie);
  const pool = withCookie.length ? withCookie : accounts;
  const users = Array.from({ length: vus }, (_, i) => pool[i % pool.length]);
  const until = Date.now() + secs * 1000;
  const t0 = performance.now();
  // Ramp: start users over the first 20% of the run.
  const rampMs = (secs * 1000 * 0.2) / users.length;
  await Promise.all(users.map((a, i) => sleep(i * rampMs).then(() => virtualUser(a, password, until))));
  report((performance.now() - t0) / 1000);
}

/** Log every account in at `perSec` and save session cookies for soak runs. */
async function loginAll(perSec) {
  const state = loadState();
  const out = [];
  for (const [i, a] of state.accounts.entries()) {
    out.push(sleep((i * 1000) / perSec).then(() => login(a, state.password)).then((cookie) => ({ ...a, cookie })));
  }
  const accounts = await Promise.all(out);
  writeFileSync(STATE, JSON.stringify({ ...state, accounts }, null, 2));
  console.log(`logged in ${accounts.filter((a) => a.cookie).length}/${accounts.length} at ${perSec}/s`);
  report();
}

const [cmd, a1, a2] = process.argv.slice(2);
if (cmd === "setup") await setup(Number(a1 ?? 100));
else if (cmd === "login-all") await loginAll(Number(a1 ?? 3));
else if (cmd === "burst") await burst();
else if (cmd === "soak") await soak(Number(a1 ?? 50), Number(a2 ?? 180));
else {
  if (!existsSync(STATE)) console.log("no state file");
  console.log("usage: setup <N> | burst | soak <VUs> <secs>; teardown via teardown.sql");
}
