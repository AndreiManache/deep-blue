import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hedgedCall } from "../src/hedge.js";

const delay = <T>(ms: number, value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));
const rejectAfter = (ms: number, msg: string): Promise<never> =>
  new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms));

describe("hedgedCall", () => {
  it("returns the primary result and never hedges when the primary beats the threshold", async () => {
    let calls = 0;
    const result = await hedgedCall(
      () => {
        calls++;
        return delay(10, "primary");
      },
      { hedgeAfterMs: 50 },
    );
    assert.equal(result, "primary");
    // Give any (erroneously scheduled) hedge time to fire before asserting.
    await delay(80, null);
    assert.equal(calls, 1, "a fast primary must not trigger a second call");
  });

  it("fires a hedge when the primary is slow, and the hedge can win", async () => {
    let calls = 0;
    const result = await hedgedCall(
      () => {
        calls++;
        // First call hangs long; the hedge resolves quickly.
        return calls === 1 ? delay(500, "slow-primary") : delay(10, "hedge");
      },
      { hedgeAfterMs: 20 },
    );
    assert.equal(result, "hedge");
    assert.equal(calls, 2, "a slow primary must trigger exactly one hedge");
  });

  it("still resolves from the primary if it finishes before the hedge does", async () => {
    let calls = 0;
    const result = await hedgedCall(
      () => {
        calls++;
        // Primary lands at 40ms (after the 20ms hedge fires); hedge is slower.
        return calls === 1 ? delay(40, "primary") : delay(500, "hedge");
      },
      { hedgeAfterMs: 20 },
    );
    assert.equal(result, "primary");
    assert.equal(calls, 2, "the hedge was fired, but the primary still won");
  });

  it("suppresses the hedge when shouldHedge() returns false", async () => {
    let calls = 0;
    let hedgeNoticed = false;
    const result = await hedgedCall(
      () => {
        calls++;
        return calls === 1 ? delay(200, "primary") : delay(5, "hedge");
      },
      {
        hedgeAfterMs: 20,
        shouldHedge: () => false,
        onHedge: () => {
          hedgeNoticed = true;
        },
      },
    );
    assert.equal(result, "primary");
    assert.equal(calls, 1, "no hedge should be launched when shouldHedge() is false");
    assert.equal(hedgeNoticed, false, "onHedge must not fire when the hedge is suppressed");
  });

  it("lets a slow-but-successful hedge win even after the primary rejects", async () => {
    let calls = 0;
    const result = await hedgedCall(
      () => {
        calls++;
        // Primary rejects at 40ms (after the 20ms hedge fires); hedge succeeds later.
        return calls === 1 ? rejectAfter(40, "primary boom") : delay(80, "hedge");
      },
      { hedgeAfterMs: 20 },
    );
    assert.equal(result, "hedge");
    assert.equal(calls, 2);
  });
});
