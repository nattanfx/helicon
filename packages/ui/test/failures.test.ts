import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FAILURE_KIND_LABEL, formatFailureEntry, parseFailures } from "../src/model/failures.js";
import type { FailureEntry } from "../src/types.js";

function entry(patch: Partial<FailureEntry> = {}): FailureEntry {
  return {
    at: "2026-09-25T10:00:00.000Z",
    kind: "turn-failed",
    sessionId: "session-abcdef123456",
    turnId: "turn-1234567890ab",
    hostKey: "h1",
    errorKind: null,
    message: "boom",
    ...patch,
  };
}

describe("parseFailures", () => {
  it("reads count and recent rows", () => {
    const parsed = parseFailures({ count: 3, recent: [entry(), entry({ kind: "host-restarted", sessionId: null, turnId: null })] });
    assert.equal(parsed.count, 3);
    assert.equal(parsed.recent.length, 2);
    assert.equal(parsed.recent[1]?.kind, "host-restarted");
  });

  it("drops unknown rows instead of breaking the screen", () => {
    const parsed = parseFailures({ count: 1, recent: [entry(), null, { kind: "nope" }, "x"] });
    assert.equal(parsed.count, 1);
    assert.equal(parsed.recent.length, 1);
  });

  it("falls back to empty on garbage", () => {
    assert.deepEqual(parseFailures(null), { count: 0, recent: [] });
    assert.deepEqual(parseFailures({ count: "lots", recent: {} }), { count: 0, recent: [] });
  });
});

describe("formatFailureEntry", () => {
  it("names the kind, shortens ids and keeps the detail", () => {
    const text = formatFailureEntry(entry({ errorKind: "timeout" }));
    assert.ok(text.includes(FAILURE_KIND_LABEL["turn-failed"]), text);
    assert.ok(text.includes("(timeout)"), text);
    assert.ok(text.includes("session-"), text);
    assert.ok(!text.includes("session-abcdef123456"), text);
    assert.ok(text.includes("boom"), text);
  });

  it("marks a missing host kind on failed turns", () => {
    assert.ok(formatFailureEntry(entry()).includes("(kind=ausente)"));
    assert.ok(!formatFailureEntry(entry({ kind: "host-restarted", errorKind: null })).includes("kind=ausente"));
  });
});
