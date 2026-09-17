import type {
  ApprovalMode,
  AttachmentView,
  EnvironmentStatus,
  ModelOption,
  OutgoingAttachment,
  PlanUsage,
  ProjectView,
  ReasoningEffort,
  SessionSummary,
  ShellRun,
  SkillEntry,
} from "../types";
import type { EchoAttachment, ThreadFold } from "./fold";
import type { UpdateState } from "./updates";

/** A tiny external store: immutable snapshots plus change listeners, read through useSyncExternalStore-style hooks. */
export class Store<T> {
  private state: T;
  private readonly listeners = new Set<() => void>();

  constructor(initial: T) {
    this.state = initial;
  }

  get = (): T => this.state;

  set = (update: (state: T) => T): void => {
    const next = update(this.state);
    if (next === this.state) {
      return;
    }
    this.state = next;
    for (const listener of [...this.listeners]) {
      listener();
    }
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

export type GroupBy = "project" | "status";
export type ThemePref = "system" | "light" | "dark";
/** Syntax colours for code blocks, independent of the app's own light or dark theme. */
export const CODE_THEMES = ["helicon", "ayu", "github", "vercel", "cursor", "catppuccin"] as const;
export type CodeTheme = (typeof CODE_THEMES)[number];

/** Interface zoom as a factor of 1, in fixed steps from 70% to 200%. */
export const ZOOM_STEPS = [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5, 1.75, 2] as const;
export const ZOOM_MIN = ZOOM_STEPS[0];
export const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1];

export interface Prefs {
  groupBy: GroupBy;
  theme: ThemePref;
  codeTheme: CodeTheme;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  collapsedProjects: string[];
  /** Settled shelves the user opened: `project:<cwd>`, or `status` for the by-status view. */
  openShelves: string[];
  /**
   * Dock cards the user collapsed, as `goal:<sessionId>` or `plan:<sessionId>`. Only the closed ones are
   * kept, so a card opens by default and a thread the user has never touched costs nothing to remember.
   */
  collapsedCards: string[];
  /**
   * Dock cards the user closed, with the same keys (plus `tasks:<sessionId>`). A closed card stays out of the dock
   * until the user brings it back from the thread's top bar.
   */
  hiddenCards: string[];
  /** Failed-turn notices the user closed, as `<sessionId>:<turnId>`, so a reloaded thread keeps them closed. */
  dismissedTurnErrors: string[];
  /** Raise a system notification when a thread needs attention while the window does not have it. */
  notifications: boolean;
  /** When the user last viewed each thread (ISO). */
  lastSeen: Record<string, string>;
  /** Activity before the first launch is treated as already seen. */
  baseline: string;
  defaultMode: ApprovalMode;
  defaultModelId: string | null;
  effort: ReasoningEffort | null;
  /** The last project a new thread was started in. */
  lastProject: string | null;
  /** Contributor-tier data use was acknowledged. */
  contributorAck: boolean;
  /** Desktop app: download new versions as they appear and install them on close. */
  autoUpdate: boolean;
  /** Desktop app: no checking, downloading or installing updates until resumed. */
  updatesPaused: boolean;
  /** Interface zoom as a factor of 1; the desktop shell has no browser chrome to do this. */
  zoom: number;
  /** The file viewer beside a thread is open. */
  filesOpen: boolean;
  filesWidth: number;
}

export const DEFAULT_FILES_WIDTH = 480;
export const FILES_WIDTH_MIN = 320;
export const FILES_WIDTH_MAX = 1200;

/** One thread's file viewer: the files it has open as tabs, which one shows, and whether the tree is up instead. */
export interface FilePanel {
  tabs: string[];
  active: string | null;
  tree: boolean;
  /** Lines a link pointed at in the active file, to scroll to and mark. */
  line: import("./files").LineRange | null;
}

/** An edit not yet saved, with the version of the file it started from. */
export interface FileDraft {
  content: string;
  baseMtimeMs: number | null;
}

export const DEFAULT_SIDEBAR_WIDTH = 284;

export function defaultPrefs(now = new Date().toISOString()): Prefs {
  return {
    groupBy: "project",
    theme: "system",
    codeTheme: "helicon",
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    sidebarCollapsed: false,
    collapsedProjects: [],
    openShelves: [],
    collapsedCards: [],
    hiddenCards: [],
    dismissedTurnErrors: [],
    // Off until asked for: nobody should be interrupted by something they never turned on.
    notifications: false,
    lastSeen: {},
    baseline: now,
    defaultMode: "onRequest",
    defaultModelId: null,
    effort: null,
    lastProject: null,
    contributorAck: false,
    autoUpdate: true,
    updatesPaused: false,
    zoom: 1,
    filesOpen: false,
    filesWidth: DEFAULT_FILES_WIDTH,
  };
}

export type Route =
  | { kind: "home" }
  | { kind: "new"; cwd: string | null }
  | { kind: "thread"; sessionId: string }
  | { kind: "usage" }
  | { kind: "settings" };

export interface ThreadState {
  load: "idle" | "loading" | "ready" | "error";
  error: string | null;
  readOnly: boolean;
  readOnlyReason: string | null;
  truncated: boolean;
  fold: ThreadFold;
  /** Files sent with this thread's prompts; Muse's own view keeps metadata only. */
  attachments: AttachmentView[];
  /** `!` commands Helicon ran itself, which Muse's transcript never sees. */
  shellRuns: ShellRun[];
}

export interface Toast {
  id: number;
  tone: "error" | "info" | "success";
  title: string;
  detail?: string;
  action?: { label: string; run: () => void };
}

export interface AppState {
  boot: "loading" | "ready" | "error";
  bootError: string | null;
  env: EnvironmentStatus | null;
  connection: "connecting" | "open" | "lost";
  projects: ProjectView[];
  sessions: Record<string, SessionSummary>;
  sessionsLoaded: boolean;
  discovering: boolean;
  route: Route;
  threads: Record<string, ThreadState>;
  models: ModelOption[];
  prefs: Prefs;
  toasts: Toast[];
  paletteOpen: boolean;
  addProjectOpen: boolean;
  /** Keys of in-flight user actions, for disabling buttons: `send:<id>`, `approval:<id>`... */
  busy: Record<string, true>;
  /**
   * Approvals Helicon answers for you rather than showing. Muse asks whenever it cannot resolve a
   * command's argv, whatever its own mode says, so this is the only way to stop being asked. It is
   * deliberately not a preference: a bypass lasts as long as the app is open and no longer.
   */
  bypassAll: boolean;
  /** Threads armed one at a time, for letting a single unattended run through. */
  bypassThreads: string[];
  hostError: string | null;
  /** A prompt that could not be sent, waiting for the composer showing `key` to take it back, files and all. */
  draftHandoff: { key: string; text: string; attachments?: OutgoingAttachment[]; previews?: EchoAttachment[] } | null;
  /** App updates; null when the shell cannot update itself, as in a browser. */
  updates: UpdateState | null;
  /** Each workspace's skills for the composer's slash menu, loaded when first needed. */
  skills: Record<string, SkillsState>;
  /** A composer picker a slash command opened, like `/model`. */
  picker: ComposerPicker | null;
  /** The subscription window Muse last reported; null until a host has seen one. */
  planUsage: PlanUsage | null;
  /** Each thread's file viewer. */
  filePanels: Record<string, FilePanel>;
  /** Unsaved edits, by `fileKey(cwd, path)`. */
  fileDrafts: Record<string, FileDraft>;
  /** Bumped when Muse edits a file, so an open view of it reloads. By `fileKey(cwd, path)`. */
  fileVersions: Record<string, number>;
  /** Folders open in each project's file tree. */
  fileTreeOpen: Record<string, string[]>;
}

/** `confirmFullAccess` is the full-access confirmation, which `/permissions full` must still pass through. */
export type ComposerPicker = "model" | "effort" | "permissions" | "confirmFullAccess" | "confirmBypass";

export interface SkillsState {
  status: "loading" | "ready" | "error";
  skills: SkillEntry[];
  error: string | null;
  /** When the last load finished, in platform time. */
  loadedAt: number;
}

export function initialState(prefs: Prefs): AppState {
  return {
    boot: "loading",
    bootError: null,
    env: null,
    connection: "connecting",
    projects: [],
    sessions: {},
    sessionsLoaded: false,
    discovering: false,
    route: { kind: "home" },
    threads: {},
    models: [],
    prefs,
    toasts: [],
    paletteOpen: false,
    addProjectOpen: false,
    busy: {},
    bypassAll: false,
    bypassThreads: [],
    hostError: null,
    planUsage: null,
    filePanels: {},
    fileDrafts: {},
    fileVersions: {},
    fileTreeOpen: {},
    draftHandoff: null,
    updates: null,
    skills: {},
    picker: null,
  };
}

/** Merge persisted prefs over defaults, dropping anything malformed. */
export function revivePrefs(raw: unknown, fallback: Prefs): Prefs {
  if (!raw || typeof raw !== "object") {
    return fallback;
  }
  const r = { ...(raw as Record<string, unknown>) };
  // Ultra left the picker (Muse runs it as Max), so a saved Ultra carries on as Max.
  if (r["effort"] === "ultra") {
    r["effort"] = "max";
  }
  const pick = <K extends keyof Prefs>(key: K, valid: (v: unknown) => boolean): Prefs[K] =>
    valid(r[key]) ? (r[key] as Prefs[K]) : fallback[key];
  return {
    groupBy: pick("groupBy", (v) => v === "project" || v === "status"),
    theme: pick("theme", (v) => v === "system" || v === "light" || v === "dark"),
    sidebarWidth: pick("sidebarWidth", (v) => typeof v === "number" && v >= 220 && v <= 480),
    sidebarCollapsed: pick("sidebarCollapsed", (v) => typeof v === "boolean"),
    collapsedProjects: pick("collapsedProjects", (v) => Array.isArray(v) && v.every((x) => typeof x === "string")),
    openShelves: pick("openShelves", (v) => Array.isArray(v) && v.every((x) => typeof x === "string")),
    collapsedCards: pick("collapsedCards", (v) => Array.isArray(v) && v.every((x) => typeof x === "string")),
    hiddenCards: pick("hiddenCards", (v) => Array.isArray(v) && v.every((x) => typeof x === "string")),
    dismissedTurnErrors: pick("dismissedTurnErrors", (v) => Array.isArray(v) && v.every((x) => typeof x === "string")),
    notifications: pick("notifications", (v) => typeof v === "boolean"),
    lastSeen: pick("lastSeen", (v) => typeof v === "object" && v !== null && !Array.isArray(v)),
    baseline: pick("baseline", (v) => typeof v === "string" && !Number.isNaN(Date.parse(v))),
    codeTheme: pick("codeTheme", (v) => CODE_THEMES.includes(v as CodeTheme)),
    defaultMode: pick("defaultMode", (v) => v === "onRequest" || v === "promptUnmatched" || v === "denyUnmatched" || v === "allowAll"),
    defaultModelId: pick("defaultModelId", (v) => v === null || typeof v === "string"),
    effort: pick("effort", (v) => v === null || ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(v as string)),
    lastProject: pick("lastProject", (v) => v === null || typeof v === "string"),
    contributorAck: pick("contributorAck", (v) => typeof v === "boolean"),
    autoUpdate: pick("autoUpdate", (v) => typeof v === "boolean"),
    updatesPaused: pick("updatesPaused", (v) => typeof v === "boolean"),
    zoom: pick("zoom", (v) => typeof v === "number" && Number.isFinite(v) && v >= ZOOM_MIN && v <= ZOOM_MAX),
    filesOpen: pick("filesOpen", (v) => typeof v === "boolean"),
    filesWidth: pick("filesWidth", (v) => typeof v === "number" && v >= FILES_WIDTH_MIN && v <= FILES_WIDTH_MAX),
  };
}
