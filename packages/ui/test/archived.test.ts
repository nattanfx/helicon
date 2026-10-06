import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { archiveOlderNote, archiveWindowHint, archiveWindowLabel, archiveWindows, filterArchived, groupArchivedByProject, olderThan, visibleSelection } from "../src/model/archived.js";
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

  it("busca pelo título exibido: uma conversa provisória responde a Nova conversa", () => {
    const fresh = { ...session("s3", "/work/a", "New thread", "2026-09-25T00:00:00.000Z"), titleSource: "placeholder" as const };
    assert.deepEqual(filterArchived([...sessions, fresh], "nova conversa", null).map((s) => s.sessionId), ["s3"]);
    assert.deepEqual(filterArchived([...sessions, fresh], "new thread", null), []);
  });

  it("narrows to one project", () => {
    assert.deepEqual(
      filterArchived(sessions, "", "/work/b").map((s) => s.sessionId),
      ["s2"],
    );
    assert.deepEqual(filterArchived(sessions, "sidebar", "/work/b"), []);
  });
});

describe("visibleSelection", () => {
  it("acts only on selected threads the current filter shows, and keeps the order", () => {
    const sessions = [
      session("s1", "/work/a", "Fix the sidebar", "2026-09-25T00:00:00.000Z"),
      session("s2", "/work/b", "Write docs", "2026-09-25T00:00:00.000Z"),
      session("s3", "/work/a", "Fix docs", "2026-09-25T00:00:00.000Z"),
    ];
    const visible = filterArchived(sessions, "fix", null);
    assert.deepEqual(visibleSelection(["s3", "s2", "s1", "gone"], visible), ["s3", "s1"]);
    assert.deepEqual(visibleSelection(["s2"], visible), [], "a hidden selection is never deleted");
    assert.deepEqual(visibleSelection(["s2"], filterArchived(sessions, "", null)), ["s2"], "and comes back with the filter");
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
  it("explains the archive-by-age buttons when nothing is old enough", () => {
    const recent = [sessions[2]!];
    const windows = archiveWindows(recent, [30, 60, 90], NOW);
    assert.deepEqual(windows.map((w) => w.count), [0, 0, 0]);
    assert.equal(archiveOlderNote(windows), "Nenhuma conversa parada há mais de 30 dias; nada para arquivar agora.");
    assert.equal(archiveWindowLabel(windows[1]!), "60 dias (0)", "zero is shown, so the button does not look broken");
    assert.equal(archiveWindowHint(windows[2]!), "Nenhuma conversa parada há mais de 90 dias");
  });

  it("counts what each window would archive and drops the note when any has something", () => {
    const windows = archiveWindows(sessions, [30, 60, 200], NOW);
    assert.deepEqual(windows.map((w) => w.count), [1, 1, 0]);
    assert.equal(archiveOlderNote(windows), null);
    assert.equal(archiveWindowLabel(windows[0]!), "30 dias (1)");
    assert.equal(archiveWindowHint(windows[0]!), "Arquivar 1 conversa parada há mais de 30 dias");
    assert.equal(archiveOlderNote([]), null);
  });
});
