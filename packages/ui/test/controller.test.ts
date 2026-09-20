import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HeliconError, type EventHandler, type HeliconClient } from "../src/client.js";
import { HeliconController, staleThreadReason, type Platform } from "../src/model/controller.js";
import { buildTurns } from "../src/model/fold.js";
import { ZOOM_MAX, ZOOM_MIN } from "../src/model/store.js";
import type { SessionSummary, SkillEntry, TranscriptLoad } from "../src/types.js";
import { historyEvents } from "./fixtures/probe.js";

const SESSION: SessionSummary = {
  sessionId: "s1",
  cwd: "/work/app",
  title: "Probe",
  titleSource: "auto",
  turnCount: 3,
  modelId: "muse-spark-1.3",
  origin: "helicon",
  archived: false,
  createdAt: "2026-09-11T00:00:00.000Z",
  activityAt: "2026-09-11T00:00:00.000Z",
  settled: false,
  settledAt: null,
  unsettledAt: null,
  live: null,
};

function load(overrides: Partial<TranscriptLoad> = {}): TranscriptLoad {
  return {
    session: SESSION,
    msp: { status: "idle", activeTurnId: null, modelId: "muse-spark-1.3", approvalMode: "onRequest", workspaceRoot: "/work/app", turnCount: 3 },
    events: historyEvents,
    truncated: false,
    pending: { approvals: [], userInputs: [] },
    readOnly: false,
    readOnlyReason: null,
    ...overrides,
  };
}

class FakeClient implements HeliconClient {
  handler: EventHandler | null = null;
  sent: {
    sessionId: string;
    text: string;
    ifBusy?: string;
    displayText?: string;
    attachments?: { name: string; mediaType: string; base64: string }[];
  }[] = [];
  actions: string[] = [];
  orders: string[][] = [];
  skills: SkillEntry[] = [];
  transcript: () => Promise<TranscriptLoad> = async () => load();
  sendResult: () => Promise<{ turnId: string | null; disposition: string | null }> = async () => ({ turnId: "t9", disposition: "started" });

  async probeEnvironment() {
    return { platform: "linux", wslAvailable: false, defaultDistro: null, museFound: true, musePath: "/usr/bin/muse", version: "0.2.0", persistent: true };
  }
  async listProjects() {
    return [{ cwd: "/work/app", displayName: "app", pinned: false, activityAt: SESSION.activityAt }];
  }
  async addProject(cwd: string) {
    return { cwd, warning: null };
  }
  async cloneProject(_url: string, path: string) {
    return { cwd: path, warning: null };
  }
  async listDirectory(path: string) {
    return { directory: path, parent: null, separator: "/" as const, exists: true, entries: [] };
  }
  assetUrl(path: string) {
    return path;
  }
  async revealPath() {}
  async hideProject() {}
  async setPinned() {}
  async listSessions() {
    return [SESSION];
  }
  async discover() {}
  async startSession() {
    return SESSION;
  }
  loadTranscript() {
    return this.transcript();
  }
  async updateSession() {
    return SESSION;
  }
  async sendTurn(
    sessionId: string,
    text: string,
    options?: { ifBusy?: string; displayText?: string; attachments?: { name: string; mediaType: string; base64: string }[] },
  ) {
    this.sent.push({
      sessionId,
      text,
      ifBusy: options?.ifBusy,
      displayText: options?.displayText,
      attachments: options?.attachments,
    });
    return this.sendResult();
  }
  async interruptTurn() {}
  async unqueueTurn() {}
  decided: { approvalId: string; choiceId: string }[] = [];
  async decideApproval(input: { approvalId: string; choiceId: string }) {
    this.decided.push({ approvalId: input.approvalId, choiceId: input.choiceId });
  }
  async answerUserInput() {}
  async cancelUserInput() {}
  async clarifyUserInput() {}
  async listModels() {
    return [];
  }
  titleSettings = { enabled: true, modelId: null as string | null };
  titleError: Error | null = null;
  titleGate: Promise<void> | null = null;
  async getTitleSettings() {
    return { ...this.titleSettings };
  }
  async setTitleSettings(patch: { enabled?: boolean; modelId?: string | null }) {
    if (this.titleGate) {
      await this.titleGate;
    }
    if (this.titleError) {
      const error = this.titleError;
      this.titleError = null;
      throw error;
    }
    this.titleSettings = {
      enabled: patch.enabled ?? this.titleSettings.enabled,
      modelId: patch.modelId !== undefined ? patch.modelId : this.titleSettings.modelId,
    };
    return { ...this.titleSettings };
  }
  async setSessionModel() {}
  async setApprovalMode() {}
  async setProjectOrder(cwds: string[]) {
    this.orders.push(cwds);
  }
  async usage() {
    return { since: "2026-09-01T00:00:00.000Z", days: 30, buckets: [], threads: [] };
  }
  async runShellProxy(sessionId: string, command: string) {
    this.actions.push(`shell-proxy:${command}`);
    return {
      id: `run-${this.actions.length}`,
      sessionId,
      command,
      exitCode: 0,
      output: `ran ${command}`,
      truncated: false,
      durationMs: 12,
      at: "2026-09-11T22:00:00.000Z",
    };
  }
  compactNoop = false;
  async compact() {
    this.actions.push("compact");
    return { noop: this.compactNoop, reason: this.compactNoop ? "no_compactable_history" : null };
  }
  async runShell(sessionId: string, command: string) {
    this.actions.push(`shell:${sessionId}:${command}`);
  }
  async forkSession() {
    this.actions.push("fork");
    return { ...SESSION, sessionId: "s2", title: "Probe (fork)" };
  }
  async listSkills(_cwd: string, sessionId?: string) {
    this.skillSessions.push(sessionId);
    return { skills: this.skills, error: null };
  }
  async skillBody(_cwd: string, skillId: string) {
    return `Instructions for ${skillId}.`;
  }
  async openFolder() {}
  skillSessions: (string | undefined)[] = [];
  efforts: string[] = [];
  goalError: Error | null = null;
  async setReasoningEffort(sessionId: string, effort: string) {
    this.efforts.push(`${sessionId}:${effort}`);
  }
  async goal(sessionId: string, action: string, objective?: string) {
    if (this.goalError) {
      throw this.goalError;
    }
    this.actions.push(`goal:${sessionId}:${action}${objective ? `:${objective}` : ""}`);
    return { turnId: action === "set" || action === "resume" ? "t-goal" : null };
  }
  async subagent(sessionId: string, action: string, subagentId: string, options?: { body?: string }) {
    this.actions.push(`subagent:${sessionId}:${action}:${subagentId}${options?.body ? `:${options.body}` : ""}`);
  }
  async task(sessionId: string, action: string, taskId?: string) {
    this.actions.push(`task:${sessionId}:${action}${taskId ? `:${taskId}` : ""}`);
  }
  workflowError: Error | null = null;
  async workflow(sessionId: string, action: string, workflowRunId: string, child?: { childId: string; attempt: number }) {
    if (this.workflowError) {
      throw this.workflowError;
    }
    this.actions.push(`workflow:${sessionId}:${action}:${workflowRunId}${child ? `:${child.childId}@${child.attempt}` : ""}`);
  }
  async readOutput(_sessionId: string, _itemId: string, _outputRef: string, offset = 0) {
    return { content: offset === 0 ? "first " : "second", encoding: "utf8", mediaType: "text/plain", offsetBytes: offset, byteLen: 6, eof: offset > 0 };
  }
  plan: import("../src/types.js").PlanUsage | null = null;
  async planUsage() {
    return this.plan;
  }
  writes: { path: string; content: string; baseMtimeMs: number | null }[] = [];
  writeError: Error | null = null;
  async listFiles(_cwd: string, path: string) {
    return { path, entries: [], truncated: false };
  }
  async readFile(_cwd: string, path: string) {
    return { path, name: path, size: 3, mtimeMs: 100, kind: "markdown" as const, mediaType: "text/markdown", content: "# a", truncated: false };
  }
  async writeFile(_cwd: string, path: string, content: string, baseMtimeMs: number | null) {
    if (this.writeError) {
      const error = this.writeError;
      this.writeError = null;
      throw error;
    }
    this.writes.push({ path, content, baseMtimeMs });
    return { path, size: content.length, mtimeMs: 200 };
  }
  async searchFiles() {
    return [];
  }
  async openFileExternally() {}
  fileUrl(cwd: string, path: string) {
    return `/raw?${cwd}&${path}`;
  }
  subscribe(handler: EventHandler) {
    this.handler = handler;
    return () => {
      this.handler = null;
    };
  }
}

function platform(hash = ""): Platform & { hash: string } {
  const state = {
    hash,
    loadPrefs: () => null,
    savePrefs: () => {},
    loadFileDrafts: () => null,
    saveFileDrafts: () => {},
    confirmLeave: () => true,
    onBeforeClose: () => () => {},
    readHash: () => state.hash,
    writeHash: (next: string) => {
      state.hash = next;
    },
    onHashChange: () => () => {},
    now: () => Date.now(),
    schedule: (fn: () => void) => setTimeout(fn, 0),
    cancel: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    // Nothing is watching a test, which is also what lets one exercise what gets announced.
    focused: () => false,
  };
  return state;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 15));

async function started(client: FakeClient, hash = "#/t/s1") {
  const controller = new HeliconController(client, platform(hash));
  const stop = controller.start();
  await settle();
  await settle();
  return { controller, stop };
}

describe("HeliconController", () => {
  it("boots, lists threads and opens the one in the URL", async () => {
    const client = new FakeClient();
    const { controller, stop } = await started(client);
    const state = controller.store.get();
    assert.equal(state.boot, "ready");
    assert.deepEqual(state.route, { kind: "thread", sessionId: "s1" });
    assert.equal(state.threads["s1"]?.load, "ready");
    assert.equal(buildTurns(state.threads["s1"]!.fold).length, 3);
    stop();
  });

  it("loads the thread-title switch at boot and flips it with rollback", async () => {
    const client = new FakeClient();
    client.titleSettings = { enabled: false, modelId: "m1" };
    const { controller, stop } = await started(client);
    assert.deepEqual(controller.store.get().titleSettings, { enabled: false, modelId: "m1" });

    await controller.setTitleEnabled(true);
    assert.deepEqual(controller.store.get().titleSettings, { enabled: true, modelId: "m1" });

    await controller.setTitleModel(null);
    assert.deepEqual(controller.store.get().titleSettings, { enabled: true, modelId: null });

    client.titleError = new Error("daemon away");
    await controller.setTitleEnabled(false);
    assert.deepEqual(controller.store.get().titleSettings, { enabled: true, modelId: null }, "a failed flip rolls back");
    assert.match(controller.store.get().toasts.at(-1)?.title ?? "", /Não foi possível alterar os títulos das conversas/);
    stop();
  });

  it("discards a stale title switch that resolves after a newer one", async () => {
    const client = new FakeClient();
    const { controller, stop } = await started(client);
    let release!: () => void;
    client.titleGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = controller.setTitleEnabled(false);
    client.titleGate = null;
    await controller.setTitleEnabled(true);
    release();
    await first;
    assert.deepEqual(controller.store.get().titleSettings, { enabled: true, modelId: null });
    stop();
  });

  it("keeps stream events that arrive while a thread is still loading", async () => {
    const client = new FakeClient();
    let resolve: (value: TranscriptLoad) => void = () => {};
    client.transcript = () => new Promise((r) => (resolve = r));
    const { controller, stop } = await started(client);
    client.handler?.({ type: "msp", sessionId: "s1", method: "turn/started", params: { sessionId: "s1", turnId: "live-1" }, at: 1 });
    resolve(load());
    await settle();
    assert.equal(controller.store.get().threads["s1"]?.fold.activeTurnId, "live-1");
    stop();
  });

  it("coalesces overlapping thread loads instead of losing buffered events", async () => {
    // A second load while one is in flight used to orphan the first load's buffer: every event
    // that streamed into it was dropped, and the thread never showed them (#32).
    const client = new FakeClient();
    let loads = 0;
    let resolve!: (value: TranscriptLoad) => void;
    client.transcript = () => {
      loads += 1;
      return new Promise<TranscriptLoad>((r) => (resolve = r));
    };
    const { controller, stop } = await started(client);
    client.handler?.({ type: "msp", sessionId: "s1", method: "turn/started", params: { sessionId: "s1", turnId: "live-1" }, at: 1 });
    const second = controller.loadThread("s1");
    client.handler?.({
      type: "msp",
      sessionId: "s1",
      method: "item/started",
      params: { sessionId: "s1", item: { itemId: "i1", kind: "agentMessage", status: "inProgress", revision: 1 } },
      at: 2,
    });
    resolve(load());
    await settle();
    await settle();
    await second;
    assert.equal(loads, 1, "overlapping loads share one transcript read");
    const fold = controller.store.get().threads["s1"]?.fold;
    assert.equal(fold?.activeTurnId, "live-1", "events buffered before the overlap still land");
    assert.ok(fold?.items["i1"], "events buffered during the overlap still land");
    stop();
  });

  it("echoes a sent prompt, marks the turn running, then drops the echo", async () => {
    const client = new FakeClient();
    const { controller, stop } = await started(client);
    assert.equal(await controller.send("Add a README section"), true);
    let fold = controller.store.get().threads["s1"]!.fold;
    assert.equal(fold.activeTurnId, "t9");
    assert.equal(fold.echoes[0]?.turnId, "t9");
    client.handler?.({
      type: "msp",
      sessionId: "s1",
      method: "item/completed",
      params: { sessionId: "s1", item: { itemId: "u9", kind: "userMessage", status: "completed", revision: 1, turnId: "t9", text: "Add a README section" } },
      at: 2,
    });
    await settle();
    fold = controller.store.get().threads["s1"]!.fold;
    assert.equal(fold.echoes.length, 0);
    stop();
  });

  it("queues follow-ups while a turn runs and steers on request", async () => {
    const client = new FakeClient();
    client.transcript = async () => load({ msp: { status: "running", activeTurnId: "t1", modelId: null, approvalMode: null, workspaceRoot: null, turnCount: 3 } });
    client.sendResult = async () => ({ turnId: "t2", disposition: "queued" });
    const { controller, stop } = await started(client);
    await controller.send("next thing");
    assert.equal(client.sent.at(-1)?.ifBusy, "queue");
    assert.equal(controller.store.get().threads["s1"]!.fold.echoes[0]?.disposition, "queued");
    client.sendResult = async () => ({ turnId: "t1", disposition: "steered" });
    await controller.send("actually use tabs", { steer: true });
    assert.equal(client.sent.at(-1)?.ifBusy, "steer");
    stop();
  });

  it("turns a double-pressed Enter into one send, and the duplicate still reports sent", async () => {
    const client = new FakeClient();
    const releases: ((ack: { turnId: string | null; disposition: string | null }) => void)[] = [];
    client.sendResult = () => new Promise((resolve) => {
      releases.push(resolve);
    });
    const { controller, stop } = await started(client);
    // Both arrive before either is acknowledged, the way two Enters land before the composer clears.
    const first = controller.send("check the vault");
    const second = controller.send("check the vault");
    releases.forEach((release, index) => release({ turnId: `t${9 + index}`, disposition: "started" }));
    assert.deepEqual(await Promise.all([first, second]), [true, true]);
    assert.equal(client.sent.length, 1);
    assert.equal(controller.store.get().threads["s1"]!.fold.echoes.length, 1);
    stop();
  });

  it("lets the same prompt go again once the first send settles", async () => {
    const client = new FakeClient();
    const { controller, stop } = await started(client);
    assert.equal(await controller.send("check the vault"), true);
    assert.equal(await controller.send("check the vault"), true);
    assert.equal(client.sent.length, 2);
    stop();
  });

  it("lets a different prompt go while one is still in flight", async () => {
    const client = new FakeClient();
    const releases: ((ack: { turnId: string | null; disposition: string | null }) => void)[] = [];
    client.sendResult = () => new Promise((resolve) => {
      releases.push(resolve);
    });
    const { controller, stop } = await started(client);
    const first = controller.send("check the vault");
    const second = controller.send("and the firewall rules");
    releases.forEach((release, index) => release({ turnId: `t${9 + index}`, disposition: "started" }));
    assert.deepEqual(await Promise.all([first, second]), [true, true]);
    assert.equal(client.sent.length, 2);
    stop();
  });

  it("releases the guard when the first send fails, so a retry goes", async () => {
    const client = new FakeClient();
    client.sendResult = async () => {
      throw new HeliconError("turn rejected", 409, "turnRejected");
    };
    const { controller, stop } = await started(client);
    assert.equal(await controller.send("check the vault"), false);
    client.sendResult = async () => ({ turnId: "t9", disposition: "started" });
    assert.equal(await controller.send("check the vault"), true);
    assert.equal(client.sent.length, 2);
    stop();
  });

  it("sends identical text with identical files once, but new files go", async () => {
    const client = new FakeClient();
    const releases: ((ack: { turnId: string | null; disposition: string | null }) => void)[] = [];
    client.sendResult = () => new Promise((resolve) => {
      releases.push(resolve);
    });
    const { controller, stop } = await started(client);
    const shot = { name: "shot.png", mediaType: "image/png", base64: "AAAA" };
    const other = { name: "other.png", mediaType: "image/png", base64: "BBBB" };
    const first = controller.send("look at this", { attachments: [shot] });
    const duplicate = controller.send("look at this", { attachments: [{ ...shot }] });
    const changed = controller.send("look at this", { attachments: [other] });
    releases.forEach((release, index) => release({ turnId: `t${9 + index}`, disposition: "started" }));
    assert.deepEqual(await Promise.all([first, duplicate, changed]), [true, true, true]);
    assert.equal(client.sent.length, 2);
    stop();
  });

  it("reports a failed send and hands the text back", async () => {
    const client = new FakeClient();
    client.sendResult = async () => {
      throw new HeliconError("input too large", 409, "inputTooLarge");
    };
    const { controller, stop } = await started(client);
    assert.equal(await controller.send("x".repeat(10)), false);
    const state = controller.store.get();
    assert.equal(state.threads["s1"]!.fold.echoes.length, 0);
    assert.equal(state.toasts.at(-1)?.title, "Mensagem não enviada");
    stop();
  });

  it("gives a failed first prompt to the new thread's composer", async () => {
    const client = new FakeClient();
    client.sendResult = async () => {
      throw new HeliconError("turn rejected", 409, "turnRejected");
    };
    const { controller, stop } = await started(client, "");
    // The new-thread composer unmounts on navigation, so it must not take the text back itself.
    assert.equal(await controller.send("Write the tests"), true);
    const state = controller.store.get();
    assert.deepEqual(state.route, { kind: "thread", sessionId: "s1" });
    assert.equal(state.toasts.at(-1)?.title, "Mensagem não enviada");
    assert.equal(controller.takeDraftHandoff("other"), null);
    assert.deepEqual(controller.takeDraftHandoff("s1"), { text: "Write the tests" });
    assert.equal(controller.store.get().draftHandoff, null);
    stop();
  });

  it("hands the files back with the prompt when a first send fails", async () => {
    const client = new FakeClient();
    client.sendResult = async () => {
      throw new HeliconError("turn rejected", 409, "turnRejected");
    };
    const { controller, stop } = await started(client, "");
    const attachments = [{ name: "shot.png", mediaType: "image/png", base64: "AAAA" }];
    const previews = [{ name: "shot.png", mediaType: "image/png", kind: "image" as const, url: "blob:shot" }];
    assert.equal(await controller.send("Look at this", { attachments, previews }), true);
    // Text alone would hand back a draft asking about an image that is no longer attached to it.
    assert.deepEqual(controller.takeDraftHandoff("s1"), { text: "Look at this", attachments, previews });
    stop();
  });

  it("answers approvals itself once a thread is armed, taking allow-once over a rule", async () => {
    const client = new FakeClient();
    const request = {
      approvalId: "ap1",
      sessionId: "s1",
      currentRequirementId: null,
      subject: { kind: "command", command: "git rebase --continue" },
      availableChoices: [
        { choiceId: "remember", label: "Allow and remember", decision: "approved", scope: "session", rulePreview: "git rebase *" },
        { choiceId: "once", label: "Allow once", decision: "approved", scope: "once" },
        { choiceId: "no", label: "Reject", decision: "denied", scope: "once" },
      ],
    };
    client.transcript = async () => load({ pending: { approvals: [request], userInputs: [] } });
    const { controller, stop } = await started(client);
    // Nothing is armed yet, so the request waits for the user.
    assert.equal(Object.keys(controller.store.get().threads["s1"]!.fold.approvals).length, 1);
    assert.equal(client.decided.length, 0);

    controller.setThreadBypass("s1", true);
    await settle();
    // The remembered choice would write a standing rule into Muse's own config, so it takes the plain one.
    assert.deepEqual(client.decided, [{ approvalId: "ap1", choiceId: "once" }]);
    const fold = controller.store.get().threads["s1"]!.fold;
    assert.equal(fold.approvals["ap1"], undefined);
    assert.equal(fold.resolved["ap1"]?.resolvedBy, "bypass");
    stop();
  });

  it("leaves an approval alone when the only way to allow it writes a rule", async () => {
    const client = new FakeClient();
    const request = {
      approvalId: "ap2",
      sessionId: "s1",
      currentRequirementId: null,
      subject: { kind: "command", command: "rm -rf /tmp/scratch" },
      availableChoices: [
        { choiceId: "remember", label: "Allow and remember", decision: "approved", scope: "session", rulePreview: "rm *" },
        { choiceId: "no", label: "Reject", decision: "denied", scope: "once" },
      ],
    };
    client.transcript = async () => load({ pending: { approvals: [request], userInputs: [] } });
    const { controller, stop } = await started(client);
    controller.setThreadBypass("s1", true);
    await settle();
    // That rule would outlive the bypass that wrote it, which is the one thing it promises not to do.
    assert.deepEqual(client.decided, []);
    assert.equal(Object.keys(controller.store.get().threads["s1"]!.fold.approvals).length, 1);
    stop();
  });

  it("keeps closed dock cards out until the thread brings them back", async () => {
    const client = new FakeClient();
    const { controller, stop } = await started(client);
    const hidden = () => controller.store.get().prefs.hiddenCards;
    assert.deepEqual(hidden(), []);
    controller.setCardHidden("plan:s1", true);
    controller.setCardHidden("goal:s1", true);
    controller.setCardHidden("plan:s2", true);
    controller.setCardHidden("plan:s1", true);
    assert.deepEqual(hidden(), ["plan:s1", "goal:s1", "plan:s2"]);
    // Bringing one thread's cards back leaves another thread's alone.
    controller.showThreadCards("s1");
    assert.deepEqual(hidden(), ["plan:s2"]);
    controller.setCardHidden("plan:s2", false);
    assert.deepEqual(hidden(), []);
    stop();
  });

  it("remembers which dock cards a thread had folded away", async () => {
    const client = new FakeClient();
    const { controller, stop } = await started(client);
    const collapsed = () => controller.store.get().prefs.collapsedCards;
    // Open by default, so a thread nobody has touched costs nothing to remember.
    assert.deepEqual(collapsed(), []);

    controller.setCardOpen("goal:s1", false);
    assert.deepEqual(collapsed(), ["goal:s1"]);

    // Another thread's card is its own business.
    controller.setCardOpen("goal:s2", false);
    assert.deepEqual(collapsed(), ["goal:s1", "goal:s2"]);

    // Opening one again drops it rather than recording a second state for it.
    controller.setCardOpen("goal:s1", true);
    assert.deepEqual(collapsed(), ["goal:s2"]);

    // Closing one that is already closed leaves the list alone.
    controller.setCardOpen("goal:s2", false);
    assert.deepEqual(collapsed(), ["goal:s2"]);
    stop();
  });

  it("announces the edges of what a thread is doing, not the state it is sitting in", async () => {
    const client = new FakeClient();
    const shown: string[] = [];
    const { controller, stop } = await started(client);
    controller.attachNotifier({
      permission: async () => "granted",
      request: async () => "granted",
      show: async (note) => {
        shown.push(note.tag);
      },
    });
    controller.setPrefs({ notifications: true });
    const live = (patch: Record<string, unknown>) => ({
      activeTurnId: null,
      turnStartedAt: null,
      pendingApprovals: 0,
      pendingInputs: 0,
      lastTerminal: null,
      lastError: null,
      ...patch,
    });
    const status = async (patch: Record<string, unknown>) => {
      client.handler?.({ type: "session-status", sessionId: "s1", live: live(patch) as never });
      await settle();
    };

    // A request that has just appeared is worth saying.
    await status({ pendingApprovals: 1 });
    assert.deepEqual(shown, ["approval:s1"]);

    // The same request still sitting there is not: it was already announced once.
    await status({ pendingApprovals: 1 });
    assert.deepEqual(shown, ["approval:s1"]);

    // A turn that has just ended is an edge too, and carries whether it failed.
    await status({ activeTurnId: "t1" });
    await status({ lastTerminal: "failed", lastError: "boom" });
    assert.deepEqual(shown, ["approval:s1", "finished:s1"]);

    // A goal going quiet says so; a goal still active says nothing.
    await status({ goal: { objective: "ship", status: "active", percentComplete: 10 } });
    assert.deepEqual(shown, ["approval:s1", "finished:s1"]);
    await status({ goal: { objective: "ship", status: "complete", percentComplete: 100 } });
    assert.deepEqual(shown, ["approval:s1", "finished:s1", "goal:s1"]);
    stop();
  });

  it("marks a read-only thread and refuses to send into it", async () => {
    const client = new FakeClient();
    client.transcript = async () => load({ readOnly: true, readOnlyReason: "session is loaded by another host" });
    const { controller, stop } = await started(client);
    assert.equal(controller.store.get().threads["s1"]?.readOnly, true);
    assert.equal(await controller.send("hello"), false);
    assert.equal(client.sent.length, 0);
    stop();
  });

  it("runs slash commands, skills and shell lines instead of sending their text", async () => {
    const client = new FakeClient();
    client.skills = [
      { id: "bundled:plan", name: "plan", displayName: "plan", description: "Plan it.", shortDescription: null, scope: "bundled", activation: "on" },
      { id: "user:secret", name: "secret", displayName: "secret", description: "By hand.", shortDescription: null, scope: "user", activation: "user-invocable-only" },
    ];
    const { controller, stop } = await started(client);
    await controller.loadSkills("/work/app");
    assert.equal(controller.store.get().skills["/work/app"]?.status, "ready");

    assert.equal(await controller.send("/plan tidy the API"), true);
    assert.equal(client.sent.at(-1)?.displayText, "/plan tidy the API", "the transcript shows what was typed");
    assert.match(client.sent.at(-1)?.text ?? "", /read_skill with name "bundled:plan" first, then apply it to: tidy the API$/);
    assert.equal(await controller.send("/secret go"), true);
    assert.match(client.sent.at(-1)?.text ?? "", /<skill-body id="user:secret">\nInstructions for user:secret\.\n<\/skill-body>\n\ngo$/);

    assert.equal(await controller.send("/compact"), true);
    assert.equal(await controller.send("! git status"), true);
    assert.deepEqual(client.actions, ["compact", "shell-proxy:git status"], "Helicon runs `!` itself now");
    client.compactNoop = true;
    assert.equal(await controller.send("/compact"), true);
    assert.equal(controller.store.get().toasts.at(-1)?.title, "Nada para compactar ainda");
    assert.equal(controller.store.get().toasts.at(-1)?.detail, "Não há histórico anterior para resumir.");

    assert.equal(await controller.send("/effort high"), true);
    assert.equal(controller.store.get().prefs.effort, "high");
    assert.equal(await controller.send("/model"), true);
    assert.equal(controller.store.get().picker, "model");
    assert.equal(await controller.send("/permissions full"), true);
    assert.equal(controller.store.get().picker, "confirmFullAccess", "full access still asks first");
    controller.closePicker("permissions");
    assert.equal(controller.store.get().picker, "confirmFullAccess", "a menu closing after the hand-off leaves the dialog open");

    const before = client.sent.length;
    assert.equal(await controller.send("/deploy now"), false);
    assert.equal(controller.store.get().toasts.at(-1)?.title, "Nenhum comando chamado /deploy");
    assert.equal(client.sent.length, before);
    assert.equal(await controller.send("/deploy now", { raw: true }), true);
    assert.equal(client.sent.at(-1)?.text, "/deploy now");
    assert.equal(await controller.send("/usr/bin/node crashes on start"), true, "a path is a prompt, not a command");
    assert.equal(client.sent.at(-1)?.text, "/usr/bin/node crashes on start");
    stop();
  });

  it("waits for a workspace's skills when a skill is sent before they load", async () => {
    const client = new FakeClient();
    client.skills = [
      { id: "bundled:git", name: "git", displayName: "git", description: "Git safety.", shortDescription: null, scope: "bundled", activation: "on" },
    ];
    const { controller, stop } = await started(client);
    assert.equal(controller.store.get().skills["/work/app"], undefined);
    assert.equal(await controller.send("/git reply ok"), true);
    assert.equal(client.sent.at(-1)?.displayText, "/git reply ok");
    assert.equal(controller.store.get().skills["/work/app"]?.status, "ready");
    stop();
  });

  it("sets, pauses, resumes and clears goals through Muse's goal commands", async () => {
    const client = new FakeClient();
    const { controller, stop } = await started(client);
    assert.equal(await controller.send("/goal Ship the release"), true);
    assert.deepEqual(client.actions.at(-1), "goal:s1:set:Ship the release");
    assert.equal(client.sent.length, 0, "no prompt goes to the model: the goal command starts the work");
    assert.equal(await controller.send("/goal pause"), true);
    assert.equal(client.actions.at(-1), "goal:s1:pause");
    assert.equal(await controller.send("/goal Clear"), true, "the verbs are not case-sensitive");
    assert.equal(client.actions.at(-1), "goal:s1:clear");

    assert.equal(await controller.send("/goal"), false);
    assert.equal(controller.store.get().toasts.at(-1)?.title, "Adicione a meta depois de /goal");

    // A paused goal resumes through goal/resume; a blocked one still gets a prompt to keep going.
    assert.equal(await controller.continueGoal("s1", "Ship the release", "paused"), true);
    assert.equal(client.actions.at(-1), "goal:s1:resume");
    assert.equal(await controller.continueGoal("s1", "Ship the release", "blocked"), true);
    assert.equal(client.sent.at(-1)?.displayText, "Continuar trabalhando na meta");

    assert.equal(await controller.goalAction("s1", "edit", "Ship 0.11"), true);
    assert.equal(client.actions.at(-1), "goal:s1:edit:Ship 0.11");
    stop();
  });

  it("falls back to asking the model for a goal on a host without goal commands", async () => {
    const client = new FakeClient();
    client.goalError = new HeliconError("no such method", 409, "methodNotFound");
    const { controller, stop } = await started(client);
    assert.equal(await controller.send("/goal Ship the release"), true);
    assert.equal(client.sent.at(-1)?.displayText, "/goal Ship the release");
    assert.match(client.sent.at(-1)?.text ?? "", /create_goal tool\. Objective: Ship the release/);

    client.goalError = new HeliconError("goal is finished", 409, "goalNotPaused");
    assert.equal(await controller.goalAction("s1", "pause"), false);
    assert.equal(controller.store.get().toasts.at(-1)?.title, "Não foi possível pausar a meta");
    stop();
  });

  it("puts the open thread on the chosen effort, and leaves it be on auto", async () => {
    const client = new FakeClient();
    const { controller, stop } = await started(client);
    assert.equal(await controller.send("/effort low"), true);
    await settle();
    assert.deepEqual(client.efforts, ["s1:low"]);
    controller.setEffort(null);
    await settle();
    assert.deepEqual(client.efforts, ["s1:low"], "auto keeps the thread's own level");
    assert.equal(controller.store.get().prefs.effort, null);
    stop();
  });

  it("controls background tasks, subagents and workflow children", async () => {
    const client = new FakeClient();
    const { controller, stop } = await started(client);
    assert.equal(await controller.taskAction("s1", "background", "item-2"), true);
    assert.equal(await controller.taskAction("s1", "stop", "item-2"), true);
    assert.equal(await controller.taskAction("s1", "stopAll"), true);
    assert.equal(await controller.subagentAction("s1", "sendMessage", "sa1", "use pnpm"), true);
    assert.equal(await controller.workflowAction("s1", "retry", "run-1", { childId: "c1", attempt: 2 }), true);
    assert.deepEqual(client.actions, [
      "task:s1:background:item-2",
      "task:s1:stop:item-2",
      "task:s1:stopAll",
      "subagent:s1:sendMessage:sa1:use pnpm",
      "workflow:s1:retry:run-1:c1@2",
    ]);

    client.workflowError = new HeliconError("stale", 409, "stale_attempt");
    assert.equal(await controller.workflowAction("s1", "skip", "run-1", { childId: "c1", attempt: 1 }), false);
    assert.equal(controller.store.get().toasts.at(-1)?.title, "Esse agente já avançou");
    stop();
  });

  it("keeps the newest plan usage from boot and from the event stream", async () => {
    const client = new FakeClient();
    const reading = (percent: number, at: number) => ({
      tier: "high",
      observedAtMs: at,
      window: { usedPercent: percent, resetsAtMs: at + 1, windowDurationMins: 300 },
      weekly: { usedPercent: 3, resetsAtMs: at + 2, windowDurationMins: null },
    });
    client.plan = reading(20, 100);
    const { controller, stop } = await started(client);
    assert.equal(controller.store.get().planUsage?.window.usedPercent, 20);
    client.handler?.({ type: "plan-usage", usage: reading(35, 200) });
    assert.equal(controller.store.get().planUsage?.window.usedPercent, 35);
    client.handler?.({ type: "plan-usage", usage: reading(1, 150) });
    assert.equal(controller.store.get().planUsage?.window.usedPercent, 35, "an older reading does not replace a newer one");
    stop();
  });

  it("asks for the open thread's own skills and reloads them when Muse says they changed", async () => {
    const client = new FakeClient();
    const { controller, stop } = await started(client);
    await controller.loadSkills("/work/app");
    assert.deepEqual(client.skillSessions, ["s1"]);
    await controller.loadSkills("/work/app");
    assert.equal(client.skillSessions.length, 1, "a fresh list is reused");
    client.handler?.({ type: "msp", sessionId: "s1", method: "skill/changed", params: { sessionId: "s1" }, at: 1 });
    await settle();
    assert.equal(client.skillSessions.length, 2);
    stop();
  });

  it("opens files from paths in replies as tabs, and closes back to the tree", async () => {
    const client = new FakeClient();
    const { controller, stop } = await started(client);
    const panel = () => controller.store.get().filePanels["s1"];
    assert.equal(controller.store.get().prefs.filesOpen, false);

    assert.equal(controller.openFile("s1", "/work/app/src/app.js:4-5"), true);
    assert.equal(controller.store.get().prefs.filesOpen, true, "opening a file shows the viewer");
    assert.deepEqual(panel(), { tabs: ["src/app.js"], active: "src/app.js", tree: false, line: { start: 4, end: 5 } });
    controller.openFile("s1", "README.md");
    controller.openFile("s1", "src/app.js");
    assert.deepEqual(panel()?.tabs, ["src/app.js", "README.md"], "an open file is not opened twice");
    assert.equal(panel()?.active, "src/app.js");

    controller.closeFile("s1", "src/app.js");
    assert.deepEqual(panel(), { tabs: ["README.md"], active: "README.md", tree: false, line: null });
    controller.closeFile("s1", "README.md");
    assert.deepEqual(panel(), { tabs: [], active: null, tree: true, line: null });
    assert.equal(controller.openFile("s1", "https://helicon.sh"), false, "a web link is not a file");
    controller.toggleFiles();
    assert.equal(controller.store.get().prefs.filesOpen, false);
    stop();
  });

  it("saves a draft against the version it was opened at, and offers to overwrite a file that changed", async () => {
    const client = new FakeClient();
    const { controller, stop } = await started(client);
    const key = "/work/app\nREADME.md";
    controller.setFileDraft("/work/app", "README.md", "# edited", 100);
    controller.setFileDraft("/work/app", "README.md", "# edited more", 999);
    assert.deepEqual(controller.store.get().fileDrafts[key], { content: "# edited more", baseMtimeMs: 100 }, "the base is where editing began");

    assert.equal(await controller.saveFile("/work/app", "README.md"), 200);
    assert.deepEqual(client.writes.at(-1), { path: "README.md", content: "# edited more", baseMtimeMs: 100 });
    assert.equal(controller.store.get().fileDrafts[key], undefined);
    assert.equal(controller.store.get().fileVersions[key], 1, "a view of the file reloads after a save");

    controller.setFileDraft("/work/app", "README.md", "# mine", 200);
    client.writeError = new HeliconError("changed", 409, "fileChanged");
    assert.equal(await controller.saveFile("/work/app", "README.md"), null);
    const toast = controller.store.get().toasts.at(-1);
    assert.equal(toast?.title, "Este arquivo mudou no disco");
    assert.ok(controller.store.get().fileDrafts[key], "the edit is kept when the save is refused");
    toast?.action?.run();
    await settle();
    assert.deepEqual(client.writes.at(-1), { path: "README.md", content: "# mine", baseMtimeMs: null }, "overwrite skips the version check");
    stop();
  });

  it("keeps an unsaved markdown draft in memory across tab and thread switches, and drops it only when the tab is closed", async () => {
    const client = new FakeClient();
    const { controller, stop } = await started(client);
    const key = "/work/app\nREADME.md";
    controller.openFile("s1", "README.md");
    controller.openFile("s1", "notes.md");
    controller.setFileDraft("/work/app", "README.md", "# rascunho", 100);

    controller.activateFile("s1", "notes.md");
    assert.equal(controller.store.get().fileDrafts[key]?.content, "# rascunho", "changing tabs does not drop the draft");
    controller.openThread("s2");
    assert.equal(controller.store.get().fileDrafts[key]?.content, "# rascunho", "changing threads does not drop the draft");
    controller.toggleFiles(false);
    assert.equal(controller.store.get().fileDrafts[key]?.content, "# rascunho", "hiding the files panel does not drop the draft");

    controller.closeFile("s1", "README.md");
    assert.equal(controller.store.get().fileDrafts[key], undefined, "closing the tab discards the in-memory draft");
    stop();
  });

  it("does not write file drafts into prefs, so a new controller starts without them", async () => {
    const client = new FakeClient();
    let saved: unknown = null;
    const fake = platform();
    fake.savePrefs = (prefs) => {
      saved = prefs;
    };
    const controller = new HeliconController(client, fake);
    const stop = controller.start();
    await settle();
    await settle();
    controller.setFileDraft("/work/app", "README.md", "# rascunho", 100);
    controller.setPrefs({ filesOpen: true });
    await settle();
    controller.dispose();
    assert.equal(controller.store.get().fileDrafts["/work/app\nREADME.md"]?.content, "# rascunho");
    assert.ok(saved && typeof saved === "object");
    assert.equal("fileDrafts" in (saved as object), false, "prefs are the chrome settings, not unsaved file edits");

    const revived = new HeliconController(client, { ...platform(), loadPrefs: () => saved });
    assert.deepEqual(revived.store.get().fileDrafts, {}, "prefs alone do not restore file drafts");
    stop();
  });

  it("restores file drafts from their own store after a restart, and drops them on save or discard", async () => {
    const client = new FakeClient();
    let stored: unknown = {};
    const fake = platform();
    fake.saveFileDrafts = (drafts) => {
      stored = drafts;
    };
    fake.loadFileDrafts = () => stored;
    const controller = new HeliconController(client, fake);
    const stop = controller.start();
    await settle();
    await settle();
    controller.setFileDraft("/work/app", "README.md", "# rascunho", 100);
    controller.dispose();
    assert.deepEqual(stored, { "/work/app\nREADME.md": { content: "# rascunho", baseMtimeMs: 100 } });

    const revived = new HeliconController(client, {
      ...platform(),
      loadFileDrafts: () => stored,
      saveFileDrafts: (next) => {
        stored = next;
      },
    });
    assert.equal(revived.store.get().fileDrafts["/work/app\nREADME.md"]?.content, "# rascunho");
    const stopRevived = revived.start();
    assert.ok(revived.store.get().toasts.some((toast) => /não gravadas/.test(toast.title)));
    await settle();
    try {
      assert.equal(await revived.saveFile("/work/app", "README.md"), 200);
      assert.deepEqual(stored, {});
      revived.setFileDraft("/work/app", "notes.md", "# outra", 50);
      revived.setFileDraft("/work/app", "notes.md", null);
      assert.deepEqual(stored, {});
    } finally {
      stopRevived();
    }
  });

  it("asks before closing the window when a file draft exists, without writing the original file", async () => {
    const client = new FakeClient();
    const fake = platform();
    const guards: Array<(options: { dialog: boolean }) => boolean> = [];
    const asked: string[] = [];
    fake.onBeforeClose = (handler) => {
      guards.push(handler);
      return () => {};
    };
    fake.confirmLeave = (message) => {
      asked.push(message);
      return false;
    };
    const controller = new HeliconController(client, fake);
    const stop = controller.start();
    await settle();
    await settle();
    assert.equal(guards[0]?.({ dialog: true }), true, "closing with no draft is free");
    controller.setFileDraft("/work/app", "README.md", "# rascunho", 100);
    assert.equal(guards[0]?.({ dialog: false }), false, "browser unload keeps the generic warning");
    assert.equal(asked.length, 0);
    assert.equal(guards[0]?.({ dialog: true }), false, "desktop close can stay on the app");
    assert.equal(asked.length, 1);
    assert.equal(client.writes.length, 0);
    stop();
  });

  it("keeps going when the recoverable copy cannot be stored", async () => {
    const client = new FakeClient();
    const fake = platform();
    fake.saveFileDrafts = () => {
      throw new Error("quota");
    };
    const controller = new HeliconController(client, fake);
    const stop = controller.start();
    await settle();
    await settle();
    controller.setFileDraft("/work/app", "README.md", "# rascunho", 100);
    controller.dispose();
    assert.equal(controller.store.get().fileDrafts["/work/app\nREADME.md"]?.content, "# rascunho");
    assert.match(controller.store.get().toasts.at(-1)?.title ?? "", /não foi guardada/i);
    stop();
  });

  it("reloads an open file when Muse edits it", async () => {
    const client = new FakeClient();
    const { controller, stop } = await started(client);
    client.handler?.({
      type: "msp",
      sessionId: "s1",
      method: "item/completed",
      params: {
        sessionId: "s1",
        item: {
          itemId: "e1",
          kind: "toolCall",
          status: "completed",
          revision: 2,
          tool: "edit",
          args: JSON.stringify({ path: "/work/app/src/app.js", old_string: "a", new_string: "b" }),
        },
      },
      at: 1,
    });
    await settle();
    controller.flush();
    assert.equal(controller.store.get().fileVersions["/work/app\nsrc/app.js"], 1);
    stop();
  });

  it("reads a tool's stored output page by page", async () => {
    const client = new FakeClient();
    const { controller, stop } = await started(client);
    const first = await controller.readOutput("s1", "i1", "ref");
    assert.equal(first.eof, false);
    const next = await controller.readOutput("s1", "i1", "ref", first.offsetBytes + first.byteLen);
    assert.equal(next.eof, true);
    stop();
  });

  it("runs a `!` command itself and hands its output to Muse on request", async () => {
    const client = new FakeClient();
    const { controller, stop } = await started(client);
    assert.equal(await controller.send("!ls -la"), true);
    const run = controller.store.get().threads["s1"]?.shellRuns[0];
    assert.equal(run?.command, "ls -la");
    assert.ok(client.actions.includes("shell-proxy:ls -la"));

    assert.equal(await controller.sendShellOutput("s1", run!), true);
    const sent = client.sent.at(-1);
    assert.match(sent?.text ?? "", /I ran this in the workspace/);
    assert.match(sent?.text ?? "", /ran ls -la/);
    assert.equal(sent?.displayText, "Compartilhou a saída de `ls -la`");
    stop();
  });

  it("starts a thread beside one whose reasoning cannot be replayed", async () => {
    const client = new FakeClient();
    const { controller, stop } = await started(client);
    assert.equal(await controller.freshThread("s1", "pick this up again"), true);
    assert.equal(client.sent.at(-1)?.text, "pick this up again");
    assert.equal(controller.store.get().route.kind, "thread");

    // A prompt the transcript showed as `/goal …` runs as the goal command again, not as the literal text.
    const sent = client.sent.length;
    assert.equal(await controller.freshThread("s1", "/goal ship the release"), true);
    assert.equal(client.actions.at(-1), "goal:s1:set:ship the release");
    assert.equal(client.sent.length, sent);
    stop();
  });

  it("compacts a thread the provider will not take, then sends the prompt again", async () => {
    const client = new FakeClient();
    const { controller, stop } = await started(client);
    await controller.compactAndRetry("s1", "try that again");
    assert.ok(client.actions.includes("compact"), "the history is summarized first");
    assert.equal(client.sent.at(-1)?.text, "try that again");
    assert.equal(client.sent.at(-1)?.ifBusy, "queue", "the retry waits behind the compaction turn");

    let before = client.sent.length;
    await controller.compactAndRetry("s1", null);
    assert.equal(client.sent.length, before, "with no prompt to resend, it only compacts");

    // A compaction Muse refused leaves the history exactly as it was, so resending would fail the same way.
    before = client.sent.length;
    client.compactNoop = true;
    await controller.compactAndRetry("s1", "try that again");
    assert.equal(client.sent.length, before, "nothing is resent after a noop compaction");
    client.compactNoop = false;
    client.compact = async () => {
      throw new Error("no");
    };
    await controller.compactAndRetry("s1", "try that again");
    assert.equal(client.sent.length, before, "nor after one that failed");
    stop();
  });

  it("clears a failed turn's notice when the user retries it", async () => {
    const client = new FakeClient();
    const { controller, stop } = await started(client);
    client.handler?.({
      type: "msp",
      sessionId: "s1",
      method: "turn/completed",
      params: { sessionId: "s1", turnId: "t7", terminal: "failed", error: { kind: "rateLimit", message: "quota", retryable: true } },
      at: 5,
    });
    await settle();
    assert.equal(controller.store.get().threads["s1"]?.fold.turns["t7"]?.error?.message, "quota");

    controller.dismissTurnError("s1", "t7");
    const info = controller.store.get().threads["s1"]?.fold.turns["t7"];
    assert.equal(info?.error, undefined);
    assert.equal(info?.dismissed, true);
    // Remembered outside the fold too, which a reload rebuilds from history with the error back in it.
    assert.deepEqual(controller.store.get().prefs.dismissedTurnErrors, ["s1:t7"]);
    controller.dismissTurnError("s1", "t7");
    assert.deepEqual(controller.store.get().prefs.dismissedTurnErrors, ["s1:t7"]);
    stop();
  });

  it("reorders projects by drag, and puts them back when the server refuses", async () => {
    const client = new FakeClient();
    const project = (cwd: string) => ({ cwd, displayName: cwd.slice(6), pinned: false, activityAt: SESSION.activityAt });
    client.listProjects = async () => [project("/work/a"), project("/work/b"), project("/work/c")];
    const { controller, stop } = await started(client);
    const order = () => controller.store.get().projects.map((p) => p.cwd);

    await controller.reorderProjects("/work/c", "/work/a");
    assert.deepEqual(order(), ["/work/c", "/work/a", "/work/b"]);
    assert.deepEqual(client.orders.at(-1), ["/work/c", "/work/a", "/work/b"]);

    await controller.reorderProjects("/work/c", null);
    assert.deepEqual(order(), ["/work/a", "/work/b", "/work/c"], "dropping past the last row sends it to the end");

    client.setProjectOrder = async () => {
      throw new Error("nope");
    };
    await controller.reorderProjects("/work/c", "/work/a");
    assert.deepEqual(order(), ["/work/a", "/work/b", "/work/c"], "a refused move snaps back");
    stop();
  });

  it("sends attached files with a prompt, and shows them while it is in flight", async () => {
    const client = new FakeClient();
    const { controller, stop } = await started(client);
    const sent = await controller.send("look at this", {
      attachments: [{ name: "shot.png", mediaType: "image/png", base64: "AAAB" }],
      previews: [{ name: "shot.png", mediaType: "image/png", kind: "image", url: "blob:preview" }],
    });
    assert.equal(sent, true);
    assert.deepEqual(client.sent.at(-1)?.attachments, [{ name: "shot.png", mediaType: "image/png", base64: "AAAB" }]);
    assert.equal(controller.store.get().threads["s1"]?.fold.echoes.at(-1)?.attachments?.[0]?.url, "blob:preview");

    assert.equal(
      await controller.send("", { attachments: [{ name: "notes.pdf", mediaType: "application/pdf", base64: "AAAC" }] }),
      true,
      "a file with no text still sends",
    );
    assert.equal(await controller.send(""), false, "nothing to send is still nothing");
    stop();
  });

  it("hands a `!` command the host could not run to the agent", async () => {
    const client = new FakeClient();
    const { controller, stop } = await started(client);
    assert.equal(await controller.askToRun("s1", "ls -la"), true);
    assert.match(client.sent.at(-1)?.text ?? "", /```sh\nls -la\n```/);
    assert.match(client.sent.at(-1)?.text ?? "", /your own shell works/, "the agent is told its own shell is fine");
    assert.equal(await controller.askToRun("s1", "echo '```'"), true);
    assert.match(client.sent.at(-1)?.text ?? "", /````sh\necho '```'\n````/, "a fence in the command gets a longer fence around it");
    assert.equal(await controller.askToRun("s1", "printf '~~~\\n'"), true);
    assert.match(client.sent.at(-1)?.text ?? "", /```sh\nprintf '~~~\\n'\n```/, "a tilde run in the command changes nothing");
    stop();
  });

  it("forks a thread and opens the fork", async () => {
    const client = new FakeClient();
    const { controller, stop } = await started(client);
    // Opening the fork loads its transcript, which carries the fork's own summary.
    client.transcript = async () => load({ session: { ...SESSION, sessionId: "s2", title: "Probe (fork)" } });
    assert.equal(await controller.send("/fork"), true);
    const state = controller.store.get();
    assert.deepEqual(state.route, { kind: "thread", sessionId: "s2" });
    assert.equal(state.sessions["s2"]?.title, "Probe (fork)");
    assert.equal(state.toasts.at(-1)?.title, "Ramificada numa nova conversa");
    stop();
  });

  it("walks interface zoom through its fixed steps and back to 100%", async () => {
    const client = new FakeClient();
    const { controller, stop } = await started(client);
    const zoom = () => controller.store.get().prefs.zoom;
    assert.equal(zoom(), 1);
    controller.zoomIn();
    assert.equal(zoom(), 1.1);
    controller.zoomIn();
    assert.equal(zoom(), 1.2);
    controller.zoomOut();
    controller.zoomOut();
    assert.equal(zoom(), 1);
    controller.zoomOut();
    assert.equal(zoom(), 0.9);
    controller.resetZoom();
    assert.equal(zoom(), 1);
    stop();
  });

  it("clamps interface zoom to its ends and drops malformed saved values", async () => {
    const client = new FakeClient();
    const { controller, stop } = await started(client);
    controller.setZoom(5);
    assert.equal(controller.store.get().prefs.zoom, ZOOM_MAX);
    controller.zoomIn();
    assert.equal(controller.store.get().prefs.zoom, ZOOM_MAX);
    controller.setZoom(0.05);
    assert.equal(controller.store.get().prefs.zoom, ZOOM_MIN);
    controller.zoomOut();
    assert.equal(controller.store.get().prefs.zoom, ZOOM_MIN);
    controller.setZoom(1.234);
    assert.equal(controller.store.get().prefs.zoom, 1.23);
    stop();
    const revived = new HeliconController(client, { ...platform(), loadPrefs: () => ({ zoom: 99 }) });
    assert.equal(revived.store.get().prefs.zoom, 1);
  });

  it("returns from settings and usage to the thread they were opened from", async () => {
    const client = new FakeClient();
    const { controller, stop } = await started(client);
    controller.navigate({ kind: "settings" });
    assert.deepEqual(controller.store.get().route, { kind: "settings" });
    controller.goBack();
    assert.deepEqual(controller.store.get().route, { kind: "thread", sessionId: "s1" });
    controller.navigate({ kind: "usage" });
    // Moving between the two pages keeps the thread as the way back, not the other page.
    controller.navigate({ kind: "settings" });
    controller.goBack();
    assert.deepEqual(controller.store.get().route, { kind: "thread", sessionId: "s1" });
    stop();
  });

  it("returns from settings to a fresh-thread route", async () => {
    const client = new FakeClient();
    const { controller, stop } = await started(client, "");
    controller.newThread();
    assert.deepEqual(controller.store.get().route, { kind: "new", cwd: "/work/app" });
    controller.navigate({ kind: "settings" });
    controller.goBack();
    assert.deepEqual(controller.store.get().route, { kind: "new", cwd: "/work/app" });
    stop();
  });

  it("falls back to home when there is nowhere to go back to", async () => {
    const client = new FakeClient();
    const { controller, stop } = await started(client, "#/settings");
    assert.deepEqual(controller.store.get().route, { kind: "settings" });
    controller.goBack();
    assert.deepEqual(controller.store.get().route, { kind: "home" });
    stop();
  });

  it("falls back to home when the return thread is gone", async () => {
    const client = new FakeClient();
    const { controller, stop } = await started(client);
    controller.navigate({ kind: "settings" });
    await controller.archive("s1");
    controller.goBack();
    assert.deepEqual(controller.store.get().route, { kind: "home" });
    stop();
  });
});

describe("staleThreadReason", () => {
  const NOW = 1_000_000;

  it("leaves idle threads alone", () => {
    assert.equal(staleThreadReason(null, null, NOW - 60_000, NOW), null);
    assert.equal(staleThreadReason(null, "t1", NOW - 600_000, NOW), null);
  });

  it("leaves threads without an applied stamp alone", () => {
    assert.equal(staleThreadReason("t1", null, null, NOW), null);
  });

  it("reloads a fold still showing a turn the server finished", () => {
    assert.equal(staleThreadReason("t1", null, NOW - 30_000, NOW), null);
    assert.equal(staleThreadReason("t1", null, NOW - 30_001, NOW), "diverged");
    assert.equal(staleThreadReason("t1", undefined, NOW - 31_000, NOW), "diverged");
  });

  it("reloads a turn both sides agree is running but silent", () => {
    assert.equal(staleThreadReason("t1", "t1", NOW - 90_000, NOW), null);
    assert.equal(staleThreadReason("t1", "t1", NOW - 90_001, NOW), "quiet");
  });
});

describe("stale thread watchdog", () => {
  function watchPlatform() {
    const base = platform("#/t/s1");
    let now = 1_000_000;
    const timers: ({ fn: () => void; ms: number } | null)[] = [];
    const fake: Platform = {
      ...base,
      now: () => now,
      schedule: (fn: () => void, ms: number) => {
        timers.push({ fn, ms });
        return timers.length - 1;
      },
      cancel: (handle: unknown) => {
        if (typeof handle === "number") {
          timers[handle] = null;
        }
      },
    };
    return {
      fake,
      setNow: (value: number) => {
        now = value;
      },
      runStaleChecks: () => {
        for (const [index, timer] of [...timers].entries()) {
          if (timer && timer.ms === 30_000) {
            timers[index] = null;
            timer.fn();
          }
        }
      },
    };
  }

  const runningLoad = (): TranscriptLoad =>
    load({
      msp: { status: "running", activeTurnId: "live-1", modelId: "muse-spark-1.3", approvalMode: "onRequest", workspaceRoot: "/work/app", turnCount: 4 },
      events: [...historyEvents, { method: "turn/started", params: { turnId: "live-1" }, at: 1 }],
    });

  async function startedWatching(client: FakeClient) {
    const watch = watchPlatform();
    const controller = new HeliconController(client, watch.fake);
    const stop = controller.start();
    await settle();
    await settle();
    return { controller, stop, ...watch };
  }

  async function exhaustRecovery(client: FakeClient) {
    const watch = await startedWatching(client);
    for (const now of [1_031_000, 1_062_000]) {
      watch.setNow(now);
      watch.runStaleChecks();
      await settle();
      assert.equal(watch.controller.store.get().threads["s1"]?.stalled, false);
    }
    watch.setNow(1_093_000);
    watch.runStaleChecks();
    await settle();
    assert.equal(watch.controller.store.get().threads["s1"]?.stalled, true);
    return watch;
  }

  it("shows silence after two reloads and renews the budget only on explicit retry", async () => {
    const client = new FakeClient();
    let loads = 0;
    client.transcript = async () => { loads += 1; return runningLoad(); };
    const { controller, stop, setNow, runStaleChecks } = await exhaustRecovery(client);
    assert.equal(loads, 3);
    await controller.loadThread("s1");
    setNow(1_124_000); runStaleChecks(); await settle();
    assert.equal(loads, 4, "ordinary reload keeps the automatic budget exhausted");
    await controller.retryStalledThread("s1");
    assert.equal(loads, 5);
    assert.equal(controller.store.get().threads["s1"]?.stalled, true, "unchanged history keeps the notice");
    for (const now of [1_155_000, 1_186_000, 1_217_000]) {
      setNow(now); runStaleChecks(); await settle();
    }
    assert.equal(loads, 7, "explicit retry allows only two further automatic reloads");
    assert.equal(client.sent.length, 0, "reading history never sends a prompt");
    stop();
  });

  it("clears the silence notice when the stream resumes without renewing the same turn budget", async () => {
    const client = new FakeClient();
    let loads = 0;
    client.transcript = async () => { loads += 1; return runningLoad(); };
    const { controller, stop, setNow, runStaleChecks } = await exhaustRecovery(client);
    client.handler?.({ type: "msp", sessionId: "s1", method: "item/started", params: {
      item: { itemId: "resumed", kind: "agentMessage", status: "inProgress", revision: 1 },
    }, at: 2 });
    controller.flush();
    assert.equal(controller.store.get().threads["s1"]?.stalled, false);
    setNow(1_124_000); runStaleChecks(); await settle();
    assert.equal(loads, 3);
    assert.equal(controller.store.get().threads["s1"]?.stalled, true);
    client.handler?.({ type: "msp", sessionId: "s1", method: "turn/completed", params: { turnId: "live-1" }, at: 3 });
    controller.flush();
    setNow(1_200_000); runStaleChecks();
    assert.equal(controller.store.get().threads["s1"]?.stalled, false);
    stop();
  });

  it("clears the notice when history finishes or moves to another turn", async () => {
    for (const finished of [false, true]) {
      const client = new FakeClient();
      client.transcript = async () => runningLoad();
      const { controller, stop } = await exhaustRecovery(client);
      client.transcript = async () => finished ? load() : {
        ...runningLoad(), msp: { ...runningLoad().msp!, activeTurnId: "live-2" },
      };
      await controller.retryStalledThread("s1");
      assert.equal(controller.store.get().threads["s1"]?.stalled, false);
      stop();
    }
  });

  it("keeps the notice on load failure and clears it on events buffered during retry", async () => {
    const client = new FakeClient();
    client.transcript = async () => runningLoad();
    const { controller, stop } = await exhaustRecovery(client);
    client.transcript = async () => { throw new Error("offline"); };
    await controller.retryStalledThread("s1");
    assert.equal(controller.store.get().threads["s1"]?.load, "error");
    assert.equal(controller.store.get().threads["s1"]?.stalled, true);
    let resolve!: (value: TranscriptLoad) => void;
    client.transcript = () => new Promise(r => { resolve = r; });
    const retry = controller.retryStalledThread("s1");
    client.handler?.({ type: "msp", sessionId: "s1", method: "item/started", params: {
      item: { itemId: "buffered", kind: "agentMessage", status: "inProgress", revision: 1 },
    }, at: 2 });
    resolve(runningLoad());
    await retry;
    assert.equal(controller.store.get().threads["s1"]?.stalled, false);
    stop();
  });

  it("cancels recovery on disposal and resumes it when the controller starts again", async () => {
    const client = new FakeClient();
    let loads = 0;
    client.transcript = async () => { loads += 1; return runningLoad(); };
    const { controller, stop, setNow, runStaleChecks } = await startedWatching(client);
    stop();
    setNow(1_031_000);
    runStaleChecks();
    assert.equal(loads, 1, "a disposed controller never reloads");
    const stopAgain = controller.start();
    await settle();
    await settle();
    const before = loads;
    setNow(1_100_000);
    runStaleChecks();
    await settle();
    assert.equal(loads, before + 1, "restart restores the recovery timer");
    stopAgain();
  });

  it("keeps the exhausted budget across navigation and gives a new turn two reloads", async () => {
    const client = new FakeClient();
    let loads = 0;
    let turnId = "live-1";
    client.transcript = async () => {
      loads += 1;
      const result = runningLoad();
      return { ...result, msp: { ...result.msp!, activeTurnId: turnId } };
    };
    const { controller, stop, setNow, runStaleChecks } = await startedWatching(client);
    for (const now of [1_031_000, 1_062_000, 1_093_000]) {
      setNow(now); runStaleChecks(); await settle();
    }
    assert.equal(loads, 3);
    await controller.loadThread("s1");
    setNow(1_124_000); runStaleChecks(); await settle();
    assert.equal(loads, 4, "ordinary reloads do not reset the automatic budget");
    turnId = "live-2";
    client.handler?.({ type: "msp", sessionId: "s1", method: "turn/started", params: { turnId }, at: 2 });
    controller.flush();
    for (const now of [1_155_000, 1_186_000, 1_217_000]) {
      setNow(now); runStaleChecks(); await settle();
    }
    assert.equal(loads, 6, "a new turn gets exactly two automatic reloads");
    stop();
  });

  it("keeps a buffered ending when overlapping recovery reads partial history", async () => {
    const client = new FakeClient();
    client.transcript = async () => runningLoad();
    const { controller, stop, setNow, runStaleChecks } = await startedWatching(client);
    let resolve!: (value: TranscriptLoad) => void;
    let loads = 0;
    client.transcript = () => { loads += 1; return new Promise(r => { resolve = r; }); };
    setNow(1_031_000); runStaleChecks();
    const overlap = controller.loadThread("s1");
    client.handler?.({ type: "msp", sessionId: "s1", method: "turn/completed", params: { turnId: "live-1" }, at: 2 });
    resolve({ ...runningLoad(), truncated: true, events: [] });
    await overlap;
    assert.equal(loads, 1);
    assert.equal(controller.store.get().threads["s1"]?.fold.activeTurnId, null);
    assert.equal(controller.store.get().threads["s1"]?.truncated, true);
    setNow(1_200_000); runStaleChecks();
    assert.equal(loads, 1, "a completed turn no longer needs recovery");
    stop();
  });

  it("releases a failed shared load so a manual retry can succeed", async () => {
    const client = new FakeClient();
    client.transcript = async () => runningLoad();
    const { controller, stop, setNow, runStaleChecks } = await startedWatching(client);
    let reject!: (reason: Error) => void;
    client.transcript = () => new Promise((_resolve, r) => { reject = r; });
    setNow(1_031_000); runStaleChecks();
    const overlap = controller.loadThread("s1");
    reject(new Error("offline"));
    await overlap;
    assert.equal(controller.store.get().threads["s1"]?.load, "error");
    client.transcript = async () => load();
    await controller.loadThread("s1");
    assert.equal(controller.store.get().threads["s1"]?.load, "ready");
    assert.equal(controller.store.get().threads["s1"]?.fold.activeTurnId, null);
    stop();
  });

  it("reloads a thread whose ending never landed", async () => {
    const client = new FakeClient();
    let loads = 0;
    client.transcript = async () => {
      loads += 1;
      return runningLoad();
    };
    const { stop, setNow, runStaleChecks } = await startedWatching(client);
    assert.equal(loads, 1);
    runStaleChecks();
    assert.equal(loads, 1, "a thread that just applied anything is left alone");
    setNow(1_000_000 + 31_000);
    runStaleChecks();
    await settle();
    await settle();
    assert.equal(loads, 2, "a fold still showing a finished turn reloads from history");
    runStaleChecks();
    assert.equal(loads, 2, "a fresh reload is not reloaded again at once");
    setNow(1_000_000 + 62_000);
    runStaleChecks();
    await settle();
    await settle();
    assert.equal(loads, 3, "a thread that stays silent is retried once per grace period");
    setNow(1_000_000 + 93_000);
    runStaleChecks();
    await settle();
    await settle();
    assert.equal(loads, 3, "a turn history never finishes stops being refetched");
    stop();
  });

  it("reloads a turn both sides agree is running but silent", async () => {
    const client = new FakeClient();
    let loads = 0;
    client.transcript = async () => {
      loads += 1;
      return runningLoad();
    };
    const { stop, setNow, runStaleChecks } = await startedWatching(client);
    client.handler?.({
      type: "session-status",
      sessionId: "s1",
      live: { activeTurnId: "live-1", turnStartedAt: null, pendingApprovals: 0, pendingInputs: 0, lastTerminal: null, lastError: null },
    });
    setNow(1_000_000 + 60_000);
    runStaleChecks();
    assert.equal(loads, 1, "a quiet-but-running turn gets a longer grace period");
    setNow(1_000_000 + 91_000);
    runStaleChecks();
    await settle();
    await settle();
    assert.equal(loads, 2);
    stop();
  });

  it("leaves idle threads and threads already loading alone", async () => {
    const client = new FakeClient();
    let loads = 0;
    client.transcript = async () => {
      loads += 1;
      return load();
    };
    const { controller, stop, setNow, runStaleChecks } = await startedWatching(client);
    assert.equal(loads, 1);
    setNow(1_000_000 + 900_000);
    runStaleChecks();
    assert.equal(loads, 1, "an idle thread never reloads itself");

    let resolve!: (value: TranscriptLoad) => void;
    client.transcript = () => {
      loads += 1;
      return new Promise<TranscriptLoad>((r) => (resolve = r));
    };
    const loading = controller.loadThread("s1");
    await settle();
    assert.equal(controller.store.get().threads["s1"]?.load, "loading");
    runStaleChecks();
    resolve(load());
    await loading;
    await settle();
    assert.equal(loads, 2, "a reload never piles onto a load already in flight");
    stop();
  });

  it("records shell identity without attaching an updater", () => {
    const controller = new HeliconController(new FakeClient(), platform());
    assert.equal(controller.store.get().identity, null);
    assert.equal(controller.store.get().updates, null);
    assert.equal(controller.store.get().prefs.autoUpdate, false);
    controller.attachIdentity({
      version: "0.12.4",
      channel: "teste",
      productName: "Helicon Teste",
      identifier: "app.helicon.desktop.test",
      build: "7b98355",
      updateUrl: "https://github.com/nattanfx/helicon/actions/workflows/test-windows.yml",
    });
    assert.equal(controller.store.get().identity?.channel, "teste");
    assert.equal(controller.store.get().identity?.version, "0.12.4");
    assert.equal(controller.store.get().updates, null);
  });
});
