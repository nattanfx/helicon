import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HeliconServer,
  deriveTitle,
  eventsFromHistory,
  mergeSessionSkills,
  normalizeIso,
  parseSkillList,
  stripFrontmatter,
  toWireEvent,
  type HostExit,
  type HostHandle,
  type OpenTarget,
} from "../src/server.js";
import type { ExecFn, ServeTarget } from "@helicon/daemon";

interface Call {
  method: string;
  params?: Record<string, unknown>;
}

type Reply = unknown | ((params: Record<string, unknown>) => unknown);

class MspTestError extends Error {
  constructor(
    message: string,
    readonly kind: string,
  ) {
    super(message);
  }
}

class FakeConnection {
  calls: Call[] = [];
  requests: Call[] = [];
  replies = new Map<string, Reply>();
  handler: ((n: { method: string; params?: unknown }) => void) | null = null;

  private answer(method: string, params: Record<string, unknown>): unknown {
    const reply = this.replies.get(method);
    if (reply instanceof Error) {
      throw reply;
    }
    if (typeof reply === "function") {
      return (reply as (p: Record<string, unknown>) => unknown)(params);
    }
    return reply ?? { ok: true };
  }

  async command(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params });
    return this.answer(method, params);
  }

  async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.requests.push({ method, params });
    return this.answer(method, params);
  }

  onNotification(handler: (n: { method: string; params?: unknown }) => void): void {
    this.handler = handler;
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.handler?.({ method, params });
  }
}

interface FactoryProbe {
  targets: ServeTarget[];
  exits: ((exit: HostExit) => void)[];
}

function fakeFactory(connection: FakeConnection, probe?: FactoryProbe): (target: ServeTarget) => HostHandle {
  return (target) => {
    probe?.targets.push(target);
    return {
      start: async () => {
        await new Promise((r) => setTimeout(r, 5));
        return { initializeResult: { serverInfo: { name: "muse", version: "1.1.1" } } };
      },
      connection: connection as never,
      close: async () => ({ code: 0, signal: null }),
      onExit: (handler) => probe?.exits.push(handler),
    };
  };
}

async function start(connection: FakeConnection, extra: Partial<ConstructorParameters<typeof HeliconServer>[0]> = {}) {
  const server = new HeliconServer({
    port: 0,
    dataDir: ":memory:",
    platform: "linux",
    musePath: "muse",
    hostFactory: fakeFactory(connection),
    // No test spawns the real CLI by accident; title upgrades see a failed call.
    exec: async () => ({ stdout: "", exitCode: 127 }),
    ...extra,
  });
  after(() => server.close());
  const bound = await server.listen();
  return { server, base: `http://127.0.0.1:${bound.port}` };
}

async function send(
  base: string,
  path: string,
  body?: unknown,
  method = "POST",
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

async function get(base: string, path: string): Promise<any> {
  return (await fetch(`${base}${path}`)).json();
}

async function waitFor(cond: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 5000;
  for (;;) {
    if (await cond()) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

const RANGE = { first: { id: "r", sequence: 1 }, last: { id: "r", sequence: 1 }, stream: { id: "s", kind: "session" } };

describe("HeliconServer", () => {
  it("serves health, projects, sessions and turns", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1", modelId: "muse-spark-1.3" } });
    connection.replies.set("turn/start", { status: "accepted", turnId: "t1", disposition: "started" });
    const { base } = await start(connection);

    const health = await get(base, "/api/health");
    assert.equal(health.ok, true);

    const created = await send(base, "/api/sessions", { cwd: "/work/proj/" });
    assert.equal(created.status, 200);
    assert.equal(created.json.session.sessionId, "s1");
    assert.equal(created.json.session.cwd, "/work/proj");
    assert.equal(created.json.session.modelId, "muse-spark-1.3");

    const turn = await send(base, "/api/turns", { sessionId: "s1", text: "hello", ifBusy: "steer", reasoningEffort: "high" });
    assert.equal(turn.status, 200);
    assert.equal(turn.json.turnId, "t1");
    assert.deepEqual(connection.calls.at(-1)?.params, {
      sessionId: "s1",
      input: [{ type: "text", text: "hello" }],
      ifBusy: "steer",
      reasoningEffort: "high",
    });

    // max is a real level on the contributor tier, so it has to pass validation like the rest of the scale.
    const top = await send(base, "/api/turns", { sessionId: "s1", text: "hello", reasoningEffort: "max" });
    assert.equal(top.status, 200);
    assert.equal((connection.calls.at(-1)?.params as { reasoningEffort?: string }).reasoningEffort, "max");

    const projects = await get(base, "/api/projects");
    assert.deepEqual(projects.projects.map((p: { cwd: string }) => p.cwd), ["/work/proj"]);

    const denied = await send(base, "/api/turns", { sessionId: "s1" });
    assert.equal(denied.status, 400);
  });

  it("rejects bad modes, dispositions, efforts and missing fields", async () => {
    const connection = new FakeConnection();
    const { base } = await start(connection);
    assert.equal((await send(base, "/api/sessions", { cwd: "/w", approvalMode: "yolo" })).status, 400);
    assert.equal((await send(base, "/api/sessions", {})).status, 400);
    assert.equal((await send(base, "/api/turns", { sessionId: "s", text: "x", ifBusy: "later" })).status, 400);
    assert.equal((await send(base, "/api/turns", { sessionId: "s", text: "x", reasoningEffort: "louder" })).status, 400);
    assert.equal((await send(base, "/api/approvals/decide", { sessionId: "s" })).status, 400);
    assert.equal((await send(base, "/api/user-input/clarify", { sessionId: "s", userInputId: "u" })).status, 400);
    const bad = await fetch(`${base}/api/turns`, { method: "POST", body: "{nope" });
    assert.equal(bad.status, 400);
  });

  it("requires a token when one is configured", async () => {
    const connection = new FakeConnection();
    const { base } = await start(connection, { token: "secret" });
    assert.equal((await fetch(`${base}/api/health`)).status, 401);
    assert.equal((await fetch(`${base}/api/health?token=secret`)).status, 200);
  });

  it("answers an allowed origin and refuses one nobody listed", async () => {
    const connection = new FakeConnection();
    const { base } = await start(connection, { allowOrigins: ["https://helicon.example"] });
    const blocked = await fetch(`${base}/api/health`, { headers: { origin: "https://evil.example" } });
    assert.equal(blocked.status, 403);
    // Nothing to read even by accident: a refused origin gets no CORS headers at all.
    assert.equal(blocked.headers.get("access-control-allow-origin"), null);
    const allowed = await fetch(`${base}/api/health`, { headers: { origin: "https://helicon.example" } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("access-control-allow-origin"), "https://helicon.example");
    assert.equal(allowed.headers.get("access-control-allow-credentials"), "true");
  });

  it("answers a preflight for an allowed origin", async () => {
    const connection = new FakeConnection();
    const { base } = await start(connection, { allowOrigins: ["https://helicon.example"] });
    const res = await fetch(`${base}/api/turns`, { method: "OPTIONS", headers: { origin: "https://helicon.example" } });
    assert.equal(res.status, 204);
    assert.match(res.headers.get("access-control-allow-methods") ?? "", /POST/);
  });

  it("trades a token for a cookie, which is what the event stream can carry", async () => {
    const connection = new FakeConnection();
    const { base } = await start(connection, { token: "secret" });
    assert.equal((await send(base, "/api/auth", { token: "wrong" })).status, 401);
    const res = await fetch(`${base}/api/auth`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "secret" }),
    });
    assert.equal(res.status, 200);
    const cookie = res.headers.get("set-cookie") ?? "";
    assert.match(cookie, /helicon_token=secret/);
    assert.match(cookie, /HttpOnly/);
    // EventSource cannot send a header, so the cookie alone has to be enough.
    assert.equal((await fetch(`${base}/api/health`, { headers: { cookie: "helicon_token=secret" } })).status, 200);
  });

  it("takes a token from the URL only when no other site is asking", async () => {
    const connection = new FakeConnection();
    const { base } = await start(connection, { token: "secret", allowOrigins: ["https://helicon.example"] });
    // No origin at all: curl, the desktop shell, the page this daemon served itself.
    assert.equal((await fetch(`${base}/api/health?token=secret`)).status, 200);
    // Its own page writing back still counts as itself, origin header and all.
    assert.equal((await fetch(`${base}/api/health?token=secret`, { headers: { origin: base } })).status, 200);
    // Another site holding the same link gets nothing, so sharing the URL hands over no access.
    const cross = await fetch(`${base}/api/health?token=secret`, { headers: { origin: "https://helicon.example" } });
    assert.equal(cross.status, 401);
  });

  it("translates Windows paths at the WSL boundary", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s9" } });
    connection.replies.set("session/list", {
      sessions: [
        { session: { sessionId: "tui-1", workspaceRoot: "/mnt/d/work/proj" } },
        { sessionId: "tui-2", workspaceRoot: "/mnt/d/work/other", turnCount: 4, updatedAt: "2026-09-11T12:35:42.947855Z" },
      ],
      nextCursor: null,
    });
    const probe: FactoryProbe = { targets: [], exits: [] };
    const { base } = await start(connection, {
      platform: "win32",
      musePath: "/home/dev/.local/bin/muse",
      hostFactory: fakeFactory(connection, probe),
    });

    const created = await send(base, "/api/sessions", { cwd: "D:\\work\\proj" });
    assert.equal(created.status, 200);
    const startCall = connection.calls.find((c) => c.method === "session/start");
    assert.equal(startCall?.params?.["workspaceRoot"], "/mnt/d/work/proj");
    assert.equal(probe.targets[0]?.command, "wsl");
    assert.deepEqual(probe.targets[0]?.args.slice(0, 2), ["-d", "Ubuntu"]);
    assert.equal(probe.targets[0]?.cwd, "D:\\work\\proj");

    const found = await send(base, "/api/discover", {});
    assert.equal(found.status, 200);
    assert.equal(found.json.sessions.length, 2);
    const listCall = connection.requests.find((c) => c.method === "session/list");
    assert.equal(listCall?.params?.["commandId"], undefined, "queries must not carry a commandId");
    const projects = await get(base, "/api/projects");
    const cwds = projects.projects.map((p: { cwd: string }) => p.cwd);
    assert.ok(cwds.includes("D:\\work\\proj"));
    assert.ok(cwds.includes("D:\\work\\other"));
    const sessions = await get(base, `/api/sessions?cwd=${encodeURIComponent("D:\\work\\other")}`);
    assert.equal(sessions.sessions[0].origin, "tui");
    assert.equal(sessions.sessions[0].turnCount, 4);
    assert.equal(sessions.sessions[0].activityAt, "2026-09-11T12:35:42.947Z");
  });

  it("runs native Windows Muse with Windows paths, and no WSL", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s9" } });
    connection.replies.set("session/list", {
      sessions: [{ sessionId: "tui-1", workspaceRoot: "d:/work/other", turnCount: 2 }],
      nextCursor: null,
    });
    const probe: FactoryProbe = { targets: [], exits: [] };
    const ran: { command: string; args: string[] }[] = [];
    const binary = "C:\\Users\\ada\\AppData\\Local\\Programs\\muse\\muse-bin-1.3.0-R1.exe";
    const { base } = await start(connection, {
      platform: "win32",
      musePath: undefined,
      findNativeMuse: () => ({ binary, dir: "C:\\Users\\ada\\AppData\\Local\\Programs\\muse", version: "1.3.0-R1", launcher: null }),
      hostFactory: fakeFactory(connection, probe),
      shellRunner: async (command: string, args: string[]) => {
        ran.push({ command, args });
        return { output: "ok\n", exitCode: 0, truncated: false };
      },
    });

    const env = await get(base, "/api/env");
    assert.equal(env.runtime, "native");
    assert.equal(env.musePath, binary);

    const created = await send(base, "/api/sessions", { cwd: "D:\\work\\it's here" });
    assert.equal(created.status, 200);
    const startCall = connection.calls.find((c) => c.method === "session/start");
    assert.equal(startCall?.params?.["workspaceRoot"], "D:\\work\\it's here", "native Muse gets the Windows path itself");
    assert.equal(probe.targets[0]?.command, binary);
    assert.deepEqual(probe.targets[0]?.args, ["serve"]);
    assert.equal(probe.targets[0]?.cwd, "D:\\work\\it's here");

    const found = await send(base, "/api/discover", {});
    assert.equal(found.status, 200);
    const cwds = (await get(base, "/api/projects")).projects.map((p: { cwd: string }) => p.cwd);
    assert.ok(cwds.includes("D:\\work\\other"), "a root spelled d:/work/other is stored as D:\\work\\other");

    const shell = await send(base, "/api/sessions/s9/shell-proxy", { command: "Get-ChildItem" });
    assert.equal(shell.status, 200);
    assert.match(ran[0]!.command, /powershell\.exe$/i);
    const script = ran[0]!.args.at(-1)!;
    assert.ok(script.startsWith("Set-Location -LiteralPath 'D:\\work\\it''s here'"), script);
    assert.ok(script.endsWith("\nGet-ChildItem"));
  });

  it("tracks live status and derives titles from the view stream", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    const { base } = await start(connection);
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    const read = async () => (await get(base, "/api/sessions")).sessions[0];

    assert.equal((await read()).title, "New thread");
    connection.notify("turn/started", { sessionId: "s1", turnId: "t1", sourceRange: RANGE });
    connection.notify("item/completed", {
      sessionId: "s1",
      item: { itemId: "i1", kind: "userMessage", revision: 1, status: "completed", text: "\n  Fix the flaky login test in CI\nmore detail" },
    });
    connection.notify("approval/requested", { sessionId: "s1", approvalId: "a1" });
    let session = await read();
    assert.equal(session.title, "Fix the flaky login test in CI");
    assert.equal(session.live.activeTurnId, "t1");
    assert.equal(session.live.pendingApprovals, 1);

    connection.notify("approval/resolved", { sessionId: "s1", approvalId: "a1" });
    connection.notify("turn/completed", {
      sessionId: "s1",
      turnId: "t1",
      terminal: "failed",
      error: { kind: "modelError", message: "Provider timed out", retryable: true },
    });
    session = await read();
    assert.equal(session.live.activeTurnId, null);
    assert.equal(session.live.pendingApprovals, 0);
    assert.equal(session.live.lastTerminal, "failed");
    assert.equal(session.live.lastError, "Provider timed out");
    assert.equal(session.turnCount, 1);

    connection.notify("item/completed", {
      sessionId: "s1",
      item: { itemId: "i2", kind: "userMessage", revision: 1, status: "completed", text: "Something else entirely" },
    });
    assert.equal((await read()).title, "Fix the flaky login test in CI", "only the first prompt names a thread");
  });

  it("takes Muse's own name for a thread, unless the user named it", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    connection.replies.set("session/list", {
      sessions: [{ sessionId: "s1", workspaceRoot: "/work/proj", name: "Wire up the updater", title: "fix the updater please" }],
      nextCursor: null,
    });
    const { base } = await start(connection);
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    connection.notify("item/completed", {
      sessionId: "s1",
      item: { itemId: "i1", kind: "userMessage", revision: 1, status: "completed", text: "fix the updater please" },
    });
    const read = async () => (await get(base, "/api/sessions")).sessions.find((s: { sessionId: string }) => s.sessionId === "s1");
    assert.equal((await read()).title, "fix the updater please");

    await send(base, "/api/discover", {});
    assert.equal((await read()).title, "Wire up the updater", "the name Muse shows in its own CLI wins");

    await send(base, "/api/sessions/s1", { title: "Updater work" }, "PATCH");
    await send(base, "/api/discover", {});
    assert.equal((await read()).title, "Updater work", "a title the user typed stays");
  });

  it("loads a transcript from resume, paged history and pending requests", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    connection.replies.set("session/resume", {
      session: { sessionId: "s1", status: "running", activeTurnId: "t2", turnCount: 1, modelId: "muse-spark-1.3", updatedAt: "2026-09-11T14:00:00Z" },
    });
    const event = (n: number, method: string, extra: Record<string, unknown> = {}) => ({
      method,
      params: { sessionId: "s1", viewCursor: `v:${n}`, sourceRange: RANGE, ...extra },
    });
    connection.replies.set("view/page", (params: Record<string, unknown>) =>
      params["cursor"]
        ? {
            events: [
              event(1, "turn/started", { turnId: "t1" }),
              event(2, "item/completed", { item: { itemId: "u1", kind: "userMessage", revision: 1, status: "completed", text: "Add dark mode" } }),
            ],
            nextCursor: null,
          }
        : { events: [event(3, "turn/completed", { turnId: "t1", terminal: "completed" }), event(4, "turn/started", { turnId: "t2" })], nextCursor: "v:3" },
    );
    connection.replies.set("approval/listPending", {
      approvals: [{ approvalId: "a1", sessionId: "s1", sourceRange: RANGE, subject: { kind: "shell", command: "rm -rf dist" } }],
      userInputs: [],
    });
    const { base } = await start(connection);
    await send(base, "/api/sessions", { cwd: "/work/proj" });

    const loaded = await send(base, "/api/sessions/s1/resume", {});
    assert.equal(loaded.status, 200);
    assert.equal(loaded.json.readOnly, false);
    assert.deepEqual(
      loaded.json.events.map((e: { params: { viewCursor: string } }) => e.params.viewCursor),
      ["v:1", "v:2", "v:3", "v:4"],
    );
    assert.equal(loaded.json.events[0].params.sourceRange, undefined);
    assert.equal(loaded.json.pending.approvals[0].subject.command, "rm -rf dist");
    assert.equal(loaded.json.pending.approvals[0].sourceRange, undefined);
    assert.equal(loaded.json.msp.activeTurnId, "t2");
    assert.equal(loaded.json.session.title, "Add dark mode");
    assert.equal(loaded.json.session.live.pendingApprovals, 1);
    assert.equal(loaded.json.session.live.activeTurnId, "t2");
    const resume = connection.calls.find((c) => c.method === "session/resume");
    assert.equal(resume?.params?.["excludeItems"], true);
    const pages = connection.requests.filter((c) => c.method === "view/page");
    assert.deepEqual(pages.map((p) => p.params?.["direction"]), ["backward", "backward"]);
  });

  it("falls back to a read-only transcript when another host holds the session", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    connection.replies.set("session/resume", new MspTestError("session is loaded by another host", "sessionInUse"));
    connection.replies.set("session/read", { session: { sessionId: "s1", status: "notLoaded", activeTurnId: null } });
    connection.replies.set("view/page", { events: [], nextCursor: null });
    const { base } = await start(connection);
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    const loaded = await send(base, "/api/sessions/s1/resume", {});
    assert.equal(loaded.status, 200);
    assert.equal(loaded.json.readOnly, true);
    assert.match(loaded.json.readOnlyReason, /another host/);
    const read = connection.requests.find((c) => c.method === "session/read");
    assert.equal(read?.params?.["excludeItems"], false);
  });

  it("hydrates a read-only CLI transcript from session/read items", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    connection.replies.set("session/resume", new MspTestError("session is loaded by another host", "sessionInUse"));
    connection.replies.set("session/read", {
      session: { sessionId: "s1", status: "running", activeTurnId: null, turnCount: 1 },
      history: {
        mode: "inline",
        items: [
          { itemId: "i1", kind: "userMessage", text: "Ship the fairtab tip", status: "completed", revision: 1 },
          { itemId: "i2", kind: "agentMessage", text: "Done.", status: "completed", revision: 1 },
        ],
      },
    });
    connection.replies.set("view/page", { events: [], nextCursor: null });
    const { base } = await start(connection);
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    const loaded = await send(base, "/api/sessions/s1/resume", {});
    assert.equal(loaded.status, 200);
    assert.equal(loaded.json.readOnly, true);
    assert.deepEqual(
      loaded.json.events.map((e: { method: string; params: { item: { itemId: string } } }) => [e.method, e.params.item.itemId]),
      [
        ["item/completed", "i1"],
        ["item/completed", "i2"],
      ],
    );
  });

  it("turns session/read history items into fold events", () => {
    const events = eventsFromHistory({
      history: {
        mode: "inline",
        items: [{ itemId: "a", kind: "userMessage", text: "Hi", sourceRange: { first: 1 } }],
      },
    });
    assert.deepEqual(events, [{ method: "item/completed", params: { item: { itemId: "a", kind: "userMessage", text: "Hi" } } }]);
  });

  it("surfaces resume failures that are not about another host", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    connection.replies.set("session/resume", new MspTestError("stream mismatch", "sessionStreamMismatch"));
    connection.replies.set("session/read", { session: { sessionId: "s1", status: "notLoaded", activeTurnId: null } });
    connection.replies.set("view/page", { events: [], nextCursor: null });
    const { base } = await start(connection);
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    const failed = await send(base, "/api/sessions/s1/resume", {});
    assert.equal(failed.status, 409);
    assert.equal(failed.json.kind, "sessionStreamMismatch");
    assert.equal(failed.json.readOnly, undefined);
  });

  it("reports MSP error kinds with a useful status", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    connection.replies.set("turn/start", new MspTestError("input too large", "inputTooLarge"));
    const { base } = await start(connection);
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    const failed = await send(base, "/api/turns", { sessionId: "s1", text: "x" });
    assert.equal(failed.status, 409);
    assert.equal(failed.json.kind, "inputTooLarge");
    assert.equal(failed.json.error, "input too large");
  });

  it("renames and archives threads, and hides projects", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    const { base } = await start(connection);
    await send(base, "/api/sessions", { cwd: "/work/proj" });

    const renamed = await send(base, "/api/sessions/s1", { title: "  Ship the sidebar  " }, "PATCH");
    assert.equal(renamed.json.session.title, "Ship the sidebar");
    assert.equal(renamed.json.session.titleSource, "user");
    await send(base, "/api/sessions/s1", { archived: true }, "PATCH");
    assert.equal((await get(base, "/api/sessions")).sessions.length, 0);
    assert.equal((await get(base, "/api/sessions?archived=1")).sessions.length, 1);
    assert.equal((await send(base, "/api/sessions/missing", { title: "x" }, "PATCH")).status, 404);

    await send(base, `/api/projects?cwd=${encodeURIComponent("/work/proj")}`, undefined, "DELETE");
    assert.equal((await get(base, "/api/projects")).projects.length, 0);
    const readded = await send(base, "/api/projects", { cwd: "/work/proj" });
    assert.equal(readded.status, 200);
    assert.equal((await get(base, "/api/projects")).projects.length, 1);
  });

  it("opens known project folders only", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/list", { sessions: [], nextCursor: null });
    const opened: { path: string; target: OpenTarget }[] = [];
    const { base } = await start(connection, {
      platform: "win32",
      musePath: "/home/dev/.local/bin/muse",
      opener: async (path, target) => {
        opened.push({ path, target });
      },
    });
    assert.equal((await send(base, "/api/open", { cwd: "C:\\nowhere" })).status, 404);
    await send(base, "/api/projects", { cwd: "/mnt/d/work/app" });
    assert.equal((await send(base, "/api/open", { cwd: "/mnt/d/work/app", target: "editor" })).status, 200);
    assert.deepEqual(opened, [{ path: "D:\\work\\app", target: "editor" }]);
  });

  it("settles and un-settles threads, and wakes a settled thread when work starts", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    connection.replies.set("turn/start", { status: "accepted", turnId: "t1", disposition: "started" });
    const { base } = await start(connection);
    await send(base, "/api/sessions", { cwd: "/work/proj" });

    const settled = await send(base, "/api/sessions/s1", { settled: true }, "PATCH");
    assert.equal(settled.json.session.settled, true);
    assert.ok(settled.json.session.settledAt);
    const active = await send(base, "/api/sessions/s1", { settled: false }, "PATCH");
    assert.equal(active.json.session.settled, false);
    assert.equal(active.json.session.settledAt, null);
    assert.ok(active.json.session.unsettledAt);

    await send(base, "/api/sessions/s1", { settled: true }, "PATCH");
    await send(base, "/api/turns", { sessionId: "s1", text: "pick this back up" });
    const woken = (await get(base, "/api/sessions")).sessions.find((s: { sessionId: string }) => s.sessionId === "s1");
    assert.equal(woken.settled, false);
    assert.ok(woken.unsettledAt);
  });

  it("wakes a settled thread when discovery shows it moved on in another client", async () => {
    const connection = new FakeConnection();
    const list = (updatedAt: string) => ({ sessions: [{ sessionId: "tui-1", workspaceRoot: "/work/proj", updatedAt }], nextCursor: null });
    connection.replies.set("session/list", list("2026-09-01T00:00:00.000Z"));
    const { base } = await start(connection);
    await send(base, "/api/discover", {});
    assert.equal((await send(base, "/api/sessions/tui-1", { settled: true }, "PATCH")).json.session.settled, true);
    const find = async () => (await get(base, "/api/sessions")).sessions.find((s: { sessionId: string }) => s.sessionId === "tui-1");

    await send(base, "/api/discover", {});
    assert.equal((await find()).settled, true, "nothing new happened, so it stays settled");

    connection.replies.set("session/list", list(new Date(Date.now() + 60_000).toISOString()));
    await send(base, "/api/discover", {});
    assert.equal((await find()).settled, false);
  });

  it("carries a turn's reasoning effort as the session default, once per change", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    connection.replies.set("turn/start", { status: "accepted", turnId: "t1", disposition: "started" });
    const { base } = await start(connection);
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    const efforts = () => connection.calls.filter((c) => c.method === "session/setReasoningEffort").map((c) => c.params?.["reasoningEffort"]);

    await send(base, "/api/turns", { sessionId: "s1", text: "one", reasoningEffort: "low" });
    const methods = connection.calls.map((c) => c.method);
    assert.ok(methods.indexOf("session/setReasoningEffort") < methods.lastIndexOf("turn/start"), "the default is set before the turn goes");
    await send(base, "/api/turns", { sessionId: "s1", text: "two", reasoningEffort: "low" });
    await send(base, "/api/turns", { sessionId: "s1", text: "three" });
    assert.deepEqual(efforts(), ["low"], "an unchanged or absent effort sends nothing");

    // Changed in another client: the next turn asking for that level has nothing to do.
    connection.notify("session/reasoningEffortChanged", { sessionId: "s1", reasoningEffort: "xhigh", source: "user" });
    await send(base, "/api/turns", { sessionId: "s1", text: "four", reasoningEffort: "xhigh" });
    assert.deepEqual(efforts(), ["low"]);

    const direct = await send(base, "/api/sessions/s1/effort", { reasoningEffort: "max" });
    assert.equal(direct.status, 200);
    assert.deepEqual(efforts(), ["low", "max"]);
    assert.equal((await send(base, "/api/sessions/s1/effort", { reasoningEffort: "loud" })).status, 400);

    // A host without the method still takes the turn, with the effort riding on turn/start.
    connection.replies.set("session/setReasoningEffort", new MspTestError("no such method", "methodNotFound"));
    const old = await send(base, "/api/turns", { sessionId: "s1", text: "five", reasoningEffort: "low" });
    assert.equal(old.status, 200);
    assert.equal(connection.calls.at(-1)?.params?.["reasoningEffort"], "low");

    connection.replies.set("session/setReasoningEffort", new MspTestError("not loaded", "sessionNotLoaded"));
    const unloaded = await send(base, "/api/turns", { sessionId: "s1", text: "six", reasoningEffort: "medium" });
    assert.equal(unloaded.status, 409);
    assert.equal(unloaded.json.kind, "sessionNotLoaded", "the UI reloads and retries on this kind");
  });

  it("drives goals, subagents, background tasks and workflow children", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    connection.replies.set("goal/set", { commandId: "c", status: "accepted", turnId: "t7" });
    const { base } = await start(connection);
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    const last = () => connection.calls.at(-1);

    const goal = await send(base, "/api/sessions/s1/goal", { action: "set", objective: "get CI green" });
    assert.deepEqual(goal.json, { turnId: "t7" });
    assert.deepEqual(last(), { method: "goal/set", params: { sessionId: "s1", objective: "get CI green" } });
    await send(base, "/api/sessions/s1/goal", { action: "pause" });
    assert.deepEqual(last(), { method: "goal/pause", params: { sessionId: "s1" } });
    assert.equal((await send(base, "/api/sessions/s1/goal", { action: "edit" })).status, 400);
    assert.equal((await send(base, "/api/sessions/s1/goal", { action: "finish" })).status, 400);

    await send(base, "/api/sessions/s1/subagent", { action: "sendMessage", subagentId: "sa1", body: "use pnpm" });
    assert.deepEqual(last(), { method: "subagent/sendMessage", params: { sessionId: "s1", subagentId: "sa1", body: "use pnpm" } });
    assert.equal((await send(base, "/api/sessions/s1/subagent", { action: "followupTask", subagentId: "sa1" })).status, 400);
    assert.equal((await send(base, "/api/sessions/s1/subagent", { action: "stop" })).status, 400);

    await send(base, "/api/sessions/s1/tasks", { action: "background", taskId: "item-4" });
    assert.deepEqual(last(), { method: "task/background", params: { sessionId: "s1", taskId: "item-4" } });
    await send(base, "/api/sessions/s1/tasks", { action: "stop", taskId: "item-4" });
    assert.deepEqual(last(), { method: "task/stop", params: { sessionId: "s1", taskId: "item-4" } });
    await send(base, "/api/sessions/s1/tasks", { action: "stopAll" });
    assert.deepEqual(last(), { method: "task/stopAll", params: { sessionId: "s1" } });
    assert.equal((await send(base, "/api/sessions/s1/tasks", { action: "stop" })).status, 400);

    await send(base, "/api/sessions/s1/workflow", { action: "cancel", workflowRunId: "run-9" });
    assert.deepEqual(last(), { method: "workflow/cancel", params: { sessionId: "s1", workflowRunId: "run-9" } });
    await send(base, "/api/sessions/s1/workflow", { action: "skip", workflowRunId: "run-9", childId: "c1", attempt: 2 });
    assert.deepEqual(last(), { method: "workflow/childControl", params: { sessionId: "s1", workflowRunId: "run-9", childId: "c1", attempt: 2, action: "skip" } });
    assert.equal((await send(base, "/api/sessions/s1/workflow", { action: "retry", workflowRunId: "run-9", childId: "c1", attempt: 0 })).status, 400);
    assert.equal((await send(base, "/api/sessions/s1/workflow", { action: "cancel" })).status, 400);

    connection.replies.set("workflow/childControl", new MspTestError("stale attempt", "stale_attempt"));
    const stale = await send(base, "/api/sessions/s1/workflow", { action: "retry", workflowRunId: "run-9", childId: "c1", attempt: 1 });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.kind, "stale_attempt");
  });

  it("reads a tool's stored output one page at a time", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    connection.replies.set("item/readOutput", (params: Record<string, unknown>) => ({
      content: "x".repeat(4),
      encoding: "utf8",
      mediaType: "text/plain",
      offsetBytes: params["offsetBytes"],
      byteLen: 4,
      eof: params["offsetBytes"] === 4,
    }));
    const { base } = await start(connection);
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    const first = await get(base, "/api/sessions/s1/output?itemId=i1&outputRef=bash-1");
    assert.deepEqual(first.output, { content: "xxxx", encoding: "utf8", mediaType: "text/plain", offsetBytes: 0, byteLen: 4, eof: false });
    const next = await get(base, "/api/sessions/s1/output?itemId=i1&outputRef=bash-1&offset=4&length=99999999");
    assert.equal(next.output.eof, true);
    assert.deepEqual(connection.requests.at(-1)?.params, { sessionId: "s1", itemId: "i1", outputRef: "bash-1", offsetBytes: 4, lengthBytes: 1024 * 1024 });
    assert.equal((await fetch(`${base}/api/sessions/s1/output?itemId=i1`)).status, 400);
  });

  it("keeps the newest subscription window any host reports", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    const window = (percent: number, at: number) => ({
      tier: "high",
      observedAtMs: at,
      window: { usedPercent: percent, resetsAtMs: at + 1000, windowDurationMins: 300 },
      weekly: { usedPercent: 10, resetsAtMs: at + 9000 },
    });
    const { base } = await start(connection);
    connection.replies.set("usage/read", {});
    assert.equal((await get(base, "/api/plan-usage")).usage, null, "no host running and nothing seen");

    await send(base, "/api/sessions", { cwd: "/work/proj" });
    assert.equal((await get(base, "/api/plan-usage")).usage, null, "a host that has seen nothing is not an error");

    connection.notify("usage/changed", window(40, 2_000));
    assert.equal((await get(base, "/api/plan-usage")).usage.window.usedPercent, 40);
    connection.notify("usage/changed", window(5, 1_000));
    assert.equal((await get(base, "/api/plan-usage")).usage.window.usedPercent, 40, "an older reading never replaces a newer one");
    connection.replies.set("usage/read", { usage: window(55, 3_000) });
    const read = await get(base, "/api/plan-usage");
    assert.equal(read.usage.window.usedPercent, 55);
    assert.equal(read.usage.weekly.windowDurationMins, null);
  });
  it("emits one plan-usage event for a repeated identical reading", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    const window = (percent: number, at: number) => ({
      tier: "high",
      observedAtMs: at,
      window: { usedPercent: percent, resetsAtMs: at + 1000, windowDurationMins: 300 },
      weekly: { usedPercent: 10, resetsAtMs: at + 9000 },
    });
    const { base } = await start(connection, { token: "secret" });
    const auth = await fetch(`${base}/api/auth`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "secret" }),
    });
    assert.equal(auth.status, 200);
    // The stream authenticates the way EventSource would: the cookie alone.
    const stream = await fetch(`${base}/api/events`, { headers: { cookie: auth.headers.get("set-cookie") ?? "" } });
    assert.equal(stream.status, 200);
    const seen: number[] = [];
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const pump = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          return;
        }
        buf += decoder.decode(value, { stream: true });
        let cut: number;
        while ((cut = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          const data = frame
            .split("\n")
            .find((line) => line.startsWith("data: "))
            ?.slice("data: ".length);
          if (!data) {
            continue;
          }
          const payload = JSON.parse(data) as { type?: string; usage?: { window?: { usedPercent?: number } } };
          if (payload.type === "plan-usage" && typeof payload.usage?.window?.usedPercent === "number") {
            seen.push(payload.usage.window.usedPercent);
          }
        }
      }
    })();
    try {
      await send(base, "/api/sessions?token=secret", { cwd: "/work/proj" });
      connection.notify("usage/changed", window(40, 2_000));
      connection.notify("usage/changed", window(40, 2_000));
      connection.notify("usage/changed", window(5, 1_000));
      connection.notify("usage/changed", {});
      connection.notify("usage/changed", window(55, 3_000));
      // Same stamp, new content: the update is kept, so only the exact duplicate stays silent.
      connection.notify("usage/changed", window(60, 3_000));
      await waitFor(() => seen.length >= 3, "three plan-usage events");
      assert.deepEqual(seen, [40, 55, 60]);
      assert.equal((await get(base, "/api/plan-usage?token=secret")).usage.window.usedPercent, 60);
    } finally {
      await reader.cancel();
      await pump;
    }
  });

  it("gives Muse the name typed here, and takes the name Muse settles on", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    const { base } = await start(connection);
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    const read = async () => (await get(base, "/api/sessions")).sessions[0];

    await send(base, "/api/sessions/s1", { title: "Ship the sidebar" }, "PATCH");
    assert.deepEqual(connection.calls.at(-1), { method: "session/rename", params: { sessionId: "s1", name: "Ship the sidebar" } });

    connection.notify("session/nameChanged", { sessionId: "s1", name: "sidebar-v2", viewCursor: "c", sourceRange: RANGE });
    let session = await read();
    assert.equal(session.title, "sidebar-v2", "a `/name` in another client is the newest name");
    assert.equal(session.titleSource, "user", "and a thread the user named stays theirs");

    connection.replies.set("session/rename", new MspTestError("ephemeral", "unsupported"));
    const renamed = await send(base, "/api/sessions/s1", { title: "Local only" }, "PATCH");
    assert.equal(renamed.status, 200, "a rename Muse refuses still renames the thread here");
    assert.equal(renamed.json.session.title, "Local only");

    const renames = connection.calls.filter((c) => c.method === "session/rename").length;
    await send(base, "/api/sessions/s1", { title: "Local only" }, "PATCH");
    assert.equal(connection.calls.filter((c) => c.method === "session/rename").length, renames, "an unchanged title is not sent again");
    session = await read();
    assert.equal(session.title, "Local only");
  });

  it("keeps thread-title settings behind a switch and a model choice", async () => {
    const connection = new FakeConnection();
    const { base } = await start(connection);
    assert.deepEqual(await get(base, "/api/title-settings"), { enabled: true, modelId: null });

    const patched = await send(base, "/api/title-settings", { enabled: false, modelId: "m1" }, "PATCH");
    assert.equal(patched.status, 200);
    assert.deepEqual(patched.json, { enabled: false, modelId: "m1" });
    assert.deepEqual(await get(base, "/api/title-settings"), { enabled: false, modelId: "m1" });

    const merged = await send(base, "/api/title-settings", { enabled: true }, "PATCH");
    assert.deepEqual(merged.json, { enabled: true, modelId: "m1" });

    const badEnabled = await send(base, "/api/title-settings", { enabled: "yes" }, "PATCH");
    assert.equal(badEnabled.status, 400);
    const badModel = await send(base, "/api/title-settings", { modelId: "" }, "PATCH");
    assert.equal(badModel.status, 400);
    assert.deepEqual(await get(base, "/api/title-settings"), { enabled: true, modelId: "m1" }, "a rejected patch changes nothing");
  });

  it("keeps sandbox settings behind a boolean switch, defaulting to sandbox-on", async () => {
    const connection = new FakeConnection();
    const { base } = await start(connection);
    assert.deepEqual(await get(base, "/api/sandbox-settings"), { disabled: false });

    const patched = await send(base, "/api/sandbox-settings", { disabled: true }, "PATCH");
    assert.equal(patched.status, 200);
    assert.deepEqual(patched.json, { disabled: true });
    assert.deepEqual(await get(base, "/api/sandbox-settings"), { disabled: true });

    const bad = await send(base, "/api/sandbox-settings", { disabled: "yes" }, "PATCH");
    assert.equal(bad.status, 400);
    assert.deepEqual(await get(base, "/api/sandbox-settings"), { disabled: true }, "a rejected patch changes nothing");
  });

  it("spawns hosts with --disable-sandbox, restarting them when the switch flips", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    const probe: FactoryProbe = { targets: [], exits: [] };
    let closes = 0;
    const inner = fakeFactory(connection, probe);
    const counting = (target: ServeTarget): HostHandle => {
      const handle = inner(target);
      const close = handle.close.bind(handle);
      handle.close = async () => {
        closes += 1;
        return close();
      };
      return handle;
    };
    const { base } = await start(connection, { hostFactory: counting });

    await send(base, "/api/sessions", { cwd: "/work/proj" });
    assert.deepEqual(probe.targets.map((t) => t.args), [["serve"]]);

    await send(base, "/api/sandbox-settings", { disabled: true }, "PATCH");
    await waitFor(() => closes === 1, "the live host closing");
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    assert.deepEqual(
      probe.targets.map((t) => t.args),
      [["serve"], ["serve", "--disable-sandbox"]],
      "the respawned host carries the new posture",
    );

    await send(base, "/api/sandbox-settings", { disabled: true }, "PATCH");
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(closes, 1, "an unchanged switch restarts nothing");
  });

  it("restarts hosts on demand without changing any posture", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    const probe: FactoryProbe = { targets: [], exits: [] };
    let closes = 0;
    const inner = fakeFactory(connection, probe);
    const counting = (target: ServeTarget): HostHandle => {
      const handle = inner(target);
      const close = handle.close.bind(handle);
      handle.close = async () => {
        closes += 1;
        return close();
      };
      return handle;
    };
    const { base } = await start(connection, { hostFactory: counting });

    await send(base, "/api/sessions", { cwd: "/work/proj" });
    assert.deepEqual(probe.targets.map((t) => t.args), [["serve"]]);

    const restarted = await send(base, "/api/hosts/restart", {});
    assert.equal(restarted.status, 200);
    await waitFor(() => closes === 1, "the live host closing");
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    assert.deepEqual(
      probe.targets.map((t) => t.args),
      [["serve"], ["serve"]],
      "the respawned host keeps its posture",
    );
    assert.deepEqual(await get(base, "/api/sandbox-settings"), { disabled: false });
    assert.deepEqual(await get(base, "/api/yolo-settings"), { enabled: false });
  });
  it("records failed turns with the usage seen at the time", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    const { base } = await start(connection);
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    connection.notify("usage/changed", {
      tier: "high",
      observedAtMs: 2000,
      window: { usedPercent: 40, resetsAtMs: 3000, windowDurationMins: 300 },
      weekly: { usedPercent: 10, resetsAtMs: 9000 },
    });
    connection.notify("turn/completed", {
      sessionId: "s1",
      turnId: "t1",
      terminal: "failed",
      error: { kind: "modelError", message: "Provider timed out", retryable: true },
    });
    connection.notify("turn/completed", { sessionId: "s1", turnId: "t2", terminal: "failed" });
    connection.notify("turn/completed", { sessionId: "s1", turnId: "t3", terminal: "completed" });

    const log = (await get(base, "/api/failures")) as { count: number; recent: any[] };
    assert.equal(log.count, 2);
    assert.equal(log.recent.length, 2);
    assert.equal(log.recent[0].kind, "turn-failed");
    assert.equal(log.recent[0].sessionId, "s1");
    assert.equal(log.recent[0].turnId, "t1");
    assert.ok(log.recent[0].hostKey);
    assert.equal(log.recent[0].errorKind, "modelError");
    assert.equal(log.recent[0].message, "Provider timed out");
    assert.equal(log.recent[0].usage.window.usedPercent, 40);
    assert.equal(log.recent[1].turnId, "t2");
    assert.equal(log.recent[1].errorKind, null);
    assert.equal(log.recent[1].message, null);
  });

  it("records a failed view/page snapshot once and its later correction", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    connection.replies.set("session/resume", { session: { sessionId: "s1", activeTurnId: null } });
    connection.replies.set("approval/listPending", { approvals: [], userInputs: [] });
    let terminal = "failed";
    connection.replies.set("view/page", () => ({
      events: [
        { method: "item/completed", params: { sessionId: "s1", item: { itemId: "i1", kind: "userMessage", text: "private prompt", status: "completed" } } },
        { method: "turn/completed", params: { sessionId: "s1", turnId: "t1", terminal } },
      ],
      nextCursor: null,
    }));
    const { base } = await start(connection);
    await send(base, "/api/sessions", { cwd: "/work/proj" });

    await send(base, "/api/sessions/s1/resume", {});
    await send(base, "/api/sessions/s1/resume", {});
    let log = (await get(base, "/api/failures")) as { count: number; recent: any[] };
    assert.equal(log.count, 1);
    assert.equal(log.recent[0].kind, "turn-view-failed");
    assert.equal(log.recent[0].turnId, "t1");
    assert.equal(log.recent[0].errorKind, null);
    assert.equal(log.recent[0].usage, null);
    assert.doesNotMatch(JSON.stringify(log), /private prompt/);

    terminal = "completed";
    await send(base, "/api/sessions/s1/resume", {});
    await send(base, "/api/sessions/s1/resume", {});
    log = (await get(base, "/api/failures")) as { count: number; recent: any[] };
    assert.equal(log.count, 2);
    assert.deepEqual(log.recent.map((row) => row.kind), ["turn-view-failed", "turn-view-recovered"]);
    assert.match(log.recent[1].message, /view\/page later reported completed/);
  });

  it("records a live completion after a failed view/page snapshot", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    connection.replies.set("session/resume", { session: { sessionId: "s1" } });
    connection.replies.set("approval/listPending", { approvals: [], userInputs: [] });
    connection.replies.set("view/page", {
      events: [{ method: "turn/completed", params: { sessionId: "s1", turnId: "t1", terminal: "failed" } }],
      nextCursor: null,
    });
    const { base } = await start(connection);
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    await send(base, "/api/sessions/s1/resume", {});

    connection.notify("turn/completed", { sessionId: "s1", turnId: "t1", terminal: "completed" });
    connection.notify("turn/completed", { sessionId: "s1", turnId: "t1", terminal: "completed" });
    const log = (await get(base, "/api/failures")) as { count: number; recent: any[] };
    assert.deepEqual(log.recent.map((row) => row.kind), ["turn-view-failed", "turn-view-recovered"]);
    assert.equal(log.count, 2);
    assert.match(log.recent[1].message, /Live turn\/completed/);
  });

  it("records host exits and manual restarts", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    const probe: FactoryProbe = { targets: [], exits: [] };
    const { base } = await start(connection, { hostFactory: fakeFactory(connection, probe) });
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    assert.equal(probe.exits.length, 1);
    probe.exits[0]!({ code: 1, signal: null });

    await send(base, "/api/sessions", { cwd: "/work/proj" });
    const restarted = await send(base, "/api/hosts/restart", {});
    assert.equal(restarted.status, 200);
    await waitFor(
      async () => ((await get(base, "/api/failures")) as { count: number }).count === 2,
      "exit and restart records",
    );

    const log = (await get(base, "/api/failures")) as { count: number; recent: any[] };
    assert.equal(log.recent[0].kind, "host-exited");
    assert.match(log.recent[0].message, /exited \(1\)/);
    assert.equal(log.recent[1].kind, "host-restarted");
    assert.match(log.recent[1].message, /at the user's request/);
  });

  it("keeps only the newest failure records", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    const { base } = await start(connection);
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    for (let i = 0; i < 210; i += 1) {
      connection.notify("turn/completed", { sessionId: "s1", turnId: `t${i}`, terminal: "failed" });
    }
    const log = (await get(base, "/api/failures")) as { count: number; recent: any[] };
    assert.equal(log.count, 200);
    assert.equal(log.recent.length, 20);
    assert.equal(log.recent[0].turnId, "t190");
    assert.equal(log.recent[19].turnId, "t209");
    const capped = (await get(base, "/api/failures?limit=5")) as { recent: any[] };
    assert.equal(capped.recent.length, 5);
    assert.equal(capped.recent[0].turnId, "t205");
  });

  it("persists the failure log next to the database", async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "helicon-failures-"));
    const servers: HeliconServer[] = [];
    t.after(async () => {
      for (const closing of servers) {
        await closing.close().catch(() => undefined);
      }
      await rm(dir, { recursive: true, force: true });
    });
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    const options = {
      port: 0,
      dataDir: dir,
      platform: "linux",
      musePath: "muse",
      hostFactory: fakeFactory(connection),
      exec: async () => ({ stdout: "", exitCode: 127 }),
    };
    const first = new HeliconServer({ ...options });
    servers.push(first);
    const bound = await first.listen();
    const base = `http://127.0.0.1:${bound.port}`;
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    connection.notify("turn/completed", {
      sessionId: "s1",
      turnId: "t9",
      terminal: "failed",
      error: { kind: "k", message: "m" },
    });
    connection.replies.set("session/resume", { session: { sessionId: "s1" } });
    connection.replies.set("approval/listPending", { approvals: [], userInputs: [] });
    connection.replies.set("view/page", {
      events: [{ method: "turn/completed", params: { sessionId: "s1", turnId: "t10", terminal: "failed" } }],
      nextCursor: null,
    });
    await send(base, "/api/sessions/s1/resume", {});
    await first.close();

    const lines = (await readFile(join(dir, "failure-log.jsonl"), "utf8")).trim().split("\n");
    assert.equal(lines.length, 2);
    assert.equal((JSON.parse(lines[0]!) as { turnId: string }).turnId, "t9");
    assert.equal((JSON.parse(lines[1]!) as { kind: string }).kind, "turn-view-failed");

    const second = new HeliconServer({ ...options });
    servers.push(second);
    const rebound = await second.listen();
    const log = (await get(`http://127.0.0.1:${rebound.port}`, "/api/failures")) as {
      count: number;
      recent: any[];
    };
    assert.equal(log.count, 2);
    assert.equal(log.recent[0].turnId, "t9");
    assert.equal(log.recent[1].turnId, "t10");
    await send(`http://127.0.0.1:${rebound.port}`, "/api/sessions/s1/resume", {});
    assert.equal(((await get(`http://127.0.0.1:${rebound.port}`, "/api/failures")) as { count: number }).count, 2);
  });


  it("drops --disable-sandbox from respawned hosts when the switch flips back on", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    const probe: FactoryProbe = { targets: [], exits: [] };
    let closes = 0;
    const inner = fakeFactory(connection, probe);
    const counting = (target: ServeTarget): HostHandle => {
      const handle = inner(target);
      const close = handle.close.bind(handle);
      handle.close = async () => {
        closes += 1;
        return close();
      };
      return handle;
    };
    const { base } = await start(connection, { hostFactory: counting });

    await send(base, "/api/sandbox-settings", { disabled: true }, "PATCH");
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    assert.deepEqual(probe.targets.map((t) => t.args), [["serve", "--disable-sandbox"]]);

    await send(base, "/api/sandbox-settings", { disabled: false }, "PATCH");
    await waitFor(() => closes === 1, "the live host closing");
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    assert.deepEqual(
      probe.targets.map((t) => t.args),
      [["serve", "--disable-sandbox"], ["serve"]],
      "the respawned host drops --disable-sandbox",
    );
  });

  it("marks sessions with their creation posture, inherited by forks", async () => {
    const connection = new FakeConnection();
    let started = 0;
    connection.replies.set("session/start", () => ({ session: { sessionId: `s${(started += 1)}` } }));
    const { base } = await start(connection);

    const plain = await send(base, "/api/sessions", { cwd: "/work/proj" });
    assert.equal(plain.json.session.sandboxDisabled, false);

    await send(base, "/api/sandbox-settings", { disabled: true }, "PATCH");
    const lifted = await send(base, "/api/sessions", { cwd: "/work/other" });
    assert.equal(lifted.json.session.sandboxDisabled, true, "a session records its creating host's flags");

    connection.replies.set("session/fork", { session: { sessionId: "s3" } });
    const fork = await send(base, "/api/sessions/s2/fork", {});
    assert.equal(fork.json.session.sandboxDisabled, true, "a fork inherits its source's posture");

    const sessions = (await get(base, "/api/sessions")).sessions as { sessionId: string; sandboxDisabled: boolean | null }[];
    assert.equal(
      sessions.find((s) => s.sessionId === "s1")?.sandboxDisabled,
      false,
      "flipping the switch never rewrites old rows",
    );
  });

  it("never starts a session on a host retired by a flip", async () => {
    const connection = new FakeConnection();
    let started = 0;
    connection.replies.set("session/start", () => ({ session: { sessionId: `s${(started += 1)}` } }));
    const probe: FactoryProbe = { targets: [], exits: [] };
    let releaseClose!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const inner = fakeFactory(connection, probe);
    let first = true;
    const counting = (target: ServeTarget): HostHandle => {
      const handle = inner(target);
      const gateThis = first;
      first = false;
      const close = handle.close.bind(handle);
      handle.close = async () => {
        if (gateThis) {
          await closeGate;
        }
        return close();
      };
      return handle;
    };
    const { base } = await start(connection, { hostFactory: counting });

    await send(base, "/api/sandbox-settings", { disabled: true }, "PATCH");
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    assert.deepEqual(probe.targets.map((t) => t.args), [["serve", "--disable-sandbox"]]);

    await send(base, "/api/sandbox-settings", { disabled: false }, "PATCH");
    const pending = send(base, "/api/sessions", { cwd: "/work/proj" });
    try {
      const raced = await Promise.race([pending.then((r) => r), new Promise((r) => setTimeout(() => r("waiting"), 50))]);
      assert.equal(raced, "waiting", "creation waits for the flip's restart");
    } finally {
      // Always unblock the retired host: teardown closes it even when the test fails.
      releaseClose();
    }
    const created = await pending;
    assert.equal(created.status, 200);
    assert.equal(created.json.session.sandboxDisabled, false, "the session lands on the new posture's host");
  });

  it("keeps YOLO settings behind a boolean switch, defaulting to off", async () => {
    const connection = new FakeConnection();
    const { base } = await start(connection);
    assert.deepEqual(await get(base, "/api/yolo-settings"), { enabled: false });

    const patched = await send(base, "/api/yolo-settings", { enabled: true }, "PATCH");
    assert.equal(patched.status, 200);
    assert.deepEqual(patched.json, { enabled: true });
    assert.deepEqual(await get(base, "/api/yolo-settings"), { enabled: true });

    const bad = await send(base, "/api/yolo-settings", { enabled: "yes" }, "PATCH");
    assert.equal(bad.status, 400);
    assert.deepEqual(await get(base, "/api/yolo-settings"), { enabled: true }, "a rejected patch changes nothing");
  });

  it("spawns hosts with the YOLO flags, restarting them when the switch flips", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    const probe: FactoryProbe = { targets: [], exits: [] };
    let closes = 0;
    const inner = fakeFactory(connection, probe);
    const counting = (target: ServeTarget): HostHandle => {
      const handle = inner(target);
      const close = handle.close.bind(handle);
      handle.close = async () => {
        closes += 1;
        return close();
      };
      return handle;
    };
    const { base } = await start(connection, { hostFactory: counting });

    await send(base, "/api/sessions", { cwd: "/work/proj" });
    assert.deepEqual(probe.targets.map((t) => t.args), [["serve"]]);

    await send(base, "/api/yolo-settings", { enabled: true }, "PATCH");
    await waitFor(() => closes === 1, "the live host closing");
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    assert.deepEqual(
      probe.targets.map((t) => t.args),
      [["serve"], ["serve", "--disable-sandbox", "--trust-workspace"]],
      "the respawned host carries the new posture",
    );

    await send(base, "/api/yolo-settings", { enabled: true }, "PATCH");
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(closes, 1, "an unchanged switch restarts nothing");
  });

  it("drops the YOLO flags from respawned hosts when the switch flips back off", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    const probe: FactoryProbe = { targets: [], exits: [] };
    let closes = 0;
    const inner = fakeFactory(connection, probe);
    const counting = (target: ServeTarget): HostHandle => {
      const handle = inner(target);
      const close = handle.close.bind(handle);
      handle.close = async () => {
        closes += 1;
        return close();
      };
      return handle;
    };
    const { base } = await start(connection, { hostFactory: counting });

    await send(base, "/api/yolo-settings", { enabled: true }, "PATCH");
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    assert.deepEqual(probe.targets.map((t) => t.args), [["serve", "--disable-sandbox", "--trust-workspace"]]);

    await send(base, "/api/yolo-settings", { enabled: false }, "PATCH");
    await waitFor(() => closes === 1, "the live host closing");
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    assert.deepEqual(
      probe.targets.map((t) => t.args),
      [
        ["serve", "--disable-sandbox", "--trust-workspace"],
        ["serve"],
      ],
      "the respawned host drops the YOLO flags",
    );
  });

  it("spawns hosts with --disable-sandbox once when both the sandbox switch and YOLO are on", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    const probe: FactoryProbe = { targets: [], exits: [] };
    const { base } = await start(connection, { hostFactory: fakeFactory(connection, probe) });

    await send(base, "/api/sandbox-settings", { disabled: true }, "PATCH");
    await send(base, "/api/yolo-settings", { enabled: true }, "PATCH");
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    assert.deepEqual(probe.targets.map((t) => t.args), [["serve", "--disable-sandbox", "--trust-workspace"]]);
  });

  it("upgrades an echo title with one muse exec call, and pushes the name back", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[][] = [];
    const exec: ExecFn = async (command, args) => {
      calls.push([command, ...args]);
      await gate;
      return {
        stdout: JSON.stringify({ payload_type: "run.terminal.completed", payload: { kind: "run_terminal", terminal: "completed", text: "Fix login redirect" } }),
        exitCode: 0,
      };
    };
    const { base } = await start(connection, { exec });
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    const titleOf = async () => (await get(base, "/api/sessions")).sessions[0].title;
    connection.notify("item/completed", {
      sessionId: "s1",
      item: { itemId: "i1", kind: "userMessage", revision: 1, status: "completed", text: "please fix the login redirect bug in the web app when sessions expire" },
    });
    await waitFor(() => calls.length > 0, "the title call to start");
    assert.equal(await titleOf(), "please fix the login redirect bug in the web app when sessions expire");
    release();
    await waitFor(async () => (await titleOf()) === "Fix login redirect", "the upgraded title");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.[0], "muse");
    assert.equal(calls[0]?.[1], "exec");
    assert.ok(!calls[0]?.includes("--model"), "no model flag without a chosen model");
    assert.match(calls[0]?.at(-1) ?? "", /please fix the login redirect bug/);
    assert.deepEqual(connection.calls.at(-1), { method: "session/rename", params: { sessionId: "s1", name: "Fix login redirect" } });
  });

  it("does not retry failed, empty or unchanged titles after discovery and restart", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    for (const outcome of ["failed", "empty", "same", "throw"]) {
      const dir = await mkdtemp(join(tmpdir(), "helicon-title-restart-"));
      const connection = new FakeConnection();
      connection.replies.set("session/start", { session: { sessionId: "s1" } });
      connection.replies.set("session/list", {
        sessions: [{ sessionId: "s1", workspaceRoot: "/work/proj", title: "Fix login" }], nextCursor: null,
      });
      connection.replies.set("view/page", {
        events: [{ method: "item/completed", params: { item: { kind: "userMessage", text: "Fix login" } } }], nextCursor: null,
      });
      let calls = 0;
      const exec: ExecFn = async () => {
        calls++;
        if (outcome === "throw") throw new Error("fake CLI failure");
        return { exitCode: outcome === "failed" ? 1 : 0, stdout: outcome === "same"
          ? JSON.stringify({ payload_type: "run.terminal.completed", payload: { kind: "run_terminal", terminal: "completed", text: "Fix login" } }) : "" };
      };
      const make = async () => {
        const server = new HeliconServer({ port: 0, dataDir: dir, platform: "linux", musePath: "muse", hostFactory: fakeFactory(connection), exec });
        const { port } = await server.listen();
        return { server, base: `http://127.0.0.1:${port}` };
      };
      let running = await make();
      try {
        await send(running.base, "/api/sessions", { cwd: "/work/proj" });
        const notify = () => connection.notify("item/completed", {
          sessionId: "s1", item: { itemId: "u1", kind: "userMessage", text: "Fix login" },
        });
        notify(); notify();
        await waitFor(() => calls === 1, "single attempt");
        for (let n = 0; n < 3; n++) await send(running.base, "/api/discover", {});
        await running.server.close();
        running = await make();
        for (let n = 0; n < 3; n++) await send(running.base, "/api/discover", {});
        await send(running.base, "/api/title-settings", { enabled: false }, "PATCH");
        await send(running.base, "/api/title-settings", { enabled: true }, "PATCH");
        await new Promise((r) => setTimeout(r, 50));
        assert.equal(calls, 1, outcome);
        assert.equal((await get(running.base, "/api/sessions")).sessions[0].title, "Fix login");
      } finally { await running.server.close(); await rm(dir, { recursive: true, force: true }); }
    }
  });

  it("does not spend model calls discovering old echo titles", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/list", {
      sessions: [{ sessionId: "old", workspaceRoot: "/work/proj", title: "Old request" }], nextCursor: null,
    });
    let calls = 0;
    const { base } = await start(connection, { exec: async () => { calls++; return { stdout: "", exitCode: 1 }; } });
    for (let n = 0; n < 3; n++) await send(base, "/api/discover", {});
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(calls, 0);
    assert.equal((await get(base, "/api/sessions")).sessions[0].title, "Old request");
  });

  it("passes the chosen model to the title call", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    const calls: string[][] = [];
    const exec: ExecFn = async (command, args) => {
      calls.push([command, ...args]);
      return { stdout: "not json", exitCode: 0 };
    };
    const { base } = await start(connection, { exec });
    await send(base, "/api/title-settings", { modelId: "m9" }, "PATCH");
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    connection.notify("item/completed", {
      sessionId: "s1",
      item: { itemId: "i1", kind: "userMessage", revision: 1, status: "completed", text: "Add dark mode everywhere" },
    });
    await waitFor(() => calls.length > 0, "the title call");
    const modelFlag = calls[0]?.indexOf("--model") ?? -1;
    assert.deepEqual(calls[0]?.slice(modelFlag, modelFlag + 2), ["--model", "m9"]);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await get(base, "/api/sessions")).sessions[0].title, "Add dark mode everywhere", "garbage output keeps the echo");
  });

  it("stays silent while switched off and does not charge for old conversations on re-enable", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    connection.replies.set("view/page", {
      events: [{ method: "item/completed", params: { item: { itemId: "u1", kind: "userMessage", text: "Add dark mode everywhere" } } }],
      nextCursor: null,
    });
    const calls: string[][] = [];
    const exec: ExecFn = async (command, args) => {
      calls.push([command, ...args]);
      return {
        stdout: JSON.stringify({ payload_type: "run.terminal.completed", payload: { kind: "run_terminal", terminal: "completed", text: "Add dark mode" } }),
        exitCode: 0,
      };
    };
    const { base } = await start(connection, { exec });
    await send(base, "/api/title-settings", { enabled: false }, "PATCH");
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    const titleOf = async () => (await get(base, "/api/sessions")).sessions[0].title;
    connection.notify("item/completed", {
      sessionId: "s1",
      item: { itemId: "i1", kind: "userMessage", revision: 1, status: "completed", text: "Add dark mode everywhere" },
    });
    assert.equal(await titleOf(), "Add dark mode everywhere");
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(calls.length, 0, "no model call while switched off");
    await send(base, "/api/title-settings", { enabled: true }, "PATCH");
    await send(base, "/api/discover", {});
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(await titleOf(), "Add dark mode everywhere");
    assert.equal(calls.length, 0);
  });

  it("disabling then re-enabling discards an in-flight title and does not spend a second call", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    let release!: (result: { stdout: string; exitCode: number }) => void;
    const gate = new Promise<{ stdout: string; exitCode: number }>((resolve) => { release = resolve; });
    let calls = 0;
    const { base } = await start(connection, { exec: async () => { calls++; return gate; } });
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    connection.notify("item/completed", {
      sessionId: "s1", item: { itemId: "u1", kind: "userMessage", text: "Please fix the login screen" },
    });
    await waitFor(() => calls === 1, "in-flight title");
    await send(base, "/api/title-settings", { enabled: false }, "PATCH");
    await send(base, "/api/title-settings", { enabled: true }, "PATCH");
    release({ stdout: JSON.stringify({ payload_type: "run.terminal.completed", payload: {
      kind: "run_terminal", terminal: "completed", text: "Fix login screen",
    } }), exitCode: 0 });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await get(base, "/api/sessions")).sessions[0].title, "Please fix the login screen");
    assert.equal(calls, 1);
    assert.equal(connection.calls.some((c) => c.method === "session/rename"), false);
  });

  it("lets a rename typed mid-upgrade win over the generated title", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    let release!: (result: { stdout: string; exitCode: number }) => void;
    const gate = new Promise<{ stdout: string; exitCode: number }>((resolve) => {
      release = resolve;
    });
    const calls: string[][] = [];
    const exec: ExecFn = async (command, args) => {
      calls.push([command, ...args]);
      return gate;
    };
    const { base } = await start(connection, { exec });
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    connection.notify("item/completed", {
      sessionId: "s1",
      item: { itemId: "i1", kind: "userMessage", revision: 1, status: "completed", text: "Add dark mode everywhere" },
    });
    await waitFor(() => calls.length > 0, "the title call to start");
    await send(base, "/api/sessions/s1", { title: "Mine" }, "PATCH");
    release({
      stdout: JSON.stringify({ payload_type: "run.terminal.completed", payload: { kind: "run_terminal", terminal: "completed", text: "Add dark mode" } }),
      exitCode: 0,
    });
    await new Promise((r) => setTimeout(r, 50));
    const session = (await get(base, "/api/sessions")).sessions[0];
    assert.equal(session.title, "Mine");
    assert.equal(session.titleSource, "user");
  });

  it("spawns one host per workspace under concurrency and respawns after a crash", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    const probe: FactoryProbe = { targets: [], exits: [] };
    const { base } = await start(connection, { hostFactory: fakeFactory(connection, probe) });
    await Promise.all([
      send(base, "/api/sessions", { cwd: "/work/proj" }),
      send(base, "/api/sessions", { cwd: "/work/proj" }),
    ]);
    assert.equal(probe.targets.length, 1);
    connection.notify("turn/started", { sessionId: "s1", turnId: "t1" });
    probe.exits[0]?.({ code: 1, signal: null });
    const session = (await get(base, "/api/sessions")).sessions[0];
    assert.equal(session.live.activeTurnId, null);
    assert.equal(session.live.lastTerminal, "failed");
    assert.match((await get(base, "/api/health")).lastHostError, /exited/);
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    assert.equal(probe.targets.length, 2);
  });
});

describe("file viewer", () => {
  async function project() {
    const { mkdtemp, mkdir, writeFile, symlink } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "helicon-files-"));
    const outside = await mkdtemp(join(tmpdir(), "helicon-outside-"));
    await mkdir(join(root, "docs"));
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(root, "README.md"), "# Title\n\nBody\n");
    await writeFile(join(root, "docs", "guide.md"), "guide");
    await writeFile(join(root, "docs", "page.html"), "<script>alert(1)</script>");
    await writeFile(join(root, "icon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
    await writeFile(join(root, "clip.mp4"), Buffer.from("0123456789"));
    await writeFile(join(root, "blob.bin"), Buffer.from([1, 0, 2, 0]));
    await writeFile(join(root, "node_modules", "pkg", "guide.md"), "vendored");
    await writeFile(join(outside, "secret.txt"), "secret");
    await symlink(join(outside, "secret.txt"), join(root, "escape.txt"));
    const connection = new FakeConnection();
    const { base } = await start(connection, { platform: process.platform });
    const added = await send(base, "/api/projects", { cwd: root });
    const cwd = added.json.project.cwd as string;
    const q = (path: string) => `cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`;
    return { base, root, cwd, q };
  }

  it("lists folders first and reads text, markdown and media descriptions", async () => {
    const { base, root, q } = await project();
    const listing = await get(base, `/api/files/list?${q("")}`);
    assert.deepEqual(
      listing.entries.map((e: { name: string; kind: string }) => `${e.kind}:${e.name}`).slice(0, 2),
      ["dir:docs", "dir:node_modules"],
    );
    assert.ok(listing.entries.some((e: { name: string }) => e.name === "README.md"));
    const nested = await get(base, `/api/files/list?${q("docs")}`);
    assert.deepEqual(nested.entries.map((e: { path: string }) => e.path), ["docs/guide.md", "docs/page.html"]);

    const readme = await get(base, `/api/files/read?${q("README.md")}`);
    assert.equal(readme.kind, "markdown");
    assert.equal(readme.content, "# Title\n\nBody\n");
    // An agent names files by absolute path; that resolves inside the project too.
    const absolute = await get(base, `/api/files/read?${q(`${root}/docs/guide.md`)}`);
    assert.equal(absolute.path, "docs/guide.md");
    assert.equal((await get(base, `/api/files/read?${q("clip.mp4")}`)).kind, "video");
    const binary = await get(base, `/api/files/read?${q("blob.bin")}`);
    assert.equal(binary.kind, "binary");
    assert.equal(binary.content, undefined);
  });

  it("refuses paths outside the project, through .. or a symlink, and unknown projects", async () => {
    const { base, q, cwd } = await project();
    assert.equal((await fetch(`${base}/api/files/read?${q("../../etc/passwd")}`)).status, 403);
    assert.equal((await fetch(`${base}/api/files/read?${q("escape.txt")}`)).status, 403, "a symlink out of the project is refused");
    assert.equal((await fetch(`${base}/api/files/raw?${q("escape.txt")}`)).status, 403);
    const missing = await fetch(`${base}/api/files/read?${q("nope.md")}`);
    assert.equal(missing.status, 404);
    assert.equal(((await missing.json()) as { kind: string }).kind, "fileNotFound");
    assert.equal((await fetch(`${base}/api/files/read?${q("/etc/passwd")}`)).status, 404, "an absolute path elsewhere resolves inside the project, where it is not");
    assert.equal((await fetch(`${base}/api/files/list?cwd=${encodeURIComponent("/etc")}&path=`)).status, 404);
    const write = await fetch(`${base}/api/files/write`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd, path: "../evil.md", content: "x", baseMtimeMs: null }),
    });
    assert.equal(write.status, 403);
  });

  it("never serves a file as a page that can script this origin, and serves video in ranges", async () => {
    const { base, q } = await project();
    const html = await fetch(`${base}/api/files/raw?${q("docs/page.html")}`);
    assert.equal(html.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.match(html.headers.get("content-security-policy") ?? "", /sandbox/);
    const svg = await fetch(`${base}/api/files/raw?${q("icon.svg")}`);
    assert.equal(svg.headers.get("content-type"), "image/svg+xml");
    assert.match(svg.headers.get("content-security-policy") ?? "", /sandbox/);
    assert.equal(svg.headers.get("x-content-type-options"), "nosniff");

    const part = await fetch(`${base}/api/files/raw?${q("clip.mp4")}`, { headers: { range: "bytes=2-5" } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get("content-range"), "bytes 2-5/10");
    assert.equal(await part.text(), "2345");
    const tail = await fetch(`${base}/api/files/raw?${q("clip.mp4")}`, { headers: { range: "bytes=-3" } });
    assert.equal(await tail.text(), "789");
  });

  it("saves an edit, and refuses one made against a file that changed on disk", async () => {
    const { base, root, cwd, q } = await project();
    const { writeFile, readFile, utimes } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const opened = await get(base, `/api/files/read?${q("README.md")}`);
    const put = (content: string, baseMtimeMs: number | null) =>
      fetch(`${base}/api/files/write`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd, path: "README.md", content, baseMtimeMs }),
      });
    const saved = await put("# Edited\n", opened.mtimeMs);
    assert.equal(saved.status, 200);
    assert.equal(await readFile(join(root, "README.md"), "utf8"), "# Edited\n");
    const after = (await saved.json()) as { mtimeMs: number };

    // Something else writes the file: the stale save is refused and the other change survives.
    await writeFile(join(root, "README.md"), "# Agent\n");
    await utimes(join(root, "README.md"), new Date(), new Date(after.mtimeMs + 5000));
    const stale = await put("# Mine\n", after.mtimeMs);
    assert.equal(stale.status, 409);
    assert.equal(((await stale.json()) as { kind: string }).kind, "fileChanged");
    assert.equal(await readFile(join(root, "README.md"), "utf8"), "# Agent\n");
  });

  it("finds files by path words, skipping generated folders", async () => {
    const { base, cwd } = await project();
    const found = await get(base, `/api/files/search?cwd=${encodeURIComponent(cwd)}&q=guide`);
    assert.deepEqual(found.files.map((f: { path: string }) => f.path), ["docs/guide.md"], "node_modules is not searched");
  });
});

describe("slash commands, skills and shell", () => {
  const LIST = JSON.stringify({
    diagnostics: [],
    skills: [
      { id: "bundled:plan", name: "plan", display_name: "plan", description: "Plan it. Use ONLY when asked.", short_description: null, scope: "bundled", activation: "on", path: "bundled://muse-core/skills/plan/SKILL.md" },
      { id: "user:secret", name: "secret", display_name: "secret", description: "Only by hand.", short_description: "Hand only", scope: "user", activation: "user-invocable-only", path: "/home/me/.config/muse/skills/secret/SKILL.md" },
      { id: "bundled:off", name: "off", display_name: "off", description: "Switched off.", activation: "off", path: "bundled://muse-core/skills/off/SKILL.md" },
    ],
  });

  it("lists a workspace's skills through the muse CLI, keeps them a minute, and reads only listed skills", async () => {
    const calls: string[][] = [];
    const exec: ExecFn = async (command, args) => {
      calls.push([command, ...args]);
      if (args.includes("list")) {
        return { stdout: LIST, exitCode: 0 };
      }
      return { stdout: "---\nname: secret\ndescription: x\n---\n\n# Secret\nDo the thing.\n", exitCode: 0 };
    };
    const { base } = await start(new FakeConnection(), { exec });
    const listed = await get(base, "/api/slash?cwd=%2Fwork%2Fproj");
    assert.deepEqual(
      listed.skills.map((s: { id: string }) => s.id),
      ["bundled:plan", "user:secret"],
      "skills switched off are left out",
    );
    assert.equal(listed.skills[1].activation, "user-invocable-only");
    assert.equal(listed.error, null);
    assert.deepEqual(calls[0], ["muse", "skills", "list", "--json", "--workspace", "/work/proj"]);
    await get(base, "/api/slash?cwd=%2Fwork%2Fproj");
    assert.equal(calls.length, 1, "a fresh list is reused");

    const body = await get(base, "/api/slash/skill?cwd=%2Fwork%2Fproj&id=user%3Asecret");
    assert.equal(body.body, "# Secret\nDo the thing.");
    assert.deepEqual(calls[1], ["sh", "-c", 'exec cat -- "$1"', "sh", "/home/me/.config/muse/skills/secret/SKILL.md"]);
    await get(base, "/api/slash/skill?cwd=%2Fwork%2Fproj&id=bundled%3Aplan");
    assert.equal(calls[2]?.[4], "muse-core/skills/plan/SKILL.md", "bundled skills resolve inside Muse's data folder");
    const unlisted = await fetch(`${base}/api/slash/skill?cwd=%2Fwork%2Fproj&id=%2Fetc%2Fpasswd`);
    assert.equal(unlisted.status, 404);
  });

  it("lists a loaded session's skills from Muse, joined to the CLI listing, and refreshes on skill/changed", async () => {
    const calls: string[][] = [];
    const exec: ExecFn = async (command, args) => {
      calls.push([command, ...args]);
      return { stdout: LIST, exitCode: 0 };
    };
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    connection.replies.set("skill/list", {
      skills: [
        { selector: "plan", displayName: "Plan", description: "Plan the work", source: "bundled" },
        { selector: "acme:deploy", displayName: "deploy", description: "Ship it", source: "plugin", pluginId: "acme", argumentHint: "<env>" },
      ],
    });
    const { base } = await start(connection, { exec });
    // No session named: the CLI listing answers, as before.
    assert.deepEqual((await get(base, "/api/slash?cwd=%2Fwork%2Fproj")).skills.map((s: { id: string }) => s.id), ["bundled:plan", "user:secret"]);

    await send(base, "/api/sessions", { cwd: "/work/proj" });
    const listed = await get(base, "/api/slash?cwd=%2Fwork%2Fproj&sessionId=s1");
    assert.deepEqual(
      listed.skills.map((s: { id: string; name: string }) => [s.id, s.name]),
      [["bundled:plan", "plan"], ["acme:deploy", "acme:deploy"]],
      "a skill the CLI also lists keeps its id, so its instructions can still be read",
    );
    assert.equal(listed.skills[1].argumentHint, "<env>");
    assert.equal(listed.skills[1].scope, "plugin");
    assert.equal(connection.requests.filter((r) => r.method === "skill/list").length, 1);

    const before = calls.length;
    connection.notify("skill/changed", { sessionId: "s1" });
    await get(base, "/api/slash?cwd=%2Fwork%2Fproj&sessionId=s1");
    assert.equal(calls.length, before + 1, "skill/changed drops the cached CLI listing for that workspace");

    connection.replies.set("skill/list", new MspTestError("method not found", "methodNotFound"));
    const fallback = await get(base, "/api/slash?cwd=%2Fwork%2Fproj&sessionId=s1");
    assert.deepEqual(fallback.skills.map((s: { id: string }) => s.id), ["bundled:plan", "user:secret"], "an older host falls back to the CLI");
  });

  it("joins session skills to CLI entries by id, name or plugin selector only", () => {
    const cli = [
      { id: "bundled:doctor", name: "doctor", displayName: "doctor", description: "cli", shortDescription: "Short", scope: "bundled", activation: "on" },
      { id: "deploy", name: "deploy", displayName: "deploy", description: "a user skill", shortDescription: null, scope: "user", activation: "on" },
      { id: "plugin:acme:lint", name: "plugin:acme:lint", displayName: "lint", description: "", shortDescription: null, scope: "plugin", activation: "on" },
    ];
    const merged = mergeSessionSkills(
      [
        { selector: "doctor", displayName: "Doctor", description: "", source: "bundled", argumentHint: null, pluginId: null },
        { selector: "acme:deploy", displayName: "deploy", description: "plugin deploy", source: "plugin", argumentHint: null, pluginId: "acme" },
        { selector: "acme:lint", displayName: "lint", description: "", source: "plugin", argumentHint: null, pluginId: "acme" },
      ],
      cli,
    );
    assert.deepEqual(merged.map((s) => s.id), ["bundled:doctor", "acme:deploy", "plugin:acme:lint"]);
    assert.equal(merged[0]?.shortDescription, "Short");
    assert.equal(merged[0]?.description, "cli", "an empty session description falls back to the CLI's");
    assert.equal(merged[1]?.scope, "plugin", "a plugin skill never borrows a same-named user skill");
  });

  it("answers a failed skill list with an error instead of failing the request", async () => {
    const { base } = await start(new FakeConnection(), { exec: async () => ({ stdout: "", exitCode: 127 }) });
    const listed = await get(base, "/api/slash?cwd=%2Fwork%2Fproj");
    assert.deepEqual(listed.skills, []);
    assert.match(listed.error, /Could not list Muse skills/);
  });

  it("runs shell commands in a session and forks it into a new thread", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    const { base } = await start(connection);
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    const shell = await send(base, "/api/sessions/s1/shell", { command: " git status " });
    assert.equal(shell.status, 200);
    assert.deepEqual(connection.calls.at(-1), { method: "session/userShell", params: { sessionId: "s1", commandText: "git status" } });
    assert.equal((await send(base, "/api/sessions/s1/shell", { command: "  " })).status, 400);

    connection.replies.set("session/fork", { session: { sessionId: "s2", modelId: "muse-spark-1.3" } });
    const fork = await send(base, "/api/sessions/s1/fork", {});
    assert.equal(fork.status, 200);
    assert.equal(fork.json.session.sessionId, "s2");
    assert.equal(fork.json.session.title, "New thread (fork)");
    assert.deepEqual(connection.calls.at(-1), { method: "session/fork", params: { sessionId: "s1", excludeItems: true } });

    connection.replies.set("session/fork", { session: { sessionId: "s3", modelId: "muse-spark-1.3", forkedFrom: { sessionId: "s1", cutExplicit: true } } });
    const historical = await send(base, "/api/sessions/s1/fork", { cutPoint: { lastTurnId: "turn-2" } });
    assert.equal(historical.status, 200);
    assert.equal(historical.json.session.sessionId, "s3");
    assert.deepEqual(connection.calls.at(-1), {
      method: "session/fork",
      params: { sessionId: "s1", excludeItems: true, cutPoint: { lastTurnId: "turn-2" } },
    });
    const before = connection.calls.length;
    assert.equal((await send(base, "/api/sessions/s1/fork", { cutPoint: { lastTurnId: " " } })).status, 400);
    assert.equal(connection.calls.length, before);
    connection.replies.set("session/fork", new MspTestError("Unknown boundary", "forkBoundaryInvalid"));
    const rejected = await send(base, "/api/sessions/s1/fork", { cutPoint: { lastTurnId: "missing" } });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.json.kind, "forkBoundaryInvalid");
    assert.equal((await get(base, "/api/sessions")).sessions.length, 3, "a rejected fork leaves no new session");
    connection.replies.set("session/fork", { session: { sessionId: "ignored", forkedFrom: { sessionId: "s1", cutExplicit: false } } });
    const ignored = await send(base, "/api/sessions/s1/fork", { cutPoint: { lastTurnId: "turn-2" } });
    assert.equal(ignored.status, 409);
    assert.equal(ignored.json.kind, "forkCutUnconfirmed");
    assert.equal((await get(base, "/api/sessions")).sessions.length, 3, "an unconfirmed cut is not presented as a branch");
    const ids = (await get(base, "/api/sessions")).sessions.map((s: { sessionId: string }) => s.sessionId).sort();
    assert.deepEqual(ids, ["s1", "s2", "s3"]);
  });

  it("runs a `!` command itself and keeps it with the thread", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    const ran: { command: string; args: string[] }[] = [];
    const { base } = await start(connection, {
      shellRunner: async (command: string, args: string[]) => {
        ran.push({ command, args });
        return { output: "total 0\n", exitCode: 0, truncated: false };
      },
    });
    await send(base, "/api/sessions", { cwd: "/work/proj" });

    const result = await send(base, "/api/sessions/s1/shell-proxy", { command: " ls -la " });
    assert.equal(result.status, 200);
    assert.equal(result.json.run.command, "ls -la");
    assert.equal(result.json.run.exitCode, 0);
    assert.equal(result.json.run.output, "total 0\n");
    assert.ok(ran[0]?.args.includes("/work/proj"), "the command runs where the workspace is");
    assert.ok(ran[0]?.args.includes("ls -la"), "the command itself is an argument, never spliced into a script");

    const loaded = await send(base, "/api/sessions/s1/resume", {});
    assert.deepEqual(
      loaded.json.shellRuns.map((run: { command: string }) => run.command),
      ["ls -la"],
    );
    assert.equal((await send(base, "/api/sessions/s1/shell-proxy", { command: "   " })).status, 400);
    assert.equal((await send(base, "/api/sessions/missing/shell-proxy", { command: "ls" })).status, 404);
  });

  it("sends an attached image to the model and serves it back", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    connection.replies.set("turn/start", { turnId: "t1", status: "accepted", disposition: "started" });
    const { base } = await start(connection);
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    const png = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");

    const sent = await send(base, "/api/turns", {
      sessionId: "s1",
      text: "what is this?",
      attachments: [{ name: "shot.png", mediaType: "image/png", base64: png, width: 10, height: 20 }],
    });
    assert.equal(sent.status, 200);
    assert.equal(sent.json.attachments?.[0]?.name, "shot.png", "the ack carries what was saved, for the open thread");
    assert.match(sent.json.attachments?.[0]?.url ?? "", /^\/api\/attachments\//);
    const turn = connection.calls.find((c) => c.method === "turn/start");
    assert.deepEqual(turn?.params?.["input"], [
      { type: "text", text: "what is this?" },
      { type: "image", base64Data: png, mediaType: "image/png", width: 10, height: 20 },
    ]);

    const loaded = await send(base, "/api/sessions/s1/resume", {});
    const file = loaded.json.attachments[0];
    assert.equal(file.name, "shot.png");
    assert.equal(file.kind, "image");
    assert.equal(file.turnId, "t1");
    const served = await fetch(`${base}${file.url}`);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/png");
    assert.equal(Buffer.from(await served.arrayBuffer()).toString("base64"), png);

    const empty = await send(base, "/api/turns", { sessionId: "s1" });
    assert.equal(empty.status, 400, "a message with neither text nor a file is refused");
  });

  it("lets Muse's own name replace a title derived from a /skill prompt", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    const { base } = await start(connection);
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    connection.notify("item/completed", {
      sessionId: "s1",
      item: {
        itemId: "u1",
        kind: "userMessage",
        status: "completed",
        revision: 1,
        turnId: "t1",
        text: 'Use skill bundled:plan: call read_skill with name "bundled:plan" first, then apply it to: tidy the API',
        displayText: "/plan tidy the API",
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    const titleOf = async () => (await get(base, "/api/sessions")).sessions.find((s: { sessionId: string }) => s.sessionId === "s1")?.title;
    assert.equal(await titleOf(), "/plan tidy the API", "until Muse has named it, the thread shows what the user typed");
    // Muse names the session itself, and that name is what its own CLI shows, so discovery takes it.
    connection.replies.set("session/list", {
      sessions: [{ sessionId: "s1", workspaceRoot: "/work/proj", name: "Tidy the API surface", title: "Use skill bundled:plan: call read_skill" }],
      nextCursor: null,
    });
    assert.equal((await send(base, "/api/discover", {})).status, 200);
    assert.equal(await titleOf(), "Tidy the API surface");
  });

  it("prefers Muse's session name over the prompt-echo title during discovery", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    const { base } = await start(connection);
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    connection.replies.set("session/list", {
      sessions: [
        { sessionId: "s1", workspaceRoot: "/work/proj", name: "pebble-caliban", title: "So far, I have been developing and working on my project Helicon on Windows only. It goes on and on.", turnCount: 9 },
        { sessionId: "s2", workspaceRoot: "/work/proj", title: "``` Set up this Mac from my private repo", turnCount: 0 },
      ],
      nextCursor: null,
    });
    assert.equal((await send(base, "/api/discover", {})).status, 200);
    const sessions = (await get(base, "/api/sessions")).sessions;
    const byId = (id: string) => sessions.find((s: { sessionId: string }) => s.sessionId === id)?.title;
    assert.equal(byId("s1"), "pebble-caliban");
    assert.equal(byId("s2"), "Set up this Mac from my private repo");
  });

  it("never lets a discovery echo clobber a generated title", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    connection.replies.set("session/list", {
      sessions: [{ sessionId: "s1", workspaceRoot: "/work/proj", title: "fix the updater please" }],
      nextCursor: null,
    });
    const calls: string[][] = [];
    const exec: ExecFn = async (command, args) => {
      calls.push([command, ...args]);
      return {
        stdout: JSON.stringify({ payload_type: "run.terminal.completed", payload: { kind: "run_terminal", terminal: "completed", text: "Fix the updater" } }),
        exitCode: 0,
      };
    };
    const { base } = await start(connection, { exec });
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    const titleOf = async () => (await get(base, "/api/sessions")).sessions.find((s: { sessionId: string }) => s.sessionId === "s1").title;
    connection.notify("item/completed", {
      sessionId: "s1",
      item: { itemId: "i1", kind: "userMessage", revision: 1, status: "completed", text: "fix the updater please" },
    });
    await waitFor(async () => (await titleOf()) === "Fix the updater", "the upgraded title");
    await send(base, "/api/discover", {});
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(await titleOf(), "Fix the updater", "the echo is a fallback, never an update");
    assert.equal(calls.length, 1, "and no second model call is spent");
  });

  it("never upgrades a thread Muse named itself", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    const calls: string[][] = [];
    const exec: ExecFn = async (command, args) => {
      calls.push([command, ...args]);
      return {
        stdout: JSON.stringify({ payload_type: "run.terminal.completed", payload: { kind: "run_terminal", terminal: "completed", text: "Fix the updater" } }),
        exitCode: 0,
      };
    };
    const { base } = await start(connection, { exec });
    await send(base, "/api/title-settings", { enabled: false }, "PATCH");
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    const titleOf = async () => (await get(base, "/api/sessions")).sessions[0].title;
    connection.notify("item/completed", {
      sessionId: "s1",
      item: { itemId: "i1", kind: "userMessage", revision: 1, status: "completed", text: "fix the updater please" },
    });
    connection.notify("session/nameChanged", { sessionId: "s1", name: "Muse One", viewCursor: "c", sourceRange: RANGE });
    assert.equal(await titleOf(), "Muse One");
    await send(base, "/api/title-settings", { enabled: true }, "PATCH");
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(await titleOf(), "Muse One", "a live rename cancels the owed attempt");
    assert.equal(calls.length, 0);

    const second = new FakeConnection();
    second.replies.set("session/start", { session: { sessionId: "s1" } });
    second.replies.set("session/list", {
      sessions: [{ sessionId: "s1", workspaceRoot: "/work/proj", title: "fix the updater please" }],
      nextCursor: null,
    });
    const { base: base2 } = await start(second, { exec });
    await send(base2, "/api/title-settings", { enabled: false }, "PATCH");
    await send(base2, "/api/sessions", { cwd: "/work/proj" });
    await send(base2, "/api/discover", {});
    second.replies.set("session/list", {
      sessions: [{ sessionId: "s1", workspaceRoot: "/work/proj", name: "Muse Two", title: "fix the updater please" }],
      nextCursor: null,
    });
    await send(base2, "/api/discover", {});
    const titleOf2 = async () => (await get(base2, "/api/sessions")).sessions[0].title;
    assert.equal(await titleOf2(), "Muse Two");
    await send(base2, "/api/title-settings", { enabled: true }, "PATCH");
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(await titleOf2(), "Muse Two", "a discovered name cancels the owed attempt");
    assert.equal(calls.length, 0);
  });

  it("keeps each session's goal in its live view for the sidebar", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    const { base } = await start(connection);
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    const liveGoal = async () =>
      (await get(base, "/api/sessions")).sessions.find((s: { sessionId: string }) => s.sessionId === "s1")?.live?.goal;
    const settle = () => new Promise((r) => setTimeout(r, 20));
    assert.equal(await liveGoal(), null);
    connection.notify("session/goalChanged", { sessionId: "s1", goal: { objective: "Ship it", status: "active", percentComplete: 40, currentWork: "Notes" } });
    await settle();
    assert.deepEqual(await liveGoal(), { objective: "Ship it", status: "active", percentComplete: 40, currentWork: "Notes" });
    connection.notify("session/goalChanged", { sessionId: "s1", goal: { status: "paused" } });
    await settle();
    assert.equal((await liveGoal())?.objective, "Ship it", "a block with no objective is not a goal");
    connection.notify("session/goalChanged", { sessionId: "s1", goal: null });
    await settle();
    assert.equal(await liveGoal(), null);
  });

  it("parses skill lists and strips frontmatter", () => {
    assert.equal(parseSkillList("not json"), null);
    assert.equal(parseSkillList(JSON.stringify({ skills: [{ name: "no id" }] }))?.skills.length, 0);
    assert.equal(stripFrontmatter("\uFEFF---\nname: x\n---\nBody"), "Body");
    assert.equal(stripFrontmatter("No frontmatter"), "No frontmatter");
  });

  it("counts the notification feed on /api/health without exposing prompt content", async () => {
    const connection = new FakeConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    const { base } = await start(connection);
    await send(base, "/api/sessions", { cwd: "/work/proj" });

    connection.notify("turn/started", { sessionId: "s1", turnId: "t1" });
    connection.notify("custom/ping", {});
    const breaking = {};
    Object.defineProperty(breaking, "session", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    connection.notify("turn/started", breaking as Record<string, unknown>);

    // A falha de um frame não derruba a conexão do host: o próximo evento segue.
    connection.notify("turn/completed", { sessionId: "s1", turnId: "t1", terminal: "completed" });

    const diagnostics = (await get(base, "/api/health")).diagnostics;
    assert.equal(diagnostics.forwardFailures, 1);
    assert.match(diagnostics.lastForwardFailure, /turn\/started: boom/);
    assert.deepEqual(diagnostics.unroutedByMethod, { "custom/ping": 1 });
    const session = diagnostics.sessions["s1"];
    assert.equal(session.count, 2);
    assert.ok(Date.parse(session.lastNotificationAt) > 0);
    assert.ok(typeof session.quietForMs === "number");
    assert.deepEqual(session.byMethod, { "turn/started": 1, "turn/completed": 1 });
    assert.ok(
      !JSON.stringify(diagnostics).includes('"t1"'),
      "conteúdo dos eventos (como ids de turno) não vaza para o diagnóstico",
    );
  });

  it("counts protocol errors when the connection reports them", async () => {
    class ProtocolConnection extends FakeConnection {
      protocolHandler: ((error: unknown) => void) | null = null;
      onProtocolError(handler: (error: unknown) => void): void {
        this.protocolHandler = handler;
      }
      failProtocol(error: unknown): void {
        this.protocolHandler?.(error);
      }
    }
    const connection = new ProtocolConnection();
    connection.replies.set("session/start", { session: { sessionId: "s1" } });
    const { base } = await start(connection);
    await send(base, "/api/sessions", { cwd: "/work/proj" });
    connection.failProtocol(new Error("refused frame"));
    const diagnostics = (await get(base, "/api/health")).diagnostics;
    assert.equal(diagnostics.protocolErrors, 1);
    assert.equal(diagnostics.lastProtocolError, "refused frame");
  });
});

describe("wire helpers", () => {
  it("reshapes notifications for the browser", () => {
    const delta = toWireEvent("item/delta", { sessionId: "s1", itemId: "i1", delta: "po", field: "text" }, 5);
    assert.deepEqual(delta, {
      type: "msp",
      sessionId: "s1",
      method: "item/delta",
      params: { sessionId: "s1", itemId: "i1", delta: "po", field: "text" },
      at: 5,
    });
    const started = toWireEvent("session/started", { session: { sessionId: "s2" } });
    assert.equal(started?.sessionId, "s2");
    const completed = toWireEvent("turn/completed", { sessionId: "s1", turnId: "t1", sourceRange: RANGE });
    assert.equal(completed?.params["sourceRange"], undefined);
    assert.equal(toWireEvent("initialized", {}), null);
  });

  it("derives thread titles from the first prompt line", () => {
    assert.equal(deriveTitle("# Fix login\nand more"), "Fix login");
    assert.equal(deriveTitle("   \n  "), null);
    const long = deriveTitle("Refactor the session manager so that queries never mint command ids and paging works for long threads");
    assert.ok(long && long.length <= 75 && long.endsWith("..."));
  });

  it("skips code fences when deriving thread titles", () => {
    assert.equal(deriveTitle("```\nSet up this Mac\nmore"), "Set up this Mac");
    assert.equal(deriveTitle("``` Fix login"), "Fix login");
    assert.equal(deriveTitle("```python\nprint(1)"), "print(1)");
    assert.equal(deriveTitle("Use `helicon.db` here"), "Use `helicon.db` here");
    assert.equal(deriveTitle("```\n```"), null);
  });

  it("normalizes MSP timestamps", () => {
    assert.equal(normalizeIso("2026-09-11T12:35:42.947855Z"), "2026-09-11T12:35:42.947Z");
    assert.equal(normalizeIso("nope"), undefined);
    assert.equal(normalizeIso(42), undefined);
  });
});
