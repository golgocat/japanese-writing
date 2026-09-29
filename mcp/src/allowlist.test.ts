import assert from "node:assert/strict";
import { test } from "node:test";
import { isEmailAllowed, normalizeEmail, parseAllowlist } from "./allowlist.ts";

test("normalizes a registered email and rejects a colon", () => {
  assert.equal(normalizeEmail("  Ada@Example.com "), "ada@example.com");
  assert.equal(normalizeEmail("ada:bob@example.com"), null);
  assert.equal(normalizeEmail("not-an-email"), null);
});

test("reads only valid addresses from the stored list", () => {
  assert.deepEqual(
    parseAllowlist('["Ada@Example.com", "nope", 3]'),
    ["ada@example.com"],
  );
  assert.deepEqual(parseAllowlist("not json"), []);
  assert.deepEqual(parseAllowlist(null), []);
});

test("allows an address only when the stored list contains it", async () => {
  const stored = JSON.stringify(["ada@example.com"]);
  const kv = { get: async () => stored };
  assert.equal(await isEmailAllowed(kv, "Ada@Example.com"), true);
  assert.equal(await isEmailAllowed(kv, "other@example.com"), false);
  assert.equal(await isEmailAllowed({ get: async () => null }, "ada@example.com"), false);
});
