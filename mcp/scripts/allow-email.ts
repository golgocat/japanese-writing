import { spawnSync } from "node:child_process";
import { normalizeEmail, parseAllowlist } from "../src/allowlist.ts";

const email = normalizeEmail(process.argv[2] ?? "");
if (!email) {
  console.error("Usage: npm run allow-email -- person@example.com");
  process.exit(1);
}

const args = [
  "wrangler",
  "kv",
  "key",
  "get",
  "emails",
  "--binding",
  "ALLOWLIST",
  "--env",
  "production",
  "--remote",
];
const current = spawnSync("npx", args, { encoding: "utf8" });
const raw = current.status === 0 ? current.stdout : "";
if (current.status !== 0 && !/not found|404/i.test(`${current.stderr}\n${current.stdout}`)) {
  console.error(current.stderr || current.stdout);
  process.exit(current.status ?? 1);
}

const next = [...new Set([...parseAllowlist(raw), email])];
const put = spawnSync(
  "npx",
  [
    "wrangler",
    "kv",
    "key",
    "put",
    "emails",
    JSON.stringify(next),
    "--binding",
    "ALLOWLIST",
    "--env",
    "production",
    "--remote",
  ],
  { encoding: "utf8" },
);
if (put.status !== 0) {
  console.error(put.stderr || put.stdout);
  process.exit(put.status ?? 1);
}
console.log(`Allowlist size is now ${next.length}.`);
