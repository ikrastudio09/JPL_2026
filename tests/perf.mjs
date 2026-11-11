/**
 * Performance verification (in-memory MongoDB, 5,000 seeded players, production build).
 *
 *   npm run build && node tests/perf.mjs
 *
 * 1. MongoDB execution plans for the admin query shapes — original indexes vs. added indexes.
 * 2. HTTP timings: old dashboard request pattern vs. new pattern.
 */
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { TEST_ENV } from "./helpers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const N = 5000;
const PORT = 3998;
const BASE = `http://127.0.0.1:${PORT}`;

const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
const MONGODB_URI = rs.getUri("jpl_perf");
await mongoose.connect(MONGODB_URI);
const col = mongoose.connection.collection("players");

/* ── seed ── */
const STATUSES = ["pending", "pending", "pending", "approved", "rejected"];
const PROFS = ["Software Developer", "Doctor", "Student", "Retired", "Other", "Trader / Wholesale / Distributor"];
const ROLES = ["Batsman", "Bowler", "All Rounder"];
const base = Date.now() - N * 60000;
const docs = [];
for (let i = 0; i < N; i++) {
  docs.push({
    playerID: i + 1,
    playerName: `Player ${i} ${["Sharma", "Patil", "Jain", "Shah", "Kulkarni"][i % 5]}`,
    playerPhone: `9${String(100000000 + i).slice(-9)}`,
    dateOfBirth: new Date(1980 + (i % 25), i % 12, 1 + (i % 27)),
    bloodGroup: ["A+", "B+", "O+", "AB+"][i % 4],
    fatherName: `Father ${i}`,
    profession: PROFS[i % PROFS.length],
    playingStyle: ["Right Arm Batting"],
    playerType: ROLES[i % 3],
    previousTeam: "N/A",
    previousPerformance: Array.from({ length: 3 }, (_, y) => ({ year: 2023 + y, matches: 5, runs: 100, wickets: 2, fielding: 1 })),
    playerAddress: [{ AddressLine1: `${i} Long Street Name, Some Colony`, City: "Sangli", State: "Maharashtra", PinCode: "416416", Country: "India" }],
    tShirtSize: "L",
    tShirtNumber: i % 10000,
    tShirtName: `NAME${i}`,
    playerPhoto: { url: `https://res.cloudinary.com/demo/image/upload/v1/cricket_tournament/player_photos/p${i}.jpg`, public_id: `p${i}` },
    paymentScreenshot: { url: `https://res.cloudinary.com/demo/image/upload/v1/s${i}.jpg`, public_id: `s${i}` },
    transactionId: `UTR${String(i).padStart(10, "0")}`,
    status: STATUSES[i % STATUSES.length],
    playerPool: i % 9,
    playerCategory: "Undefined",
    // bulk imports share timestamps — exercises pagination stability
    createdAt: new Date(base + Math.floor(i / 10) * 60000),
    updatedAt: new Date(),
  });
}
await col.insertMany(docs);

/* ── 1. execution plans ── */
const ORIGINAL_INDEXES = [
  [{ playerID: 1 }, { unique: true }],
  [{ transactionId: 1 }, { unique: true }],
  [{ playerPhone: 1 }, {}],
  [{ status: 1 }, {}],
  [{ createdAt: -1 }, {}],
  [{ profession: 1 }, {}],
  [{ tShirtNumber: 1 }, {}],
];
// Only index added to Player (models/Player.js). Filter-specific compound indexes such as
// { status: 1, createdAt: -1, _id: -1 } were evaluated and rejected (≈1 ms gain at 5k docs).
const ADDED_INDEXES = [[{ createdAt: -1, _id: -1 }, {}]];

const SORT = { createdAt: -1, _id: -1 };
const QUERIES = [
  ["Default list (sort createdAt, page 1)", {}, SORT],
  ["Default list, page 100 (skip 1980)", {}, SORT, 1980],
  ["Status filter (stat cards / dropdown)", { status: "pending" }, SORT],
  ["Pool filter", { playerPool: 3 }, SORT],
  ["Profession filter", { profession: "Doctor" }, SORT],
  ["Role filter", { playerType: "Bowler" }, SORT],
  ["Text search (name/phone/txn regex)", { $or: [{ playerName: { $regex: "patil", $options: "i" } }, { playerPhone: { $regex: "patil", $options: "i" } }, { transactionId: { $regex: "patil", $options: "i" } }] }, SORT],
];

function summarize(stats) {
  const stages = [];
  (function walk(s) {
    if (!s) return;
    stages.push(s.stage + (s.indexName ? `(${s.indexName})` : ""));
    walk(s.inputStage);
    (s.inputStages || []).forEach(walk);
  })(stats.executionStages);
  return { ms: stats.executionTimeMillis, keys: stats.totalKeysExamined, docs: stats.totalDocsExamined, plan: stages.join(" ← ") };
}

async function explainAll(label, sortOverride) {
  console.log(`\n── Execution plans: ${label} (${N} players) ──`);
  for (const [name, filter, sort, skip = 0] of QUERIES) {
    const ex = await col.find(filter).sort(sortOverride || sort).skip(skip).limit(20).explain("executionStats");
    const s = summarize(ex.executionStats);
    console.log(`${name.padEnd(42)} ${String(s.ms).padStart(4)}ms  keys=${String(s.keys).padStart(5)} docs=${String(s.docs).padStart(5)}  ${s.plan}`);
  }
}

await col.dropIndexes();
for (const [k, o] of ORIGINAL_INDEXES) await col.createIndex(k, o);
await explainAll("BEFORE — original indexes, original sort { createdAt: -1 }", { createdAt: -1 });
await explainAll("original indexes + new stable sort (shows why new indexes are needed)");
for (const [k, o] of ADDED_INDEXES) await col.createIndex(k, o);
await explainAll("AFTER — original + added compound indexes, stable sort");

// pagination stability check with shared timestamps
const page1 = await col.find({}).sort(SORT).limit(20).project({ _id: 1 }).toArray();
const page2 = await col.find({}).sort(SORT).skip(20).limit(20).project({ _id: 1 }).toArray();
const overlap = page1.filter((a) => page2.some((b) => String(b._id) === String(a._id))).length;
console.log(`\nPagination stability (10 records share each createdAt): page1∩page2 overlap = ${overlap}`);

await mongoose.disconnect();

/* ── 2. HTTP timings ── */
const env = {
  ...process.env, ...TEST_ENV, NODE_ENV: "production", MONGODB_URI, PORT: String(PORT),
  ADMIN_PASSWORD_HASH: await bcrypt.hash("perf-test-password", 10),
};
const server = spawn(process.execPath, [path.join(ROOT, "node_modules/next/dist/bin/next"), "start", "-p", String(PORT)], { cwd: ROOT, env, stdio: "ignore" });
try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/api/register`, { method: "POST" })).status) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  const lr = await fetch(`${BASE}/api/admin/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "perf-test-password" }),
  });
  const cookie = lr.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const get = async (url) => {
    const t = performance.now();
    const r = await fetch(BASE + url, { headers: { Cookie: cookie } });
    const buf = await r.arrayBuffer();
    return { ms: performance.now() - t, bytes: buf.byteLength, status: r.status };
  };
  const median = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];

  async function measure(label, urls, runs = 7) {
    await Promise.all(urls.map(get)); // warm-up
    const times = [];
    let bytes = 0;
    for (let i = 0; i < runs; i++) {
      const t = performance.now();
      const results = [];
      for (const u of urls) results.push(await get(u)); // sequential, like the old effects chain
      times.push(performance.now() - t);
      bytes = results.reduce((s, r) => s + r.bytes, 0);
      if (results.some((r) => r.status !== 200)) throw new Error("non-200 in " + label);
    }
    console.log(`${label.padEnd(58)} median ${median(times).toFixed(0).padStart(5)} ms   payload ${(bytes / 1024).toFixed(0).padStart(6)} KB   requests ${urls.length}`);
  }

  console.log(`\n── HTTP: admin dashboard (${N} players, production build) ──`);
  await measure("BEFORE dashboard load (2× list + 2× limit=10000 for stats)", [
    "/api/players?page=1&limit=20", "/api/players?limit=10000", "/api/players?page=1&limit=20", "/api/players?limit=10000",
  ]);
  await measure("AFTER dashboard load (1× list + 1× aggregated stats)", ["/api/players?page=1&limit=20", "/api/players/stats"]);
  await measure("BEFORE stats only (limit=10000 download + client count)", ["/api/players?limit=10000"]);
  await measure("AFTER stats only (/api/players/stats aggregation)", ["/api/players/stats"]);
  await measure("BEFORE filter change (2 list requests)", ["/api/players?page=1&limit=20&status=pending", "/api/players?page=1&limit=20&status=pending"]);
  await measure("AFTER filter change (1 list request)", ["/api/players?page=1&limit=20&status=pending"]);
  await measure("Pool filter", ["/api/players?page=1&limit=20&playerPool=4"]);
  await measure("Search 'patil'", ["/api/players?page=1&limit=20&search=patil"]);
  await measure("Deep page (page 200)", ["/api/players?page=200&limit=20"]);
} finally {
  server.kill();
  await rs.stop();
}
