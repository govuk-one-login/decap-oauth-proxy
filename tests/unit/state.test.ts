import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { generateState, validateState } from "../../src/state.ts";

const TEST_SECRET = "test-client-secret-456";

function makeExpiredState(): string {
  const timestamp = Math.floor(Date.now() / 1000 - 600).toString(16);
  const random = crypto.randomBytes(16).toString("hex");
  const payload = `${timestamp}.${random}`;
  const hmac = crypto.createHmac("sha256", TEST_SECRET).update(payload).digest("hex");
  return `${payload}.${hmac}`;
}

describe("generateState", () => {
  it("produces a three-part dot-separated string", () => {
    const state = generateState(TEST_SECRET);
    assert.equal(state.split(".").length, 3);
  });

  it("produces different values on each call", () => {
    const a = generateState(TEST_SECRET);
    const b = generateState(TEST_SECRET);
    assert.notEqual(a, b);
  });

  it("first part is a hex timestamp close to now", () => {
    const state = generateState(TEST_SECRET);
    const [timestamp] = state.split(".") as [string];
    const parsed = parseInt(timestamp, 16);
    const now = Math.floor(Date.now() / 1000);
    assert.ok(Math.abs(now - parsed) < 5);
  });
});

describe("validateState", () => {
  it("returns true for a freshly generated state", () => {
    const state = generateState(TEST_SECRET);
    assert.equal(validateState(state, TEST_SECRET), true);
  });

  it("returns false for a tampered HMAC", () => {
    const state = generateState(TEST_SECRET);
    const parts = state.split(".");
    const fakeHmac = crypto.randomBytes(32).toString("hex");
    const tampered = `${parts[0]}.${parts[1]}.${fakeHmac}`;
    assert.equal(validateState(tampered, TEST_SECRET), false);
  });

  it("returns false for a wrong secret", () => {
    const state = generateState(TEST_SECRET);
    assert.equal(validateState(state, "wrong-secret"), false);
  });

  it("returns false for an expired state (beyond TTL)", () => {
    assert.equal(validateState(makeExpiredState(), TEST_SECRET), false);
  });

  it("returns false for malformed state (wrong number of parts)", () => {
    assert.equal(validateState("only-two.parts", TEST_SECRET), false);
    assert.equal(validateState("", TEST_SECRET), false);
  });
});
