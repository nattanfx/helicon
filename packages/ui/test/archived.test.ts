import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filterArchived, groupArchivedByProject, olderThan } from "../src/model/archived.js";
import type { ProjectView, SessionSummary } from "../src/types.js";

function project(cwd: string, displayName: string): ProjectView {
  return { cwd, displayName, pinned: false, activityAt: "2026-09-25T00:00:00.000Z" };
}

function session(id: string, cwd: string, title: string, activityAt: string): SessionSummary {
  return {
    sessionId: id,
    cwd,
    title,
    titleSource: "auto",
    turnCount: 1,
    modelId: null,
    origin: "helicon",
    archived: true,
    createdAt: activityAt,
    activityAt,
    settled: false,
    settledAt: null,
    unsettledAt: null,
    sandboxDisabled: null,
    live: null,
  };
}

describe("groupArchivedByProject", () => {
  it("groups by project in project order, newest first", () => {
    const projects = [project("/work/b", "bravo"), project("/work/a", "alfa")];
    const sessions = [
      session("s1", "/work/a", "Old", "2026-09-20T00:00:00.000Z"),
      session("s2", "/work/b", "New", "2026-09-24T00:00:00.000Z"),
      session("s3", "/work/a", "Newer", "2026-09-25T00:00:00.000Z"),
    ];
    const groups = groupArchivedByProject(projects, sessions);
    assert.deepEqual(
      groups.map((group) => group.name),
      ["bravo", "alfa"],
    );
    assert.equal(groups[0]?.cwd, "/work/b");
    assert.deepEqual(
      groups[1]?.sessions.map((s) => s.sessionId),
      ["s3", "s1"],
    );
  });

  it("buckets unknown projects under their folder name, last", () => {
    const groups = groupArchivedByProject(
      [project("/work/a", "alfa")],
      [
        session("s1", "/work/gone", "Lost", "2026-09-25T00:00:00.000Z"),
        session("s2", "/work/a", "Kept", "2026-09-25T00:00:00.000Z"),
      ],
    );
    assert.deepEqual(
      groups.map((group) => group.name),
      ["alfa", "gone"],
    );
  });
});

describe("filterArchived", () => {
  const sessions = [
    session("s1", "/work/a", "Fix the sidebar", "2026-09-25T00:00:00.000Z"),
    session("s2", "/work/b", "Write docs", "2026-09-25T00:00:00.000Z"),
  ];

  it("matches titles case-insensitively", () => {
    assert.deepEqual(
      filterArchived(sessions, "sidebar", null).map((s) => s.sessionId),
      ["s1"],
    );
    assert.deepEqual(
      filterArchived(sessions, "  DOCS ", null).map((s) => s.sessionId),
      ["s2"],
    );
  });

  it("narrows to one project", () => {
    assert.deepEqual(
      filterArchived(sessions, "", "/work/b").map((s) => s.sessionId),
      ["s2"],
    );
    assert.deepEqual(filterArchived(sessions, "sidebar", "/work/b"), []);
  });
});

describe("olderThan", () => {
  const NOW = Date.parse("2026-09-25T12:00:00.000Z");
  const sessions = [
    session("old", "/work/a", "Old", "2026-06-01T00:00:00.000Z"),
    session("edge", "/work/a", "Edge", new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString()),
    session("fresh", "/work/a", "Fresh", "2026-09-25T11:00:00.000Z"),
    session("broken", "/work/a", "Broken", "not-a-date"),
  ];

  it("picks only activity strictly past the cutoff", () => {
    assert.deepEqual(
      olderThan(sessions, 30, NOW).map((s) => s.sessionId),
      ["old"],
    );
  });

  it("ignores invalid dates and clamps non-positive windows", () => {
    assert.deepEqual(
      olderThan(sessions, 0, NOW).map((s) => s.sessionId),
      ["old", "edge", "fresh"],
    );
    assert.deepEqual(
      olderThan(sessions, -5, NOW).map((s) => s.sessionId),
      ["old", "edge", "fresh"],
    );
  });
});
