import assert from "node:assert/strict";
import { test } from "node:test";
import { consumeCode, openEmail, saveCode, sealEmail } from "./sign-in.ts";

const pepper = "test-pepper";

function memoryStore() {
  const values = new Map<string, string>();
  return {
    values,
    get: async (key: string) => values.get(key) ?? null,
    put: async (key: string, value: string) => {
      values.set(key, value);
    },
    delete: async (key: string) => {
      values.delete(key);
    },
  };
}

test("accepts the issued code once", async () => {
  const store = memoryStore();
  await saveCode(store, "ada@example.com", "123456", pepper);
  assert.equal(await consumeCode(store, "ada@example.com", "123456", pepper), true);
  assert.equal(await consumeCode(store, "ada@example.com", "123456", pepper), false);
});

test("rejects a wrong code and keeps the saved hash", async () => {
  const store = memoryStore();
  await saveCode(store, "ada@example.com", "123456", pepper);
  assert.equal(await consumeCode(store, "ada@example.com", "000000", pepper), false);
  assert.equal(store.values.size, 1);
  assert.equal(await consumeCode(store, "ada@example.com", "123456", pepper), true);
});

test("round-trips the sealed email and rejects a tampered token", async () => {
  const token = await sealEmail("ada@example.com", pepper, 1_000);
  assert.equal(await openEmail(token, pepper, 1_100), "ada@example.com");
  assert.equal(await openEmail(token, pepper, 2_000), null);
  assert.equal(await openEmail(`${token}00`, pepper, 1_100), null);
});
