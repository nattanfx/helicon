import type {
  ApprovalMode,
  ApprovalRequest,
  ContextUsage,
  Goal,
  MspItem,
  TodoItem,
  TokenTotals,
  TranscriptLoad,
  UserInputAnswer,
  UserInputRequest,
  ViewEvent,
} from "../types.js";
import { EMPTY_TURN_ERROR } from "./errors.js";

/**
 * The per-thread fold of the MSP view stream. Pure and immutable: every apply returns a new
 * object (or the same one when nothing changed), so React can compare by reference.
 */

export interface TurnInfo {
  turnId: string;
  startedAt?: number;
  completedAt?: number;
  terminal?: string;
  durationMs?: number;
  /** Time to the first streamed token, when the host measured it. */
  firstTokenMs?: number;
  /** The model text streaming in right now, for a live speed estimate. A pause starts a new burst. */
  stream?: { chars: number; startAt: number; lastAt: number };
  error?: { kind: string; message: string; retryable: boolean };
  /** The user acted on the failure notice, so the transcript stops showing it. */
  dismissed?: boolean;
  retry?: { attempt: number; maxAttempts: number; nextAttempt: number; reason: string; retryDelayMs: number };
  retracted?: boolean;
}

/** A prompt the user sent that the stream has not echoed back yet. */
/** A file going out with a prompt that has not landed yet; `url` is a local object URL while it is in flight. */
export interface EchoAttachment {
  name: string;
  mediaType: string;
  kind: "image" | "file";
  url: string | null;
}

export interface LocalEcho {
  localId: string;
  text: string;
  turnId: string | null;
  disposition: "sending" | "started" | "queued" | "steered";
  createdAt: number;
  attachments?: EchoAttachment[];
}

/** One model call's usage, from its `session/tokenUsage` event. */
export interface CallUsage {
  turnId: string | null;
  modelId: string | null;
  /** Prompt tokens counted once under the provider's cache convention. */
  promptTokens: number;
  outputTokens: number;
  inputTokens: number;
  cachedTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  durationMs: number | null;
}

export interface ThreadMeta {
  todoList: TodoItem[] | null;
  branch: string | null;
  contextUsage: ContextUsage | null;
  tokenTotals: TokenTotals | null;
  /** Every model call's usage, keyed by view cursor so a reloaded history never counts one twice. */
  calls: Record<string, CallUsage>;
  modelId: string | null;
  approvalMode: ApprovalMode | null;
  goal: Goal | null;
  /** A goal change arrived, so a null goal means cleared rather than never set. */
  goalSeen: boolean;
  /** When the current objective first appeared live; the goal record's own start time is preferred. */
  goalSince: number | null;
  /** When the goal's status last changed live, so a paused or finished goal's clock stops there. */
  goalStatusAt: number | null;
  /** Stretches the goal spent paused or blocked, seen live; its running time and counts leave them out. */
  goalPauses: { from: number; to: number | null }[];
}

export interface ThreadFold {
  items: Record<string, MspItem>;
  /** Item ids in first-opened order. */
  order: string[];
  turns: Record<string, TurnInfo>;
  activeTurnId: string | null;
  /** Pending approvals and questions for this thread, keyed by id. */
  approvals: Record<string, ApprovalRequest>;
  userInputs: Record<string, UserInputRequest>;
  resolved: Record<string, { decision: string; resolvedBy: string }>;
  settled: Record<string, { outcome: string; answers: UserInputAnswer[] }>;
  echoes: LocalEcho[];
  meta: ThreadMeta;
  /** The host unloaded the session; the next command must resume it first. */
  closed: boolean;
}

export const HIDDEN_KINDS: ReadonlySet<string> = new Set(["reminderChild"]);

export function emptyFold(): ThreadFold {
  return {
    items: {},
    order: [],
    turns: {},
    activeTurnId: null,
    approvals: {},
    userInputs: {},
    resolved: {},
    settled: {},
    echoes: [],
    meta: {
      todoList: null,
      branch: null,
      contextUsage: null,
      tokenTotals: null,
      calls: {},
      modelId: null,
      approvalMode: null,
      goal: null,
      goalSeen: false,
      goalSince: null,
      goalStatusAt: null,
      goalPauses: [],
    },
    closed: false,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOr(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** A goal block from `session/goalChanged`, or null when it is not one. Odd field types fall back to safe values. */
function asGoal(value: unknown): Goal | null {
  const record = asRecord(value);
  const objective = record ? str(record["objective"]) : null;
  if (!record || !objective) {
    return null;
  }
  return {
    objective,
    status: str(record["status"]) ?? "active",
    percentComplete: numberOr(record["percentComplete"]) ?? 0,
    currentWork: str(record["currentWork"]) ?? undefined,
    nextWork: str(record["nextWork"]) ?? undefined,
  };
}

function asItem(value: unknown): MspItem | null {
  const record = asRecord(value);
  if (!record || typeof record["itemId"] !== "string" || typeof record["kind"] !== "string") {
    return null;
  }
  return {
    ...record,
    status: typeof record["status"] === "string" ? record["status"] : "completed",
    revision: typeof record["revision"] === "number" ? record["revision"] : 1,
  } as MspItem;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isApprovalMode(value: unknown): value is ApprovalMode {
  return value === "allowAll" || value === "denyUnmatched" || value === "onRequest" || value === "promptUnmatched";
}

/** Mutable working copy used inside one batch; collections are copied once, on first write. */
/** Which of the fold's maps a batch of events can write to, so the rest are shared rather than copied. */
interface Touched {
  items: boolean;
  turns: boolean;
  approvals: boolean;
  userInputs: boolean;
}

/** What each event method writes to. An unknown method copies nothing, because it changes nothing here either. */
function touchedBy(events: readonly ViewEvent[]): Touched {
  const touches: Touched = { items: false, turns: false, approvals: false, userInputs: false };
  for (const event of events) {
    const method = event.method;
    if (method.startsWith("item/")) {
      touches.items = true;
      // A delta's characters count towards its turn's streaming speed.
      touches.turns = true;
    } else if (method.startsWith("turn/")) {
      touches.turns = true;
      // A retracted prompt is marked on the item as well as the turn.
      touches.items = true;
    } else if (method.startsWith("approval/")) {
      touches.approvals = true;
    } else if (method.startsWith("userInput/")) {
      touches.userInputs = true;
    }
  }
  return touches;
}

class Draft {
  fold: ThreadFold;
  private orderCopied = false;
  private echoesCopied = false;
  private callsCopied = false;

  /**
   * Only the maps this batch can write to are copied. A long thread holds tens of thousands of items, and copying
   * every map for every batch made applying a stream cost time in the square of the thread's length: a thread with
   * subagents in it, which produce far more items than anything else, would slow to a stop and never recover.
   */
  constructor(base: ThreadFold, touches: Touched) {
    this.fold = {
      ...base,
      ...(touches.items ? { items: { ...base.items } } : {}),
      ...(touches.turns ? { turns: { ...base.turns } } : {}),
      ...(touches.approvals ? { approvals: { ...base.approvals }, resolved: { ...base.resolved } } : {}),
      ...(touches.userInputs ? { userInputs: { ...base.userInputs }, settled: { ...base.settled } } : {}),
      // Small, and nearly every event reads or writes something in it.
      meta: { ...base.meta },
    };
  }

  pushOrder(id: string): void {
    if (!this.orderCopied) {
      this.fold.order = [...this.fold.order];
      this.orderCopied = true;
    }
    this.fold.order.push(id);
  }

  removeEcho(index: number): void {
    if (!this.echoesCopied) {
      this.fold.echoes = [...this.fold.echoes];
      this.echoesCopied = true;
    }
    this.fold.echoes.splice(index, 1);
  }

  patchEcho(index: number, patch: Partial<LocalEcho>): void {
    if (!this.echoesCopied) {
      this.fold.echoes = [...this.fold.echoes];
      this.echoesCopied = true;
    }
    this.fold.echoes[index] = { ...(this.fold.echoes[index] as LocalEcho), ...patch };
  }

  putCall(key: string, call: CallUsage): void {
    if (!this.callsCopied) {
      this.fold.meta.calls = { ...this.fold.meta.calls };
      this.callsCopied = true;
    }
    this.fold.meta.calls[key] = call;
  }
}

function upsertItem(draft: Draft, incoming: MspItem): void {
  const d = draft.fold;
  // Subagent children are never rendered, and a plan that runs subagents produces far more of them than of anything
  // else. Keeping them would grow the fold without ever showing a line of it, and every later event pays for that.
  if (HIDDEN_KINDS.has(incoming.kind)) {
    return;
  }
  const current = d.items[incoming.itemId];
  if (!current) {
    d.items[incoming.itemId] = incoming;
    draft.pushOrder(incoming.itemId);
    if (incoming.kind === "userMessage") {
      matchEcho(draft, incoming);
    }
    return;
  }
  const currentDone = current.status !== "inProgress";
  const incomingDone = incoming.status !== "inProgress";
  const newer =
    incoming.revision > current.revision ||
    current.revision === 0 ||
    (incoming.revision === current.revision && incomingDone && !currentDone);
  if (!newer) {
    return;
  }
  const next: MspItem = { ...incoming };
  // A final that arrives empty keeps what already streamed in.
  if (!next.text && current.text) {
    next.text = current.text;
  }
  if (!next.visibleOutput && current.visibleOutput) {
    next.visibleOutput = current.visibleOutput;
  }
  if ((!next.summary || next.summary.length === 0) && current.summary && current.summary.length > 0) {
    next.summary = current.summary;
  }
  if (next.turnId === undefined && current.turnId !== undefined) {
    next.turnId = current.turnId;
  }
  d.items[incoming.itemId] = next;
  // A later revision can bring the shown text (`displayText`) the first one lacked, so match again.
  if (next.kind === "userMessage") {
    matchEcho(draft, next);
  }
}

/** Both forms of a prompt: what the transcript shows and what the model got; a local echo holds one of them. */
function promptTexts(item: MspItem): Set<string> {
  return new Set([item.displayText, item.text].filter((t): t is string => Boolean(t)).map((t) => normalizeText(t)));
}

/**
 * Whether a prompt item is an echo's server copy. Text decides, except for echoes carrying
 * attachments: an image-only prompt echoes back empty, and attached files arrive appended as
 * `@.helicon/attachments/...` mentions, so a turn-linked echo then matches by identity instead.
 */
function echoMatchesItem(echo: LocalEcho, item: MspItem, texts: Set<string>): boolean {
  const echoText = normalizeText(echo.text);
  if (texts.has(echoText)) {
    return true;
  }
  if (!echo.attachments?.length) {
    return false;
  }
  if (echo.turnId !== null && (echo.turnId === item.turnId || echo.turnId === item.commandId)) {
    return echoText === "" || [...texts].some((text) => text.startsWith(echoText));
  }
  // Before the ack names its turn, only an equally attachment-only prompt can be this echo.
  return echo.turnId === null && echoText === "" && texts.size === 0;
}

function matchEcho(draft: Draft, item: MspItem): void {
  const echoes = draft.fold.echoes;
  if (echoes.length === 0) {
    return;
  }
  const texts = promptTexts(item);
  let index = echoes.findIndex(
    (e) => e.turnId !== null && (e.turnId === item.turnId || e.turnId === item.commandId) && echoMatchesItem(e, item, texts),
  );
  if (index < 0) {
    index = echoes.findIndex((e) => texts.has(normalizeText(e.text)) || (e.turnId === null && echoMatchesItem(e, item, texts)));
  }
  if (index >= 0) {
    draft.removeEcho(index);
  }
}

/** Drops every local copy of a turn's prompts: steers share their turn's id, so one removal is not enough. */
function removeEchoesForTurn(draft: Draft, turnId: string): void {
  const echoes = draft.fold.echoes;
  for (let index = echoes.length - 1; index >= 0; index -= 1) {
    if (echoes[index]?.turnId === turnId) {
      draft.removeEcho(index);
    }
  }
}

/**
 * Whether a carried echo is already settled by the loaded history: its turn finished, or its prompt is
 * already in the transcript. Anything still pending â€” a queued turn the host has not started, a send still
 * in flight â€” is kept.
 */
function echoSettledInLoad(fold: ThreadFold, echo: LocalEcho): boolean {
  if (echo.turnId === null) {
    return false;
  }
  if (fold.turns[echo.turnId]?.terminal) {
    return true;
  }
  return fold.order.some((id) => {
    const item = fold.items[id];
    return (
      item?.kind === "userMessage" &&
      (item.turnId === echo.turnId || item.commandId === echo.turnId) &&
      echoMatchesItem(echo, item, promptTexts(item))
    );
  });
}

function appendDelta(draft: Draft, params: Record<string, unknown>): void {
  const d = draft.fold;
  const id = str(params["itemId"]);
  const delta = typeof params["delta"] === "string" ? params["delta"] : "";
  if (!id || !delta) {
    return;
  }
  const field = str(params["field"]) ?? "text";
  let item = d.items[id];
  if (!item) {
    item = {
      itemId: id,
      kind: field === "output" ? "toolCall" : field.startsWith("summary") ? "reasoning" : "agentMessage",
      status: "inProgress",
      revision: 0,
    };
    draft.pushOrder(id);
  } else if (item.status !== "inProgress") {
    // The authoritative final already landed; a late delta would duplicate text.
    return;
  }
  const next: MspItem = { ...item };
  if (field === "text") {
    next.text = (next.text ?? "") + delta;
  } else if (field === "output") {
    next.visibleOutput = (next.visibleOutput ?? "") + delta;
  } else if (field.startsWith("summary.")) {
    const index = Number(field.slice("summary.".length));
    if (Number.isInteger(index) && index >= 0) {
      const summary = [...(next.summary ?? [])];
      while (summary.length < index) {
        summary.push("");
      }
      summary[index] = (summary[index] ?? "") + delta;
      next.summary = summary;
    }
  } else {
    const previous = next[field];
    next[field] = (typeof previous === "string" ? previous : "") + delta;
  }
  d.items[id] = next;
}

/** A pause longer than this between text chunks means a new model call, so its speed is measured afresh. */
export const STREAM_GAP_MS = 2000;

/** Counts streamed model text (replies and reasoning, not tool output) per turn, in bursts. */
function trackStream(draft: Draft, params: Record<string, unknown>, at: number | undefined): void {
  const field = str(params["field"]) ?? "text";
  const delta = typeof params["delta"] === "string" ? params["delta"] : "";
  if (at === undefined || !delta || field === "output") {
    return;
  }
  const d = draft.fold;
  const itemId = str(params["itemId"]);
  const turnId = str(params["turnId"]) ?? (itemId ? (d.items[itemId]?.turnId ?? null) : null);
  if (!turnId) {
    return;
  }
  const turn = d.turns[turnId] ?? { turnId };
  const previous = turn.stream && at - turn.stream.lastAt <= STREAM_GAP_MS ? turn.stream : { chars: 0, startAt: at, lastAt: at };
  d.turns[turnId] = { ...turn, stream: { chars: previous.chars + delta.length, startAt: previous.startAt, lastAt: at } };
}

function applyOne(draft: Draft, event: ViewEvent): void {
  const d = draft.fold;
  const params = event.params;
  switch (event.method) {
    case "item/started":
    case "item/updated":
    case "item/completed": {
      const item = asItem(params["item"]);
      if (item) {
        upsertItem(draft, item);
      }
      break;
    }
    case "item/delta":
      appendDelta(draft, params);
      trackStream(draft, params, event.at);
      break;
    case "turn/started": {
      const turnId = str(params["turnId"]);
      if (!turnId) {
        break;
      }
      const previous = d.turns[turnId];
      d.turns[turnId] = { ...previous, turnId, startedAt: previous?.startedAt ?? event.at };
      if (!previous?.terminal) {
        d.activeTurnId = turnId;
      }
      d.closed = false;
      const echo = d.echoes.findIndex((e) => e.turnId === turnId && e.disposition === "queued");
      if (echo >= 0) {
        draft.patchEcho(echo, { disposition: "started" });
      }
      break;
    }
    case "turn/completed": {
      const turnId = str(params["turnId"]);
      if (!turnId) {
        break;
      }
      const error = asRecord(params["error"]);
      d.turns[turnId] = {
        ...d.turns[turnId],
        turnId,
        terminal: str(params["terminal"]) ?? "completed",
        durationMs: numberOr(params["durationMs"]) ?? d.turns[turnId]?.durationMs,
        firstTokenMs: numberOr(params["timeToFirstTokenMs"]) ?? d.turns[turnId]?.firstTokenMs,
        completedAt: event.at ?? d.turns[turnId]?.completedAt,
        error: error
          ? {
              kind: str(error["kind"]) ?? "error",
              message: str(error["message"]) ?? EMPTY_TURN_ERROR,
              retryable: error["retryable"] === true,
            }
          : undefined,
        retry: undefined,
      };
      if (d.activeTurnId === turnId) {
        d.activeTurnId = null;
      }
      // The turn is over, so its local copies have done their job: the prompts are either in the transcript or
      // they never will be. Keeping them would leave bubbles stuck on "Sending" for the rest of the thread.
      removeEchoesForTurn(draft, turnId);
      break;
    }
    case "turn/retryScheduled": {
      const turnId = str(params["turnId"]);
      if (turnId) {
        d.turns[turnId] = {
          ...d.turns[turnId],
          turnId,
          retry: {
            attempt: numberOr(params["attempt"]) ?? 1,
            maxAttempts: numberOr(params["maxAttempts"]) ?? 1,
            nextAttempt: numberOr(params["nextAttempt"]) ?? 2,
            reason: str(params["reason"]) ?? "",
            retryDelayMs: numberOr(params["retryDelayMs"]) ?? 0,
          },
        };
      }
      break;
    }
    case "turn/retracted": {
      const turnId = str(params["turnId"]);
      if (turnId) {
        d.turns[turnId] = { ...d.turns[turnId], turnId, retracted: true };
      }
      break;
    }
    case "turn/unqueued": {
      const turnId = str(params["turnId"]);
      if (turnId) {
        d.turns[turnId] = { ...d.turns[turnId], turnId, terminal: "unqueued" };
        removeEchoesForTurn(draft, turnId);
      }
      break;
    }
    case "approval/requested":
    case "approval/updated": {
      const id = str(params["approvalId"]);
      if (id && !d.resolved[id]) {
        d.approvals[id] = { ...d.approvals[id], ...(params as unknown as ApprovalRequest) };
      }
      break;
    }
    case "approval/resolved": {
      const id = str(params["approvalId"]);
      if (id) {
        delete d.approvals[id];
        d.resolved[id] = {
          decision: str(params["decision"]) ?? "resolved",
          resolvedBy: str(params["resolvedBy"]) ?? "user",
        };
      }
      break;
    }
    case "userInput/requested": {
      const id = str(params["userInputId"]);
      if (id && !d.settled[id]) {
        d.userInputs[id] = params as unknown as UserInputRequest;
      }
      break;
    }
    case "userInput/settled": {
      const id = str(params["userInputId"]);
      if (id) {
        delete d.userInputs[id];
        d.settled[id] = {
          outcome: str(params["outcome"]) ?? "answered",
          answers: Array.isArray(params["answers"]) ? (params["answers"] as UserInputAnswer[]) : [],
        };
      }
      break;
    }
    case "session/todoListChanged":
      d.meta.todoList = Array.isArray(params["items"]) ? (params["items"] as TodoItem[]) : [];
      break;
    case "session/branchChanged":
      d.meta.branch = str(params["branch"]);
      break;
    case "session/contextUsage":
      d.meta.contextUsage = {
        usedTokens: numberOr(params["usedTokens"]) ?? 0,
        windowTokens: numberOr(params["windowTokens"]),
        pressure: str(params["pressure"]) ?? "normal",
      };
      break;
    case "session/tokenUsage": {
      const cumulative = asRecord(params["cumulative"]);
      if (cumulative) {
        d.meta.tokenTotals = {
          promptTokens: numberOr(cumulative["promptTokens"]) ?? 0,
          outputTokens: numberOr(cumulative["outputTokens"]) ?? 0,
          totalTokens: numberOr(cumulative["totalTokens"]) ?? 0,
        };
      }
      const usage = asRecord(params["usage"]) ?? {};
      const promptTokens = numberOr(params["promptTokens"]) ?? numberOr(usage["inputTokens"]) ?? 0;
      const key = str(params["viewCursor"]) ?? `${str(params["turnId"]) ?? "turn"}:${Object.keys(d.meta.calls).length}`;
      draft.putCall(key, {
        turnId: str(params["turnId"]),
        modelId: str(params["modelId"]),
        promptTokens,
        outputTokens: numberOr(usage["outputTokens"]) ?? Math.max(0, (numberOr(params["totalTokens"]) ?? 0) - promptTokens),
        inputTokens: numberOr(usage["inputTokens"]) ?? 0,
        cachedTokens: numberOr(usage["cachedTokens"]) ?? 0,
        cacheReadTokens: numberOr(usage["cacheReadTokens"]) ?? 0,
        cacheWriteTokens: numberOr(usage["cacheWriteTokens"]) ?? 0,
        reasoningTokens: numberOr(usage["reasoningTokens"]) ?? 0,
        durationMs: numberOr(params["durationMs"]) ?? null,
      });
      break;
    }
    case "session/modelChanged":
      d.meta.modelId = str(params["modelId"]) ?? d.meta.modelId;
      break;
    case "session/approvalModeChanged":
      if (isApprovalMode(params["mode"])) {
        d.meta.approvalMode = params["mode"];
      }
      break;
    case "session/goalChanged": {
      const raw = params["goal"];
      const next = asGoal(raw);
      // A block that is there but is not a goal (no objective) changes nothing; only null clears.
      if (raw !== null && raw !== undefined && !next) {
        break;
      }
      const prev = d.meta.goal;
      const same = next !== null && prev !== null && next.objective === prev.objective;
      // A new objective restarts the live clock; the goal record's own start time wins when there is one.
      if (!same) {
        d.meta.goalSince = next ? (event.at ?? null) : null;
        d.meta.goalPauses = [];
      }
      // A pause or finish stops the goal's clock at this moment; history carries no time, so it stays unknown there.
      if (!same || next?.status !== prev?.status) {
        d.meta.goalStatusAt = next ? (event.at ?? null) : null;
      }
      // Time paused or blocked is not running time: a live change marks where each pause began and ended.
      if (same && next && prev && event.at !== undefined && next.status !== prev.status) {
        const pauses = d.meta.goalPauses;
        const open = pauses[pauses.length - 1];
        if (prev.status === "active") {
          d.meta.goalPauses = [...pauses, { from: event.at, to: null }];
        } else if (next.status === "active" && open && open.to === null) {
          d.meta.goalPauses = [...pauses.slice(0, -1), { from: open.from, to: event.at }];
        }
      }
      d.meta.goal = next;
      d.meta.goalSeen = true;
      break;
    }
    case "session/started": {
      const session = asRecord(params["session"]);
      if (session) {
        d.meta.modelId = str(session["modelId"]) ?? d.meta.modelId;
        const mode = asRecord(session["approvalMode"])?.["mode"];
        if (isApprovalMode(mode)) {
          d.meta.approvalMode = mode;
        }
      }
      d.closed = false;
      break;
    }
    case "session/closed":
      d.closed = true;
      d.activeTurnId = null;
      break;
    default:
      break;
  }
}

/** Apply a batch of view events. Returns the input fold untouched when the batch is empty. */
export function applyEvents(fold: ThreadFold, events: readonly ViewEvent[]): ThreadFold {
  if (events.length === 0) {
    return fold;
  }
  const draft = new Draft(fold, touchedBy(events));
  for (const event of events) {
    applyOne(draft, event);
  }
  return draft.fold;
}

export function applyEvent(fold: ThreadFold, event: ViewEvent): ThreadFold {
  return applyEvents(fold, [event]);
}

/** Build a fold from a resume response; the server's pending set is authoritative. */
export function foldFromLoad(load: TranscriptLoad, previous?: ThreadFold | null): ThreadFold {
  let fold = applyEvents(emptyFold(), load.events);
  const reportedActive = load.msp ? load.msp.activeTurnId : fold.activeTurnId;
  const approvals: Record<string, ApprovalRequest> = {};
  for (const approval of load.pending.approvals) {
    approvals[approval.approvalId] = approval;
  }
  const userInputs: Record<string, UserInputRequest> = {};
  for (const input of load.pending.userInputs) {
    userInputs[input.userInputId] = input;
  }
  fold = {
    ...fold,
    approvals,
    userInputs,
    // Resume status is fetched before transcript pages: an ending in those pages may be
    // newer than the status. A terminal turn cannot be active, even in a mixed snapshot.
    activeTurnId: reportedActive && !fold.turns[reportedActive]?.terminal ? reportedActive : null,
    // A reload must not resurrect prompts the history already settled: echoes whose turn finished or whose
    // prompt is already in the transcript would otherwise sit stuck for the rest of the thread.
    echoes: (previous?.echoes ?? []).filter((echo) => !echoSettledInLoad(fold, echo)),
    meta: {
      ...fold.meta,
      // History pages carry no context readings; the session's own fill in until the next live one.
      contextUsage:
        fold.meta.contextUsage ?? (typeof load.msp?.contextUsage?.usedTokens === "number" ? load.msp.contextUsage : null),
      tokenTotals: fold.meta.tokenTotals ?? (typeof load.msp?.tokenUsage?.totalTokens === "number" ? load.msp.tokenUsage : null),
      modelId: fold.meta.modelId ?? load.msp?.modelId ?? load.session?.modelId ?? null,
      approvalMode: fold.meta.approvalMode ?? (isApprovalMode(load.msp?.approvalMode) ? load.msp.approvalMode : null),
    },
    closed: false,
  };
  return fold;
}

export function addEcho(fold: ThreadFold, echo: LocalEcho): ThreadFold {
  return { ...fold, echoes: [...fold.echoes, echo] };
}

export function updateEcho(fold: ThreadFold, localId: string, patch: Partial<LocalEcho>): ThreadFold {
  const index = fold.echoes.findIndex((e) => e.localId === localId);
  if (index < 0) {
    return fold;
  }
  // If the stream already echoed this prompt back, the local copy is done.
  if (patch.turnId && patch.disposition !== "queued") {
    const echo = fold.echoes[index] as LocalEcho;
    const turnId = patch.turnId as string;
    const landed = fold.order.some((id) => {
      const item = fold.items[id];
      return (
        item?.kind === "userMessage" &&
        (item.turnId === turnId || item.commandId === turnId) &&
        echoMatchesItem({ ...echo, turnId }, item, promptTexts(item))
      );
    });
    if (landed) {
      return removeEcho(fold, localId);
    }
  }
  const echoes = [...fold.echoes];
  echoes[index] = { ...(echoes[index] as LocalEcho), ...patch };
  return { ...fold, echoes };
}

export function removeEcho(fold: ThreadFold, localId: string): ThreadFold {
  const echoes = fold.echoes.filter((e) => e.localId !== localId);
  return echoes.length === fold.echoes.length ? fold : { ...fold, echoes };
}

/**
 * Declares over a turn the host will never close: the same local effect as its `turn/completed`,
 * so the transcript stops waiting and prompts queued behind it keep their own turns. A late host
 * ending still wins, because `turn/completed` overwrites the terminal.
 */
export function abandonTurn(fold: ThreadFold, turnId: string): ThreadFold {
  if (fold.activeTurnId !== turnId || fold.turns[turnId]?.terminal) {
    return fold;
  }
  return applyEvent(fold, { method: "turn/completed", params: { turnId, terminal: "cancelled" } });
}

/** Um turno ativo cujo trabalho visível terminou: algo do agente concluído, nada em andamento, `turn/completed` ainda por chegar. */
export function isTurnFinalizing(fold: ThreadFold, turnId: string | null): boolean {
  if (!turnId || fold.activeTurnId !== turnId) {
    return false;
  }
  let done = false;
  for (const id of fold.order) {
    const item = fold.items[id];
    if (!item || item.turnId !== turnId || HIDDEN_KINDS.has(item.kind)) {
      continue;
    }
    if (item.status === "inProgress") {
      return false;
    }
    if (item.kind !== "userMessage") {
      done = true;
    }
  }
  return done;
}

/** One turn as the transcript renders it. */
export interface TurnView {
  key: string;
  turnId: string | null;
  prompt: MspItem | null;
  /** Everything between the prompt and the final reply, in stream order. */
  entries: MspItem[];
  /** The closing agent message of a finished turn, shown outside the work log. */
  final: MspItem | null;
  info: TurnInfo | null;
  running: boolean;
}

export function buildTurns(fold: ThreadFold): TurnView[] {
  const byKey = new Map<string, TurnView>();
  const views: TurnView[] = [];
  for (const id of fold.order) {
    const item = fold.items[id];
    if (!item || HIDDEN_KINDS.has(item.kind) || (item.kind === "userMessage" && item.retracted)) {
      continue;
    }
    const key = item.turnId ? `turn:${item.turnId}` : `item:${id}`;
    let view = byKey.get(key);
    if (!view) {
      view = {
        key,
        turnId: item.turnId ?? null,
        prompt: null,
        entries: [],
        final: null,
        info: item.turnId ? (fold.turns[item.turnId] ?? null) : null,
        running: item.turnId ? fold.activeTurnId === item.turnId : false,
      };
      byKey.set(key, view);
      views.push(view);
    }
    if (item.kind === "userMessage" && !item.steered && !view.prompt) {
      view.prompt = item;
    } else {
      view.entries.push(item);
    }
  }
  for (const view of views) {
    if (view.running) {
      continue;
    }
    const last = view.entries[view.entries.length - 1];
    if (last && last.kind === "agentMessage" && (last.text ?? "").trim().length > 0) {
      view.final = last;
      view.entries = view.entries.slice(0, -1);
    }
  }
  return views;
}

/** The pending approval or question that gates a given tool item, if any. */
export function gateFor(
  fold: ThreadFold,
  itemId: string,
): { kind: "approval"; request: ApprovalRequest } | { kind: "input"; request: UserInputRequest } | null {
  for (const request of Object.values(fold.approvals)) {
    if (request.itemId === itemId) {
      return { kind: "approval", request };
    }
  }
  for (const request of Object.values(fold.userInputs)) {
    if (request.itemId === itemId) {
      return { kind: "input", request };
    }
  }
  return null;
}
