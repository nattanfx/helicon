import type {
  ApprovalMode,
  AttachmentView,
  EnvironmentStatus,
  ModelOption,
  OutgoingAttachment,
  PlanUsage,
  ProjectView,
  ReasoningEffort,
  SandboxSettings,
  SessionSummary,
  ShellRun,
  SkillEntry,
  TitleSettings,
  YoloSettings,
} from "../types.js";
import type { EchoAttachment, ThreadFold } from "./fold.js";
import type { AppIdentity } from "./identity.js";
import type { UpdateState } from "./updates.js";

/** Um store externo minúsculo: snapshots imutáveis mais ouvintes de mudança, lidos via hooks estilo useSyncExternalStore. */
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
/** Cores de sintaxe para blocos de código, independentes do tema claro ou escuro do próprio app. */
export const CODE_THEMES = ["helicon", "ayu", "github", "vercel", "cursor", "catppuccin"] as const;
export type CodeTheme = (typeof CODE_THEMES)[number];

/** Zoom da interface como fator de 1, em passos fixos de 70% a 200%. */
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
  /** Prateleiras resolvidas que o usuário abriu: `project:<cwd>`, ou `status` para a visão por status. */
  openShelves: string[];
  /**
   * Cards do dock que o usuário recolheu, como `goal:<sessionId>` ou `plan:<sessionId>`. Só os fechados são
   * guardados, então um card abre por padrão e uma conversa que o usuário nunca tocou não custa nada para lembrar.
   */
  collapsedCards: string[];
  /**
   * Cards do dock que o usuário fechou, com as mesmas chaves (mais `tasks:<sessionId>`). Um card fechado fica fora do dock
   * até o usuário trazê-lo de volta da barra do topo da conversa.
   */
  hiddenCards: string[];
  /** Avisos de mensagem falha que o usuário fechou, como `<sessionId>:<turnId>`, para uma conversa recarregada mantê-los fechados. */
  dismissedTurnErrors: string[];
  /** Levantar uma notificação de sistema quando uma conversa precisa de atenção (a preferência de primeiro plano amplia). */
  notifications: boolean;
  /** Bipe suave junto com cada aviso do sistema. Desligado por padrão; só toca quando o aviso aparece. */
  notificationSound: boolean;
  /** Balão também com a janela em primeiro plano. Desligado por padrão; quem se ausenta liga. */
  notificationsForeground: boolean;
  /** Bipe também com a janela em primeiro plano. Desligado por padrão; quem se ausenta liga. */
  notificationSoundForeground: boolean;
  /** Quando o usuário viu cada conversa pela última vez (ISO). */
  lastSeen: Record<string, string>;
  /** Atividade antes do primeiro lançamento é tratada como já vista. */
  baseline: string;
  defaultMode: ApprovalMode;
  defaultModelId: string | null;
  effort: ReasoningEffort | null;
  /** O último projeto em que uma nova conversa foi iniciada. */
  lastProject: string | null;
  /** O uso de dados do nível de contribuidor foi reconhecido. */
  contributorAck: boolean;
  /** App desktop: baixar novas versões conforme aparecem e instalá-las ao fechar. Este fork deixa desligado. */
  autoUpdate: boolean;
  /** App desktop: sem checar, baixar ou instalar atualizações até retomar. */
  updatesPaused: boolean;
  /** Zoom da interface como fator de 1; o shell desktop não tem chrome de navegador para isso. */
  zoom: number;
  /** O visualizador de arquivos ao lado de uma conversa está aberto. */
  filesOpen: boolean;
  filesWidth: number;
  /** Pílulas de estatísticas da sessão acima do composer: turnos, velocidade e tokens da conversa aberta. */
  showTelemetry: boolean;
  /**
   * Modos de aprovação de antes de ligar o YOLO, que sobrevivem a um recarregar para desligar o YOLO
   * ainda os restaurar em vez de cair para onRequest. Null quando o YOLO nunca foi ligado aqui.
   */
  preYolo: { defaultMode: ApprovalMode; threads: Record<string, ApprovalMode | null> } | null;
}

export const DEFAULT_FILES_WIDTH = 480;
export const FILES_WIDTH_MIN = 320;
export const FILES_WIDTH_MAX = 1200;

/** O visualizador de arquivos de uma conversa: os arquivos abertos como abas, qual aparece, e se a árvore está no lugar. */
export interface FilePanel {
  tabs: string[];
  active: string | null;
  tree: boolean;
  /** Linhas que um link apontou no arquivo ativo, para rolar até elas e marcá-las. */
  line: import("./files.js").LineRange | null;
}

/** Uma edição ainda não salva, com a versão do arquivo de onde começou. */
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
    // Desligado até pedirem: ninguém deve ser interrompido por algo que nunca ligou.
    notifications: false,
    notificationSound: false,
    notificationsForeground: false,
    notificationSoundForeground: false,
    lastSeen: {},
    baseline: now,
    defaultMode: "onRequest",
    defaultModelId: null,
    effort: null,
    lastProject: null,
    contributorAck: false,
    autoUpdate: false,
    updatesPaused: false,
    zoom: 1,
    filesOpen: false,
    filesWidth: DEFAULT_FILES_WIDTH,
    showTelemetry: false,
    preYolo: null,
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
  /** Arquivos enviados com os prompts desta conversa; a visão própria do Muse guarda só metadados. */
  attachments: AttachmentView[];
  /** Comandos `!` que o Helicon rodou sozinho, que a transcrição do Muse nunca vê. */
  shellRuns: ShellRun[];
  /** Sem eventos recentes após esgotar as recargas automáticas do turno. */
  stalled: boolean;
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
  /** Ativação e modelo dos títulos, mantidos pelo servidor; null até a resposta do carregamento inicial. */
  titleSettings: TitleSettings | null;
  /** Proteção da sandbox, mantida pelo servidor; null até a resposta do carregamento inicial. */
  sandboxSettings: SandboxSettings | null;
  /** YOLO, mantido pelo servidor; null até a resposta do carregamento inicial. */
  yoloSettings: YoloSettings | null;
  prefs: Prefs;
  toasts: Toast[];
  paletteOpen: boolean;
  addProjectOpen: boolean;
  /** Chaves de ações do usuário em voo, para desabilitar botões: `send:<id>`, `approval:<id>`... */
  busy: Record<string, true>;
  /**
   * Aprovações que o Helicon responde por você em vez de mostrar. O Muse pergunta sempre que não consegue resolver o
   * argv de um comando, não importa o que seu próprio modo diga, então este é o único jeito de parar de ser perguntado.
   * Deliberadamente não é uma preferência: um bypass dura enquanto o app está aberto e nada além.
   */
  bypassAll: boolean;
  /** Conversas armadas uma de cada vez, para deixar uma única execução desacompanhada passar. */
  bypassThreads: string[];
  hostError: string | null;
  /** Um prompt que não pôde ser enviado, esperando o composer que mostra `key` recebê-lo de volta, arquivos e tudo. */
  draftHandoff: { key: string; text: string; attachments?: OutgoingAttachment[]; previews?: EchoAttachment[] } | null;
  /** Atualizações do app; nulo quando o shell não se atualiza sozinho, como neste fork e no navegador. */
  updates: UpdateState | null;
  /** Versão, canal e compilação deste pacote; nulo até o shell informar. */
  identity: AppIdentity | null;
  /** As skills de cada pasta de projeto para o menu de barra do composer, carregadas quando preciso pela primeira vez. */
  skills: Record<string, SkillsState>;
  /** Um seletor do composer que um comando de barra abriu, como `/model`. */
  picker: ComposerPicker | null;
  /** A janela de assinatura que o Muse informou por último; nulo até um host ver uma. */
  planUsage: PlanUsage | null;
  /** O visualizador de arquivos de cada conversa. */
  filePanels: Record<string, FilePanel>;
  /** Edições não salvas, por `fileKey(cwd, path)`. */
  fileDrafts: Record<string, FileDraft>;
  /** Incrementado quando o Muse edita um arquivo, para uma visão aberta dele recarregar. Por `fileKey(cwd, path)`. */
  fileVersions: Record<string, number>;
  /** Pastas abertas na árvore de arquivos de cada projeto. */
  fileTreeOpen: Record<string, string[]>;
}

/** `confirmFullAccess` é a confirmação de acesso total, pela qual `/permissions full` ainda precisa passar. `confirmYolo` é a confirmação do modo YOLO. */
export type ComposerPicker = "model" | "effort" | "permissions" | "confirmFullAccess" | "confirmYolo" | "confirmBypass";

export interface SkillsState {
  status: "loading" | "ready" | "error";
  skills: SkillEntry[];
  error: string | null;
  /** Quando o último carregamento terminou, em tempo da plataforma. */
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
    titleSettings: null,
    sandboxSettings: null,
    yoloSettings: null,
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
    identity: null,
    skills: {},
    picker: null,
  };
}

/** Mescla prefs persistidas sobre os padrões, descartando qualquer coisa malformada. */
export function revivePrefs(raw: unknown, fallback: Prefs): Prefs {
  if (!raw || typeof raw !== "object") {
    return fallback;
  }
  const r = { ...(raw as Record<string, unknown>) };
  // Ultra saiu do seletor (o Muse o roda como Max), então um Ultra salvo continua como Max.
  if (r["effort"] === "ultra") {
    r["effort"] = "max";
  }
  const pick = <K extends keyof Prefs>(key: K, valid: (v: unknown) => boolean): Prefs[K] =>
    valid(r[key]) ? (r[key] as Prefs[K]) : fallback[key];
  const isApprovalMode = (v: unknown): boolean =>
    v === "onRequest" || v === "promptUnmatched" || v === "denyUnmatched" || v === "allowAll";
  const isPreYolo = (v: unknown): boolean => {
    if (v === null) {
      return true;
    }
    if (typeof v !== "object") {
      return false;
    }
    const snapshot = v as { defaultMode?: unknown; threads?: unknown };
    return (
      isApprovalMode(snapshot.defaultMode) &&
      typeof snapshot.threads === "object" &&
      snapshot.threads !== null &&
      !Array.isArray(snapshot.threads) &&
      Object.values(snapshot.threads).every((mode) => mode === null || isApprovalMode(mode))
    );
  };
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
    notificationSound: pick("notificationSound", (v) => typeof v === "boolean"),
    notificationsForeground: pick("notificationsForeground", (v) => typeof v === "boolean"),
    notificationSoundForeground: pick("notificationSoundForeground", (v) => typeof v === "boolean"),
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
    showTelemetry: pick("showTelemetry", (v) => typeof v === "boolean"),
    preYolo: pick("preYolo", isPreYolo),
  };
}
