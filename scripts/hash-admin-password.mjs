#!/usr/bin/env node
/**
 * Generate ADMIN_PASSWORD_HASH (bcrypt, cost 12) and a random ADMIN_SESSION_SECRET.
 *
 *   npm run hash-password            # prompts for the password (input hidden)
 *
 * The plain password is never written anywhere.
 */
import bcrypt from "bcryptjs";
import crypto from "crypto";
import readline from "readline";

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = function (str) {
      if (str.includes(question)) rl.output.write(str);
      else rl.output.write("*");
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

const password = await promptHidden("New admin password (min 12 characters): ");
if (!password || password.length < 12) {
  console.error("Password must be at least 12 characters.");
  process.exit(1);
}
const confirm = await promptHidden("Confirm password: ");
if (confirm !== password) {
  console.error("Passwords do not match.");
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);
const secret = crypto.randomBytes(48).toString("base64url");

// Next.js expands "$NAME" inside .env files (even inside quotes), which would corrupt a
// bcrypt hash — so every "$" must be escaped as "\$" in .env / .env.local files.
console.log("\n── For .env.local (local development) ──\n");
console.log(`ADMIN_PASSWORD_HASH=${hash.replace(/\$/g, "\\$")}`);
console.log(`ADMIN_SESSION_SECRET=${secret}`);
console.log("\n── For the Vercel / hosting dashboard (paste values exactly, no escaping) ──\n");
console.log(`ADMIN_PASSWORD_HASH  =  ${hash}`);
console.log(`ADMIN_SESSION_SECRET =  ${secret}\n`);
