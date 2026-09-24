import { appendFile, readFile, writeFile } from "node:fs/promises";

/** Why a failure record exists. Turn rows come from the host; host rows come from the server. */
export type FailureKind = "turn-failed" | "turn-view-failed" | "turn-view-recovered" | "host-exited" | "host-start-failed" | "host-restarted";

/**
 * One black-box row: enough to diagnose a failure after its conversation is archived or gone.
 * It carries ids and technical detail, never message text.
 */
export interface FailureRecord {
  /** ISO timestamp of when the server saw the failure. */
  at: string;
  kind: FailureKind;
  sessionId: string | null;
  turnId: string | null;
  hostKey: string | null;
  /** The host's error kind, when it sent one. Null is the log's `kind=ausente`. */
  errorKind: string | null;
  /** Truncated technical detail, never conversation text. */
  message: string | null;
  /** Last subscription usage seen from any host: answers "was it quota?" without asking the user. */
  usage: unknown;
}

export type FailureInput = Omit<FailureRecord, "at" | "usage"> & { usage?: unknown };

/** Rows kept in memory and served over HTTP. Oldest leaves first; diagnosis aid, not history. */
const RING_LIMIT = 200;
/** File lines before a rewrite compacts back to the ring. Bounds disk without losing recency. */
const FILE_REWRITE_LINES = 500;
/** Cap on free-form detail. The kind carries the signal; the message is context. */
const MESSAGE_LIMIT = 300;
const RECENT_LIMIT = 200;

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseRecord(line: string): FailureRecord {
  const raw = JSON.parse(line) as Record<string, unknown>;
  const kind = asString(raw["kind"]);
  if (kind !== "turn-failed" && kind !== "turn-view-failed" && kind !== "turn-view-recovered" && kind !== "host-exited" && kind !== "host-start-failed" && kind !== "host-restarted") {
    throw new Error("unknown failure kind");
  }
  return {
    at: asString(raw["at"]) ?? new Date(0).toISOString(),
    kind,
    sessionId: asString(raw["sessionId"]),
    turnId: asString(raw["turnId"]),
    hostKey: asString(raw["hostKey"]),
    errorKind: asString(raw["errorKind"]),
    message: asString(raw["message"]),
    usage: raw["usage"] ?? null,
  };
}

/**
 * Append-only failure log ("caixa-preta"). With a file it persists as JSONL next to helicon.db
 * and reloads the tail at startup; with null it stays in memory (`:memory:` mode and tests).
 * Recording never throws and never blocks the caller: the ring updates synchronously while
 * disk writes serialize on a chain drained by close().
 */
export class FailureLog {
  private readonly file: string | null;
  private readonly ring: FailureRecord[] = [];
  private readonly pending: FailureRecord[] = [];
  private loaded = false;
  private chain: Promise<void> = Promise.resolve();
  private loadDone: Promise<void> = Promise.resolve();
  private fileLines = 0;

  constructor(file: string | null) {
    this.file = file;
    if (!file) {
      this.loaded = true;
      return;
    }
    this.loadDone = this.load();
    this.chain = this.loadDone.catch(() => undefined);
  }

  record(input: FailureInput): void {
    const entry: FailureRecord = {
      at: new Date().toISOString(),
      kind: input.kind,
      sessionId: input.sessionId,
      turnId: input.turnId,
      hostKey: input.hostKey,
      errorKind: input.errorKind,
      message: input.message?.slice(0, MESSAGE_LIMIT) ?? null,
      usage: input.usage ?? null,
    };
    if (this.loaded) {
      this.push(entry);
    } else {
      // Startup window: the load merges these after the file tail, keeping time order.
      this.pending.push(entry);
    }
    if (this.file) {
      const file = this.file;
      this.chain = this.chain
        .then(() => appendFile(file, `${JSON.stringify(entry)}\n`, "utf8"))
        .then(() => {
          this.fileLines += 1;
          if (this.fileLines > FILE_REWRITE_LINES) {
            return this.rewrite();
          }
        })
        .catch(() => undefined);
    }
  }

  /** A history page can be loaded many times; retain one observation per turn and kind. */
  recordTurnOnce(input: FailureInput & { sessionId: string; turnId: string }): void {
    if (!this.hasTurn(input.kind, input.sessionId, input.turnId)) {
      this.record(input);
    }
  }

  hasTurn(kind: FailureKind, sessionId: string, turnId: string): boolean {
    const matches = (entry: FailureRecord) => entry.kind === kind && entry.sessionId === sessionId && entry.turnId === turnId;
    return this.ring.some(matches) || this.pending.some(matches);
  }

  recent(limit = 20): FailureRecord[] {
    const bounded = Math.min(Math.max(Math.floor(limit) || 20, 1), RECENT_LIMIT);
    return this.ring.slice(-bounded);
  }

  get count(): number {
    return this.ring.length;
  }

  /** Resolves once the file tail (if any) is loaded. Served traffic waits on this. */
  async ready(): Promise<void> {
    await this.loadDone.catch(() => undefined);
  }

  async close(): Promise<void> {
    await this.chain.catch(() => undefined);
  }

  private push(entry: FailureRecord): void {
    this.ring.push(entry);
    if (this.ring.length > RING_LIMIT) {
      this.ring.splice(0, this.ring.length - RING_LIMIT);
    }
  }

  private async load(): Promise<void> {
    try {
      const text = await readFile(this.file as string, "utf8");
      const lines = text.split("\n").filter((line) => line.trim().length > 0);
      this.fileLines = lines.length;
      for (const line of lines.slice(-RING_LIMIT)) {
        try {
          this.push(parseRecord(line));
        } catch {
          /* a corrupt row never blocks the rest */
        }
      }
    } catch {
      /* a missing or unreadable log starts empty */
    } finally {
      for (const entry of this.pending.splice(0)) {
        this.push(entry);
      }
      this.loaded = true;
    }
  }

  private async rewrite(): Promise<void> {
    if (!this.file) {
      return;
    }
    await writeFile(this.file, `${this.ring.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
    this.fileLines = this.ring.length;
  }
}
