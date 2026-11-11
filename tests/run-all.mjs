/**
 * npm test — runs the integration suites (requires a prior `npm run build` for the HTTP suite).
 * Uses an in-memory MongoDB and fakes for Razorpay/Cloudinary; never touches real services.
 */
import { spawnSync } from "child_process";

const isWin = process.platform === "win32";
const suites = [
  ["Payment flow (service level)", isWin ? "npx.cmd" : "npx", ["tsx", "tests/payment-flow.test.mjs"]],
  ["HTTP end-to-end (next start)", process.execPath, ["tests/http.test.mjs"]],
];

let failed = 0;
for (const [name, cmd, args] of suites) {
  console.log(`\n================ ${name} ================`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: isWin && cmd.endsWith(".cmd") });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} suite(s) FAILED` : "\nAll suites passed");
process.exit(failed ? 1 : 0);
