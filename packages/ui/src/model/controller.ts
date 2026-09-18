import { errorKind, errorMessage, type HeliconClient } from "../client.js";
import type {
  ApprovalMode,
  ApprovalRequest,
  AttachmentView,
  GoalAction,
  HeliconEvent,
  OutgoingAttachment,
  OutputRange,
  ReasoningEffort,
  SessionSummary,
  SkillEntry,
  SubagentAction,
  TaskAction,
  UserInputAnswer,
  UserInputRequest,
  ViewEvent,
  WorkflowAction,
} from "../types.js";
import { describeTool, modelDisplayName } from "./format.js";
import { fileKey, fileTarget, type LineRange } from "./files.js";
import { goalPrompt } from "./goal.js";
import {
  INIT_PROMPT,
  findModel,
  parseEffort,
  parseMode,
  parseSlash,
  resolveSlash,
  skillTurn,
  slashCommands,
  type ParsedSlash,
} from "./slash.js";
import {
  addEcho,
  applyEvents,
  emptyFold,
  foldFromLoad,
  removeEcho,
  updateEcho,
  type EchoAttachment,
  type LocalEcho,
  type ThreadFold,
} from "./fold.js";
import {
  FILES_WIDTH_MAX,
  FILES_WIDTH_MIN,
  Store,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEPS,
  defaultPrefs,
  initialState,
  revivePrefs,
  type AppState,
  type CodeTheme,
  type ComposerPicker,
  type FilePanel,
  type GroupBy,
  type Prefs,
  type Route,
  type SkillsState,
  type ThemePref,
  type ThreadState,
  type Toast,
} from "./store.js";
import { NotificationManager, type Notifier } from "./notify.js";
import { UpdateManager, type AppUpdater } from "./updates.js";

/** O ambiente em que o controller roda; injetável para a lógica continuar testável sem DOM. */
export interface Platform {
  loadPrefs(): unknown;
  savePrefs(prefs: Prefs): void;
  readHash(): string;
  writeHash(hash: string): void;
  onHashChange(handler: () => void): () => void;
  now(): number;
  schedule(fn: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
  /** Se a janela tem a atenção do usuário; nada é anunciado para quem já está olhando. */
  focused(): boolean;
}

const PREFS_KEY = "helicon.prefs.v1";

export function browserPlatform(): Platform {
  return {
    loadPrefs: () => {
      try {
        const raw = window.localStorage.getItem(PREFS_KEY);
        return raw ? (JSON.parse(raw) as unknown) : null;
      } catch {
        return null;
      }
    },
    savePrefs: (prefs) => {
      try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      } catch {
        /* armazenamento indisponível: prefs ficam na memória */
      }
    },
    readHash: () => window.location.hash,
    writeHash: (hash) => {
      if (hash) {
        window.location.hash = hash;
      } else if (window.location.hash) {
        window.history.pushState(null, "", window.location.pathname + window.location.search);
      }
    },
    onHashChange: (handler) => {
      window.addEventListener("hashchange", handler);
      window.addEventListener("popstate", handler);
      return () => {
        window.removeEventListener("hashchange", handler);
        window.removeEventListener("popstate", handler);
      };
    },
    now: () => Date.now(),
    schedule: (fn, ms) => window.setTimeout(fn, ms),
    cancel: (handle) => window.clearTimeout(handle as number),
    // Uma janela sem documento algum não é uma que alguém esteja olhando.
    focused: () => typeof document !== "undefined" && document.hasFocus(),
  };
}

export function routeToHash(route: Route): string {
  switch (route.kind) {
    case "home":
      return "";
    case "new":
      return route.cwd ? `#/new/${encodeURIComponent(route.cwd)}` : "#/new";
    case "thread":
      return `#/t/${encodeURIComponent(route.sessionId)}`;
    case "usage":
      return "#/usage";
    case "settings":
      return "#/settings";
  }
}

export function hashToRoute(hash: string): Route {
  const h = hash.replace(/^#/, "");
  if (h === "/usage") {
    return { kind: "usage" };
  }
  if (h === "/settings") {
    return { kind: "settings" };
  }
  const thread = h.match(/^\/t\/(.+)$/);
  if (thread) {
    return { kind: "thread", sessionId: decodeURIComponent(thread[1] as string) };
  }
  const fresh = h.match(/^\/new(?:\/(.+))?$/);
  if (fresh) {
    return { kind: "new", cwd: fresh[1] ? decodeURIComponent(fresh[1]) : null };
  }
  return { kind: "home" };
}

function blankThread(): ThreadState {
  return {
    load: "idle",
    error: null,
    readOnly: false,
    readOnlyReason: null,
    truncated: false,
    fold: emptyFold(),
    attachments: [],
    shellRuns: [],
  };
}

let localSeq = 0;
function nextLocalId(): string {
  localSeq += 1;
  return `local-${Date.now().toString(36)}-${localSeq}`;
}

/** O que um prompt carrega além do texto: arquivos para o modelo, e suas prévias locais para o eco. */
interface TurnDelivery {
  steer?: boolean;
  /** Enfileira atrás do que estiver rodando mesmo que este cliente ainda não tenha visto a mensagem começar. */
  queue?: boolean;
  displayText?: string;
  attachments?: OutgoingAttachment[];
  previews?: EchoAttachment[];
  /** Entrega nesta conversa em vez de onde o usuário está agora: uma repetição pertence à mensagem que falhou. */
  sessionId?: string;
}

export interface SendOptions extends TurnDelivery {
  /** Envia o texto como prompt mesmo quando parece um comando de barra. */
  raw?: boolean;
}

const FLUSH_MS = 24;
const TOAST_MS = { info: 5000, success: 4000, error: 9000 } as const;
const SKILLS_FRESH_MS = 60_000;
const SKILLS_RETRY_MS = 10_000;

/**
 * É dono do estado do app e de todo efeito colateral: chamadas ao servidor, o stream de eventos, roteamento e prefs.
 * Componentes leem o estado via hooks e chamam estes métodos; nunca falam com o cliente.
 */
const GOAL_FAILURES: Record<GoalAction, string> = {
  set: "Não foi possível definir a meta",
  edit: "Não foi possível alterar a meta",
  pause: "Não foi possível pausar a meta",
  resume: "Não foi possível continuar a meta",
  clear: "Não foi possível limpar a meta",
};

const TASK_FAILURES: Record<TaskAction, string> = {
  background: "Não foi possível mover isso para o fundo",
  stop: "Não foi possível parar essa tarefa",
  stopAll: "Não foi possível parar as tarefas de fundo",
};

export class HeliconController {
  readonly store: Store<AppState>;
  private readonly pending = new Map<string, ViewEvent[]>();
  private readonly loading = new Map<string, ViewEvent[]>();
  /** Chaves de entregas de prompt ainda esperando o servidor, para um rascunho enviado duas vezes virar uma. */
  private readonly inflightSends = new Set<string>();
  private readonly disposers: (() => void)[] = [];
  private flushHandle: unknown = null;
  private refreshHandle: unknown = null;
  private saveHandle: unknown = null;
  private refreshing: Promise<void> | null = null;
  private refreshQueued = false;
  private toastSeq = 0;

  private updates: UpdateManager | null = null;
  private notifications: NotificationManager | null = null;
  /** Guardado junto com o manager, porque pedir permissão é trabalho do shell, não do manager. */
  private notifier: Notifier | null = null;

  constructor(
    readonly client: HeliconClient,
    private readonly platform: Platform = browserPlatform(),
  ) {
    const fallback = defaultPrefs(new Date(platform.now()).toISOString());
    this.store = new Store(initialState(revivePrefs(platform.loadPrefs(), fallback)));
  }

  private get state(): AppState {
    return this.store.get();
  }

  private update(fn: (state: AppState) => AppState): void {
    this.store.set(fn);
  }

  start(): () => void {
    this.disposers.push(this.client.subscribe((event) => this.onEvent(event)));
    this.disposers.push(
      this.platform.onHashChange(() => {
        const hash = this.platform.readHash();
        if (hash !== routeToHash(this.state.route)) {
          this.applyRoute(hashToRoute(hash), false);
        }
      }),
    );
    if (this.updates) {
      this.updates.start();
      this.disposers.push(() => this.updates?.stop());
    }
    void this.boot(false);
    return () => this.dispose();
  }

  /**
   * Como este shell conta ao usuário que algo aconteceu: as notificações do próprio navegador, ou o que
   * o SO do desktop oferece. Chame antes de `start`. Ambas as configurações são lidas por anúncio, então desligar
   * o interruptor ou voltar à janela vale na hora.
   */
  attachNotifier(notifier: Notifier): void {
    this.notifier = notifier;
    this.notifications = new NotificationManager(
      notifier,
      () => ({ enabled: this.state.prefs.notifications, focused: this.platform.focused() }),
      () => this.platform.now(),
    );
  }

  /** Pede permissão, que navegadores só concedem a partir de um gesto real, então um botão precisa chamar isso. */
  async askToNotify(): Promise<void> {
    const granted = (await this.notifier?.request()) ?? "denied";
    if (granted !== "granted") {
      this.toast("info", "Notificações desligadas", "Seu navegador ou sistema as recusou, então nada será mostrado.");
      return;
    }
    this.setPrefs({ notifications: true });
  }

  /** O atualizador do shell desktop. Chame antes de `start`; um navegador nunca tem um. */
  attachUpdater(updater: AppUpdater): void {
    this.updates = new UpdateManager(
      updater,
      () => ({ autoUpdate: this.state.prefs.autoUpdate, paused: this.state.prefs.updatesPaused }),
      (next) => {
        const previous = this.state.updates?.status;
        this.update((s) => ({ ...s, updates: next }));
        if (next.status === "ready" && previous !== "ready") {
          this.toast(
            "info",
            `Helicon ${next.update?.version ?? ""} está pronto`,
            this.state.prefs.autoUpdate && !this.state.prefs.updatesPaused ? "Instala quando você fechar o Helicon." : "Reinicie o Helicon para instalá-lo.",
            { label: "Reiniciar agora", run: () => this.restartToUpdate() },
          );
        }
      },
      () => this.platform.now(),
    );
    this.update((s) => ({ ...s, updates: this.updates?.current ?? null }));
  }

  checkForUpdates(): void {
    void this.updates?.check(true);
  }

  downloadUpdate(): void {
    void this.updates?.download();
  }

  restartToUpdate(): void {
    void this.updates?.restart();
  }

  setAutoUpdate(autoUpdate: boolean): void {
    this.setPrefs({ autoUpdate });
    if (autoUpdate && !this.state.prefs.updatesPaused) {
      void this.updates?.download();
    }
  }

  setUpdatesPaused(updatesPaused: boolean): void {
    this.setPrefs({ updatesPaused });
    if (!updatesPaused) {
      void this.updates?.check();
    }
  }

  dispose(): void {
    for (const dispose of this.disposers.splice(0)) {
      dispose();
    }
    for (const handle of [this.flushHandle, this.refreshHandle, this.saveHandle]) {
      if (handle !== null) {
        this.platform.cancel(handle);
      }
    }
    this.platform.savePrefs(this.state.prefs);
  }

  private async boot(refreshEnv: boolean): Promise<void> {
    this.update((s) => ({ ...s, boot: "loading", bootError: null }));
    try {
      const env = await this.client.probeEnvironment(refreshEnv);
      this.update((s) => ({ ...s, env }));
      if (!env.museFound) {
        this.update((s) => ({ ...s, boot: "ready" }));
        return;
      }
      await this.refresh();
      this.update((s) => ({ ...s, boot: "ready" }));
      this.applyRoute(hashToRoute(this.platform.readHash()), false);
      void this.discoverAll(true);
      void this.loadModels();
      void this.loadPlanUsage();
    } catch (error) {
      this.update((s) => ({ ...s, boot: "error", bootError: errorMessage(error) }));
    }
  }

  retryBoot(): void {
    void this.boot(true);
  }

  // ---------------------------------------------------------------- data

  refresh(): Promise<void> {
    if (this.refreshing) {
      this.refreshQueued = true;
      return this.refreshing;
    }
    this.refreshing = this.loadLists()
      .catch((error) => {
        if (this.state.boot !== "ready") {
          throw error;
        }
      })
      .finally(() => {
        this.refreshing = null;
        if (this.refreshQueued) {
          this.refreshQueued = false;
          void this.refresh();
        }
      });
    return this.refreshing;
  }

  private async loadLists(): Promise<void> {
    const [projects, sessions] = await Promise.all([this.client.listProjects(), this.client.listSessions()]);
    const byId: Record<string, SessionSummary> = {};
    for (const session of sessions) {
      byId[session.sessionId] = session;
    }
    this.update((s) => ({ ...s, projects, sessions: byId, sessionsLoaded: true }));
  }

  private scheduleRefresh(): void {
    if (this.refreshHandle !== null) {
      return;
    }
    this.refreshHandle = this.platform.schedule(() => {
      this.refreshHandle = null;
      void this.refresh();
    }, 150);
  }

  async discoverAll(silent = false): Promise<void> {
    if (this.state.discovering) {
      return;
    }
    this.update((s) => ({ ...s, discovering: true }));
    try {
      await this.client.discover();
      await this.refresh();
      if (!silent) {
        this.toast("success", "Conversas atualizadas");
      }
    } catch (error) {
      if (!silent) {
        this.toast("error", "Não foi possível atualizar as conversas a partir do Muse", errorMessage(error));
      }
    } finally {
      this.update((s) => ({ ...s, discovering: false }));
    }
  }

  private async loadModels(): Promise<void> {
    try {
      const models = await this.client.listModels();
      this.update((s) => ({ ...s, models }));
    } catch {
      /* o seletor recorre ao modelo da sessão */
    }
  }

  // ---------------------------------------------------------------- routing

  navigate(route: Route): void {
    this.applyRoute(route, true);
  }

  openThread(sessionId: string): void {
    this.navigate({ kind: "thread", sessionId });
  }

  newThread(cwd?: string | null): void {
    const target = cwd ?? this.state.prefs.lastProject ?? this.state.projects[0]?.cwd ?? null;
    const known = target && this.state.projects.some((p) => p.cwd === target) ? target : (this.state.projects[0]?.cwd ?? null);
    this.navigate({ kind: "new", cwd: known });
  }

  private applyRoute(requested: Route, push: boolean): void {
    let route = requested;
    const previous = this.state.route;
    if (previous.kind === "thread") {
      this.markSeen(previous.sessionId, true);
    }
    if (route.kind === "thread" && this.state.sessionsLoaded && !this.state.sessions[route.sessionId]) {
      route = { kind: "home" };
    }
    this.update((s) => ({ ...s, route }));
    if (push) {
      const hash = routeToHash(route);
      if (this.platform.readHash() !== hash) {
        this.platform.writeHash(hash);
      }
    }
    if (route.kind === "thread") {
      this.markSeen(route.sessionId, true);
      const thread = this.state.threads[route.sessionId];
      if (!thread || thread.load === "idle" || thread.load === "error" || thread.fold.closed) {
        void this.loadThread(route.sessionId);
      }
    } else if (route.kind === "new" && route.cwd) {
      this.setPrefs({ lastProject: route.cwd });
    }
  }

  async loadThread(sessionId: string): Promise<void> {
    const existing = this.state.threads[sessionId];
    this.loading.set(sessionId, []);
    this.setThread(sessionId, { ...(existing ?? blankThread()), load: "loading", error: null });
    try {
      const load = await this.client.loadTranscript(sessionId);
      const buffered = this.loading.get(sessionId) ?? [];
      this.loading.delete(sessionId);
      const fold = applyEvents(foldFromLoad(load, existing?.fold ?? null), buffered);
      this.update((s) => ({
        ...s,
        threads: {
          ...s.threads,
          [sessionId]: {
            load: "ready",
            error: null,
            readOnly: load.readOnly,
            readOnlyReason: load.readOnlyReason,
            truncated: load.truncated,
            fold,
            attachments: (load.attachments ?? []).map((file) => this.stamp(file)),
            shellRuns: load.shellRuns ?? [],
          },
        },
        sessions: load.session ? { ...s.sessions, [sessionId]: load.session } : s.sessions,
      }));
      // O que já estava esperando quando a conversa abriu conta também, não só o que chega depois.
      this.autoAllow([sessionId]);
    } catch (error) {
      this.loading.delete(sessionId);
      this.setThread(sessionId, {
        ...(this.state.threads[sessionId] ?? blankThread()),
        load: "error",
        error: errorMessage(error),
      });
    }
  }

  // ---------------------------------------------------------------- events

  private onEvent(event: HeliconEvent): void {
    switch (event.type) {
      case "hello": {
        const wasLost = this.state.connection === "lost";
        this.update((s) => ({ ...s, connection: "open" }));
        if (wasLost && this.state.boot === "ready") {
          // Metas podem ter mudado enquanto o stream estava fora, e só a conversa aberta é recarregada. Deixe cada
          // outra conversa pegar a meta do servidor de novo em vez da última que viu via stream.
          for (const id of Object.keys(this.state.threads)) {
            this.patchFold(id, (f) => (f.meta.goalSeen ? { ...f, meta: { ...f.meta, goalSeen: false } } : f));
          }
          void this.refresh();
          const route = this.state.route;
          if (route.kind === "thread") {
            void this.loadThread(route.sessionId);
          }
        }
        break;
      }
      case "connection":
        this.update((s) => ({ ...s, connection: event.state === "open" ? "open" : "lost" }));
        break;
      case "msp":
        if (event.method === "skill/changed") {
          this.refreshSkillsFor(event.sessionId);
        }
        this.queueEvent(event.sessionId, { method: event.method, params: event.params, at: event.at });
        break;
      case "plan-usage":
        this.takePlanUsage(event.usage);
        break;
      case "session-status": {
        const known = this.state.sessions[event.sessionId];
        if (!known) {
          this.scheduleRefresh();
          break;
        }
        // Guardado antes da atualização sobrescrevê-lo: o que mudou é toda a questão.
        const before = known.live;
        this.update((s) => {
          const current = s.sessions[event.sessionId];
          return current ? { ...s, sessions: { ...s.sessions, [event.sessionId]: { ...current, live: event.live } } } : s;
        });
        this.announce(event.sessionId, known.title, before, event.live);
        // A única notícia que temos sobre uma conversa que este app nunca abriu: ela está esperando alguém.
        if (this.state.bypassAll && (event.live?.pendingApprovals ?? 0) > 0) {
          this.loadForBypass(event.sessionId);
        }
        break;
      }
      case "shell-run":
        this.addShellRun(event.sessionId, event.run);
        break;
      case "sessions-changed":
        this.scheduleRefresh();
        break;
      case "host":
        if (event.state === "failed" || event.state === "exited") {
          this.update((s) => ({ ...s, hostError: event.message }));
          this.toast("error", event.state === "failed" ? "Muse não pôde iniciar" : "Muse parou de repente", event.message);
        }
        break;
    }
  }

  private queueEvent(sessionId: string, event: ViewEvent): void {
    const buffer = this.loading.get(sessionId);
    if (buffer) {
      buffer.push(event);
      return;
    }
    if (!this.state.threads[sessionId]) {
      return;
    }
    const list = this.pending.get(sessionId);
    if (list) {
      list.push(event);
    } else {
      this.pending.set(sessionId, [event]);
    }
    if (this.flushHandle === null) {
      this.flushHandle = this.platform.schedule(() => this.flush(), FLUSH_MS);
    }
  }

  /** Aplica eventos de stream enfileirados uma vez por quadro, para deltas rápidos custarem uma renderização. */
  flush(): void {
    this.flushHandle = null;
    if (this.pending.size === 0) {
      return;
    }
    const batches = [...this.pending];
    this.pending.clear();
    this.update((s) => {
      const threads = { ...s.threads };
      for (const [id, events] of batches) {
        const thread = threads[id];
        if (thread) {
          threads[id] = { ...thread, fold: applyEvents(thread.fold, events) };
        }
      }
      return { ...s, threads };
    });
    this.autoAllow(batches.map(([id]) => id));
    this.noteEditedFiles(batches);
    const route = this.state.route;
    if (route.kind === "thread" && batches.some(([id]) => id === route.sessionId)) {
      this.markSeen(route.sessionId);
    }
  }

  /** Arquivos que o Muse acabou de escrever ou editar, para uma visão de um deles recarregar em vez de mostrar o que havia antes. */
  private noteEditedFiles(batches: [string, ViewEvent[]][]): void {
    const touched: string[] = [];
    for (const [sessionId, events] of batches) {
      const cwd = this.state.sessions[sessionId]?.cwd;
      if (!cwd) {
        continue;
      }
      for (const event of events) {
        const item = event.method === "item/completed" ? (event.params["item"] as import("../types.js").MspItem | undefined) : undefined;
        if (!item || item.kind !== "toolCall" || item.status !== "completed") {
          continue;
        }
        const tool = describeTool(item);
        const target = (tool.kind === "edit" || tool.kind === "write") && tool.subject ? fileTarget(tool.subject, cwd) : null;
        if (target) {
          touched.push(fileKey(cwd, target.path));
        }
      }
    }
    if (touched.length > 0) {
      this.update((s) => {
        const fileVersions = { ...s.fileVersions };
        for (const key of touched) {
          fileVersions[key] = (fileVersions[key] ?? 0) + 1;
        }
        return { ...s, fileVersions };
      });
    }
  }

  // ---------------------------------------------------------------- turns

  /**
   * Envia do composer. Linhas `/comandos` e `!shell` rodam como elas mesmas; `raw` envia o texto como prompt puro.
   * Retorna falso quando o composer que enviou deve devolver o texto.
   */
  async send(text: string, options: SendOptions = {}): Promise<boolean> {
    const trimmed = text.trim();
    const files = options.attachments ?? [];
    if (!trimmed && files.length === 0) {
      return false;
    }
    if (!options.raw && trimmed) {
      const shell = /^!\s*([\s\S]+)$/.exec(trimmed);
      if (shell) {
        return this.runShell((shell[1] as string).trim());
      }
      const parsed = parseSlash(trimmed);
      if (parsed) {
        // `queue` vai junto: uma repetição após compactação precisa esperar por ela, comando de barra ou não.
        return this.runSlash(trimmed, parsed, {
          steer: options.steer,
          queue: options.queue,
          // Um comando que envia um prompt leva os arquivos junto; um que abre um seletor não tem o que levar.
          attachments: files,
          previews: options.previews,
        });
      }
    }
    return this.deliver(trimmed, { steer: options.steer, queue: options.queue, attachments: files, previews: options.previews });
  }

  /** O projeto em que uma nova conversa começa: o da tela de nova conversa, senão o último usado. */
  private newThreadTarget(): string | null {
    const route = this.state.route;
    const target =
      (route.kind === "new" ? route.cwd : null) ?? this.state.prefs.lastProject ?? this.state.projects[0]?.cwd ?? null;
    if (!target) {
      this.toast("info", "Adicione um projeto primeiro", "Escolha a pasta em que o Muse deve trabalhar.");
      this.setAddProjectOpen(true);
    }
    return target;
  }

  /** Envia um prompt para a conversa aberta, ou começa uma conversa com ele. */
  private deliver(text: string, options: TurnDelivery): Promise<boolean> {
    const route = this.state.route;
    const bound = options.sessionId ?? (route.kind === "thread" ? route.sessionId : null);
    if (bound) {
      return this.sendToThread(bound, text, options, false);
    }
    const target = this.newThreadTarget();
    if (!target) {
      return Promise.resolve(false);
    }
    return this.startThread(
      target,
      options.displayText ?? text,
      (sessionId) => this.sendToThread(sessionId, text, options, false),
      { attachments: options.attachments, previews: options.previews },
    );
  }

  /** Chamado pelo composer que mostra `key`: recebe de volta um prompt que falhou ao enviar de outro lugar. */
  takeDraftHandoff(key: string): { text: string; attachments?: OutgoingAttachment[]; previews?: EchoAttachment[] } | null {
    const handoff = this.state.draftHandoff;
    if (!handoff || handoff.key !== key) {
      return null;
    }
    this.update((s) => ({ ...s, draftHandoff: null }));
    const { key: _key, ...draft } = handoff;
    return draft;
  }

  /** Põe texto no composer de uma conversa como se o usuário tivesse digitado, como `/goal ` para um novo objetivo. */
  prefillComposer(sessionId: string, text: string): void {
    this.update((s) => ({ ...s, draftHandoff: { key: sessionId, text } }));
  }

  /** Começa uma conversa em `cwd` e roda sua primeira ação lá; o que o usuário digitou vai para seu composer se isso falhar. */
  private async startThread(
    cwd: string,
    typed: string,
    first: (sessionId: string) => Promise<boolean>,
    files: { attachments?: OutgoingAttachment[]; previews?: EchoAttachment[] } = {},
  ): Promise<boolean> {
    if (this.state.busy["start"]) {
      return false;
    }
    this.setBusy("start", true);
    try {
      const { defaultMode, defaultModelId } = this.state.prefs;
      const session = await this.client.startSession(cwd, {
        approvalMode: defaultMode,
        modelId: defaultModelId ?? undefined,
      });
      const base = emptyFold();
      const fold: ThreadFold = {
        ...base,
        meta: { ...base.meta, modelId: session.modelId ?? defaultModelId, approvalMode: defaultMode },
      };
      this.update((s) => ({
        ...s,
        sessions: { ...s.sessions, [session.sessionId]: session },
        threads: {
          ...s.threads,
          [session.sessionId]: {
            load: "ready",
            error: null,
            readOnly: false,
            readOnlyReason: null,
            truncated: false,
            fold,
            attachments: [],
            shellRuns: [],
          },
        },
      }));
      this.setPrefs({ lastProject: cwd });
      this.navigate({ kind: "thread", sessionId: session.sessionId });
      const sent = await first(session.sessionId);
      if (!sent) {
        // O composer de nova conversa que enviou isso sumiu, então o prompt vai para o composer da nova conversa,
        // levando seus arquivos: sem eles um prompt enviado por uma imagem voltaria como um rascunho vazio.
        const carried = {
          ...(files.attachments?.length ? { attachments: files.attachments } : {}),
          ...(files.previews?.length ? { previews: files.previews } : {}),
        };
        this.update((s) => ({ ...s, draftHandoff: { key: session.sessionId, text: typed, ...carried } }));
      }
      return true;
    } catch (error) {
      this.toast("error", "Não foi possível começar uma conversa", errorMessage(error));
      return false;
    } finally {
      this.setBusy("start", false);
    }
  }

  private async sendToThread(
    sessionId: string,
    text: string,
    options: TurnDelivery,
    retried: boolean,
  ): Promise<boolean> {
    const thread = this.state.threads[sessionId];
    if (!thread) {
      return false;
    }
    if (thread.readOnly) {
      this.toast("info", "Esta conversa é só de leitura aqui", thread.readOnlyReason ?? "Outra sessão do Muse a tem aberta.");
      return false;
    }
    // Um segundo Enter chega antes do composer limpar, então um rascunho chega duas vezes: o primeiro envio é dono
    // dele, e a duplicata informa enviado — o texto está indo, então o composer fica limpo.
    const key = this.sendKey(sessionId, text, options);
    if (this.inflightSends.has(key)) {
      return true;
    }
    this.inflightSends.add(key);
    // Um chamador que sabe que uma mensagem está começando em outro lugar pode dizer isso, antes de seu `turn/started` nos alcançar.
    const running = thread.fold.activeTurnId !== null || options.queue === true;
    const echo: LocalEcho = {
      localId: nextLocalId(),
      // O eco mostra o que a transcrição mostrará, para combinar com o item de prompt quando ele chegar.
      text: options.displayText ?? text,
      turnId: null,
      disposition: running ? (options.steer ? "steered" : "queued") : "sending",
      createdAt: this.platform.now(),
      ...(options.previews?.length ? { attachments: options.previews } : {}),
    };
    this.patchFold(sessionId, (f) => addEcho(f, echo));
    try {
      const ack = await this.client.sendTurn(sessionId, text, {
        ifBusy: running ? (options.steer ? "steer" : "queue") : undefined,
        reasoningEffort: this.state.prefs.effort ?? undefined,
        displayText: options.displayText,
        attachments: options.attachments,
      });
      const disposition: LocalEcho["disposition"] =
        ack.disposition === "queued" ? "queued" : ack.disposition === "steered" ? "steered" : "started";
      this.patchFold(sessionId, (f) => updateEcho(f, echo.localId, { turnId: ack.turnId, disposition }));
      // O eco sai quando o prompt chega, então a conversa pega os arquivos salvos agora em vez de num recarregamento.
      this.keepAttachments(sessionId, ack.attachments ?? []);
      const turnId = ack.turnId;
      if (disposition === "started" && turnId) {
        this.patchFold(sessionId, (f) =>
          f.activeTurnId || f.turns[turnId]?.terminal
            ? f
            : {
                ...f,
                activeTurnId: turnId,
                turns: { ...f.turns, [turnId]: { startedAt: this.platform.now(), ...f.turns[turnId], turnId } },
              },
        );
      }
      return true;
    } catch (error) {
      this.patchFold(sessionId, (f) => removeEcho(f, echo.localId));
      const kind = errorKind(error);
      if (!retried && (kind === "sessionNotLoaded" || kind === "sessionStreamMismatch")) {
        await this.loadThread(sessionId);
        // A repetição reenvia sob esta chave, então não deve tropeçar na própria guarda.
        this.inflightSends.delete(key);
        return this.sendToThread(sessionId, text, options, true);
      }
      this.toast("error", "Mensagem não enviada", errorMessage(error));
      return false;
    } finally {
      this.inflightSends.delete(key);
    }
  }

  /** O que faz duas entregas de prompt serem o mesmo envio: a conversa, o texto, e os arquivos indo junto. */
  private sendKey(sessionId: string, text: string, options: TurnDelivery): string {
    const files = (options.attachments ?? [])
      .map((file) => `${file.name}:${file.mediaType}:${file.base64.length}:${file.base64.slice(0, 24)}`)
      .join(",");
    const mode = options.steer ? "steer" : options.queue ? "queue" : "send";
    return [sessionId, mode, options.displayText ?? "", text, files].join("\n");
  }

  async stop(sessionId: string): Promise<void> {
    const key = `stop:${sessionId}`;
    if (this.state.busy[key]) {
      return;
    }
    this.setBusy(key, true);
    try {
      await this.client.interruptTurn(sessionId, this.state.threads[sessionId]?.fold.activeTurnId ?? undefined);
    } catch (error) {
      this.toast("error", "Não foi possível parar a mensagem", errorMessage(error));
    } finally {
      this.setBusy(key, false);
    }
  }

  async unqueue(sessionId: string, echo: LocalEcho): Promise<void> {
    if (!echo.turnId) {
      this.patchFold(sessionId, (f) => removeEcho(f, echo.localId));
      return;
    }
    try {
      await this.client.unqueueTurn(sessionId, echo.turnId);
      this.patchFold(sessionId, (f) => removeEcho(f, echo.localId));
    } catch (error) {
      this.toast("info", "Essa mensagem já começou", errorMessage(error));
    }
  }

  /** Limpa o aviso de uma mensagem falha, para quando o usuário já agiu sobre ele e ele só está ocupando espaço. */
  /**
   * Fecha o aviso de uma mensagem falha. Guardado nas prefs além do fold: o fold é reconstruído do histórico do Muse
   * sempre que a conversa recarrega, e o aviso voltaria com ele.
   */
  dismissTurnError(sessionId: string, turnId: string | null): void {
    if (!turnId) {
      return;
    }
    const key = `${sessionId}:${turnId}`;
    const dismissed = this.state.prefs.dismissedTurnErrors;
    if (!dismissed.includes(key)) {
      this.setPrefs({ dismissedTurnErrors: [...dismissed, key].slice(-300) });
    }
    this.patchFold(sessionId, (f) => {
      const info = f.turns[turnId];
      if (!info?.error) {
        return f;
      }
      const { error: _error, ...rest } = info;
      return { ...f, turns: { ...f.turns, [turnId]: { ...rest, dismissed: true } } };
    });
  }

  /** Verdadeiro quando o prompt realmente foi; um chamador pode então dizer se devolve o texto ao usuário. */
  async retryTurn(
    sessionId: string,
    prompt: string,
    options: { queue?: boolean; attachments?: OutgoingAttachment[]; previews?: EchoAttachment[] } = {},
  ): Promise<boolean> {
    const delivery: TurnDelivery = {
      queue: options.queue,
      attachments: options.attachments,
      previews: options.previews,
      // Nomeado, não lido da rota: o usuário pode ter ido para outra conversa enquanto as skills carregavam.
      sessionId,
    };
    // Uma mensagem começada por `/plan …` ou `/init` mostra o comando, então repetir roda o comando de novo.
    const parsed = parseSlash(prompt);
    const cwd = this.state.sessions[sessionId]?.cwd ?? null;
    if (parsed && cwd) {
      await this.loadSkills(cwd);
      const skills = this.state.skills[cwd]?.skills ?? [];
      if (resolveSlash(parsed, slashCommands(skills, { inThread: true }), skills).kind !== "unknown") {
        return this.runSlash(prompt, parsed, delivery);
      }
    }
    return this.sendToThread(sessionId, prompt, delivery, false);
  }

  // ---------------------------------------------------------------- approvals and questions

  /** Verdadeiro quando esta conversa responde às próprias aprovações, pelo próprio armamento ou pelo interruptor geral da sessão. */
  bypassArmed(sessionId: string): boolean {
    return this.state.bypassAll || this.state.bypassThreads.includes(sessionId);
  }

  setBypassAll(on: boolean): void {
    this.update((s) => ({ ...s, bypassAll: on }));
    if (on) {
      this.autoAllow(Object.keys(this.state.threads));
      // Uma conversa que ninguém abriu aqui não tem estado local algum, então seus eventos são descartados na chegada e
      // suas aprovações são invisíveis. A visão ao vivo do servidor é o que diz quais sessões estão esperando.
      for (const session of Object.values(this.state.sessions)) {
        if ((session.live?.pendingApprovals ?? 0) > 0) {
          this.loadForBypass(session.sessionId);
        }
      }
    }
  }

  /**
   * O que uma mudança no estado ao vivo de uma conversa vale dizer em voz alta. Só as bordas contam: um pedido
   * que acabou de aparecer, uma mensagem que acabou de terminar, uma meta que acabou de deixar de ser ativa.
   * Um estado que já era verdadeiro quando o último relato chegou não diz nada de novo.
   */
  private announce(
    sessionId: string,
    thread: string,
    before: SessionSummary["live"],
    after: SessionSummary["live"],
  ): void {
    const manager = this.notifications;
    if (!manager || !after) {
      return;
    }
    if ((after.pendingApprovals ?? 0) > 0 && (before?.pendingApprovals ?? 0) === 0) {
      void manager.announce({ kind: "approval", sessionId, thread });
    }
    if ((after.pendingInputs ?? 0) > 0 && (before?.pendingInputs ?? 0) === 0) {
      void manager.announce({ kind: "question", sessionId, thread });
    }
    if (after.activeTurnId === null && before?.activeTurnId != null && after.lastTerminal) {
      const failed = Boolean(after.lastError) || after.lastTerminal === "failed";
      void manager.announce({ kind: "finished", sessionId, thread, failed });
    }
    const status = after.goal?.status ?? null;
    if (status && status !== "active" && status !== (before?.goal?.status ?? null)) {
      void manager.announce({ kind: "goal", sessionId, thread, status });
    }
  }

  /** Abre uma conversa só para o bypass alcançar suas aprovações, e as responde quando chega lá. */
  private loadForBypass(sessionId: string): void {
    const thread = this.state.threads[sessionId];
    if (!thread) {
      void this.loadThread(sessionId);
    } else if (thread.load === "ready") {
      this.autoAllow([sessionId]);
    }
  }

  setThreadBypass(sessionId: string, on: boolean): void {
    this.update((s) => ({
      ...s,
      bypassThreads: on ? [...new Set([...s.bypassThreads, sessionId])] : s.bypassThreads.filter((id) => id !== sessionId),
    }));
    if (on) {
      this.autoAllow([sessionId]);
    }
  }

  /** Põe toda conversa que respondia por si mesma de volta a perguntar, sem tocar no interruptor geral da sessão. */
  clearThreadBypass(): void {
    if (this.state.bypassThreads.length > 0) {
      this.update((s) => ({ ...s, bypassThreads: [] }));
    }
  }

  /**
   * Com o que um bypass responde: permitir desta vez. Uma escolha com prévia de regra escreveria uma regra permanente
   * na config do próprio Muse, o que não se faz em nome de alguém enquanto ele não está olhando.
   */
  private allowOnce(request: ApprovalRequest): string | null {
    const choices = request.availableChoices ?? [];
    // Só uma escolha que não deixa nada para trás. Onde o único jeito de permitir é lembrar uma regra, o
    // pedido fica para o usuário: uma regra na config do próprio Muse sobreviveria ao bypass que a escreveu.
    return choices.find((choice) => choice.decision === "approved" && !choice.rulePreview)?.choiceId ?? null;
  }

  /** Responde o que está pendente em cada conversa armada; um pedido sem oferta de aprovação fica para o usuário. */
  private autoAllow(sessionIds: Iterable<string>): void {
    for (const sessionId of new Set(sessionIds)) {
      const thread = this.state.threads[sessionId];
      if (!this.bypassArmed(sessionId) || !thread || thread.readOnly) {
        continue;
      }
      for (const request of Object.values(thread.fold.approvals)) {
        const choiceId = this.allowOnce(request);
        if (choiceId && !this.state.busy[`approval:${request.approvalId}`]) {
          void this.decide(request, choiceId, null, "bypass");
        }
      }
    }
  }

  async decide(
    request: ApprovalRequest,
    choiceId: string,
    feedback: string | null,
    by: "user" | "bypass" = "user",
  ): Promise<void> {
    const key = `approval:${request.approvalId}`;
    if (this.state.busy[key]) {
      return;
    }
    this.setBusy(key, true);
    // O card sai no clique, não no `approval/resolved` do host, que pode estar um segundo ou mais atrasado.
    const decision = (request.availableChoices ?? []).find((c) => c.choiceId === choiceId)?.decision ?? "approved";
    this.patchFold(request.sessionId, (f) => {
      const approvals = { ...f.approvals };
      delete approvals[request.approvalId];
      return { ...f, approvals, resolved: { ...f.resolved, [request.approvalId]: { decision, resolvedBy: by } } };
    });
    try {
      await this.client.decideApproval({
        sessionId: request.sessionId,
        approvalId: request.approvalId,
        requirementId: request.currentRequirementId,
        choiceId,
        feedback,
      });
    } catch (error) {
      const kind = errorKind(error);
      if (kind === "approvalAlreadyResolved" || kind === "approvalNotFound") {
        /* já foi resolvido em outro lugar; o card sumiu de todo jeito */
      } else if (kind === "approvalRequirementStale") {
        this.restoreApproval(request);
        this.toast("info", "O pedido mudou", "Revise o pedido atualizado e decida de novo.");
      } else {
        this.restoreApproval(request);
        this.toast("error", "Decisão não enviada", errorMessage(error));
      }
    } finally {
      this.setBusy(key, false);
    }
  }

  /** Devolve um pedido quando sua decisão não chegou, para a escolha continuar do usuário. */
  private restoreApproval(request: ApprovalRequest): void {
    this.patchFold(request.sessionId, (f) => {
      const resolved = { ...f.resolved };
      delete resolved[request.approvalId];
      return { ...f, approvals: { ...f.approvals, [request.approvalId]: request }, resolved };
    });
  }

  private dropInput(request: UserInputRequest): void {
    this.patchFold(request.sessionId, (f) => {
      const userInputs = { ...f.userInputs };
      delete userInputs[request.userInputId];
      return { ...f, userInputs };
    });
  }

  private async settleInput(request: UserInputRequest, action: () => Promise<void>, failure: string): Promise<void> {
    const key = `input:${request.userInputId}`;
    if (this.state.busy[key]) {
      return;
    }
    this.setBusy(key, true);
    try {
      await action();
    } catch (error) {
      const kind = errorKind(error);
      if (kind === "userInputAlreadySettled" || kind === "userInputNotFound") {
        this.dropInput(request);
      } else {
        this.toast("error", failure, errorMessage(error));
      }
    } finally {
      this.setBusy(key, false);
    }
  }

  answer(request: UserInputRequest, answers: UserInputAnswer[]): Promise<void> {
    return this.settleInput(
      request,
      () => this.client.answerUserInput(request.sessionId, request.userInputId, answers),
      "Resposta não enviada",
    );
  }

  skipQuestion(request: UserInputRequest): Promise<void> {
    return this.settleInput(
      request,
      () => this.client.cancelUserInput(request.sessionId, request.userInputId),
      "Não foi possível pular a pergunta",
    );
  }

  clarify(request: UserInputRequest, content: string): Promise<void> {
    return this.settleInput(
      request,
      () => this.client.clarifyUserInput(request.sessionId, request.userInputId, content),
      "Réplica não enviada",
    );
  }

  // ---------------------------------------------------------------- composer settings

  async setModel(modelId: string): Promise<void> {
    const model = this.state.models.find((m) => m.modelId === modelId);
    if (model?.contributor && !this.state.prefs.contributorAck) {
      this.setPrefs({ contributorAck: true });
      this.toast(
        "info",
        "Modelo de colaborador selecionado",
        model.description ?? "Prompts e saídas em modelos de colaborador podem ser usados para melhoria do produto.",
      );
    }
    this.setPrefs({ defaultModelId: modelId });
    const route = this.state.route;
    if (route.kind !== "thread") {
      return;
    }
    const previous = this.state.threads[route.sessionId]?.fold.meta.modelId ?? null;
    this.patchMeta(route.sessionId, { modelId });
    try {
      await this.client.setSessionModel(route.sessionId, modelId);
    } catch (error) {
      this.patchMeta(route.sessionId, { modelId: previous });
      this.toast("error", "Não foi possível trocar de modelo", errorMessage(error));
    }
  }

  async setMode(mode: ApprovalMode): Promise<void> {
    this.setPrefs({ defaultMode: mode });
    const route = this.state.route;
    if (route.kind !== "thread") {
      return;
    }
    const previous = this.state.threads[route.sessionId]?.fold.meta.approvalMode ?? null;
    this.patchMeta(route.sessionId, { approvalMode: mode });
    try {
      await this.client.setApprovalMode(route.sessionId, mode);
    } catch (error) {
      this.patchMeta(route.sessionId, { approvalMode: previous });
      this.toast("error", "Não foi possível alterar as permissões", errorMessage(error));
    }
  }

  /**
   * O esforço para novas mensagens. A conversa aberta o assume na hora, como seu padrão permanente: esse é o único esforço
   * que o `muse serve` aplica, e definir agora significa que o TUI e qualquer outro cliente veem o mesmo nível. Auto deixa
   * a conversa onde está.
   */
  setEffort(effort: ReasoningEffort | null): void {
    this.setPrefs({ effort });
    const route = this.state.route;
    const thread = route.kind === "thread" ? this.state.threads[route.sessionId] : undefined;
    if (effort === null || route.kind !== "thread" || !thread || thread.readOnly) {
      return;
    }
    void this.client.setReasoningEffort(route.sessionId, effort).catch((error: unknown) => {
      // Uma conversa ainda não carregada assume o esforço com sua próxima mensagem.
      const kind = errorKind(error);
      if (kind !== "sessionNotLoaded" && kind !== "sessionStreamMismatch") {
        this.toast("error", "Não foi possível alterar o esforço desta conversa", errorMessage(error));
      }
    });
  }

  // ---------------------------------------------------------------- plan usage

  /** A janela de assinatura que o Muse viu por último, do servidor; ela também chega como evento sempre que se move. */
  async loadPlanUsage(): Promise<void> {
    try {
      const usage = await this.client.planUsage();
      if (usage) {
        this.takePlanUsage(usage);
      }
    } catch {
      /* o medidor é extra: um servidor sem ele deixa a página de uso como estava */
    }
  }

  private takePlanUsage(usage: import("../types.js").PlanUsage): void {
    const current = this.state.planUsage;
    if (current && current.observedAtMs > usage.observedAtMs) {
      return;
    }
    this.update((s) => ({ ...s, planUsage: usage }));
  }

  // ---------------------------------------------------------------- threads and projects

  async rename(sessionId: string, title: string): Promise<void> {
    const clean = title.trim();
    const current = this.state.sessions[sessionId];
    if (!clean || !current || clean === current.title) {
      return;
    }
    this.upsertSession({ ...current, title: clean, titleSource: "user" });
    try {
      const saved = await this.client.updateSession(sessionId, { title: clean });
      if (saved) {
        this.upsertSession(saved);
      }
    } catch (error) {
      this.upsertSession(current);
      this.toast("error", "Não foi possível renomear a conversa", errorMessage(error));
    }
  }

  async archive(sessionId: string): Promise<void> {
    const current = this.state.sessions[sessionId];
    if (!current) {
      return;
    }
    this.update((s) => {
      const sessions = { ...s.sessions };
      delete sessions[sessionId];
      return { ...s, sessions };
    });
    const route = this.state.route;
    if (route.kind === "thread" && route.sessionId === sessionId) {
      this.navigate({ kind: "new", cwd: current.cwd });
    }
    try {
      await this.client.updateSession(sessionId, { archived: true });
      this.toast("info", "Conversa arquivada", current.title, {
        label: "Undo",
        run: () => void this.unarchive(current),
      });
    } catch (error) {
      this.upsertSession(current);
      this.toast("error", "Não foi possível arquivar a conversa", errorMessage(error));
    }
  }

  /** Guarda uma conversa na lista Resolvidas do projeto, ou a traz de volta. */
  async setSettled(sessionId: string, settled: boolean): Promise<void> {
    const current = this.state.sessions[sessionId];
    if (!current || current.settled === settled) {
      return;
    }
    const now = new Date(this.platform.now()).toISOString();
    this.upsertSession(
      settled ? { ...current, settled: true, settledAt: now, unsettledAt: null } : { ...current, settled: false, settledAt: null, unsettledAt: now },
    );
    try {
      const saved = await this.client.updateSession(sessionId, { settled });
      if (saved) {
        this.upsertSession(saved);
      }
    } catch (error) {
      this.upsertSession(current);
      this.toast("error", settled ? "Não foi possível resolver a conversa" : "Não foi possível trazer a conversa de volta", errorMessage(error));
    }
  }

  toggleShelf(key: string): void {
    const open = this.state.prefs.openShelves;
    this.setPrefs({ openShelves: open.includes(key) ? open.filter((k) => k !== key) : [...open, key] });
  }

  private async unarchive(session: SessionSummary): Promise<void> {
    try {
      const saved = await this.client.updateSession(session.sessionId, { archived: false });
      this.upsertSession(saved ?? { ...session, archived: false });
    } catch (error) {
      this.toast("error", "Não foi possível restaurar a conversa", errorMessage(error));
    }
  }

  listDirectory(path: string): Promise<import("../types.js").DirectoryListing> {
    return this.client.listDirectory(path);
  }

  async revealPath(path: string): Promise<void> {
    try {
      await this.client.revealPath(path);
    } catch (error) {
      this.toast("error", "Não foi possível abrir a pasta", errorMessage(error));
    }
  }

  async cloneProject(url: string, path: string): Promise<boolean> {
    if (this.state.busy["cloneProject"]) {
      return false;
    }
    this.setBusy("cloneProject", true);
    try {
      const added = await this.client.cloneProject(url, path);
      await this.refresh();
      this.setAddProjectOpen(false);
      this.toast(
        "info",
        "Repositório clonado",
        added.warning ? `O Muse ainda não pôde listar suas conversas: ${added.warning}` : added.cwd,
      );
      this.newThread(added.cwd);
      return true;
    } catch (error) {
      this.toast("error", "Não foi possível clonar o repositório", errorMessage(error));
      return false;
    } finally {
      this.setBusy("cloneProject", false);
    }
  }

  async addProject(cwd: string, options: { create?: boolean } = {}): Promise<boolean> {
    const path = cwd.trim();
    if (!path || this.state.busy["addProject"]) {
      return false;
    }
    this.setBusy("addProject", true);
    try {
      const added = await this.client.addProject(path, options);
      await this.refresh();
      this.setAddProjectOpen(false);
      if (added.warning) {
        this.toast("info", "Projeto adicionado", `O Muse ainda não pôde listar suas conversas: ${added.warning}`);
      }
      this.newThread(added.cwd);
      return true;
    } catch (error) {
      this.toast("error", "Não foi possível adicionar essa pasta", errorMessage(error));
      return false;
    } finally {
      this.setBusy("addProject", false);
    }
  }

  /** Uso de tokens em todas as conversas que o servidor conhece, para a página de uso. */
  usageReport(days: number): Promise<import("../types.js").UsageReport> {
    return this.client.usage(days);
  }

  /** Move um projeto na lateral, tirando a nova ordem da linha em que foi solto. */
  async reorderProjects(cwd: string, beforeCwd: string | null): Promise<void> {
    const current = this.state.projects;
    const moving = current.find((p) => p.cwd === cwd);
    if (!moving || cwd === beforeCwd) {
      return;
    }
    const rest = current.filter((p) => p.cwd !== cwd);
    const at = beforeCwd === null ? rest.length : rest.findIndex((p) => p.cwd === beforeCwd);
    const next = [...rest.slice(0, at < 0 ? rest.length : at), moving, ...rest.slice(at < 0 ? rest.length : at)];
    this.update((s) => ({ ...s, projects: next }));
    try {
      await this.client.setProjectOrder(next.map((p) => p.cwd));
    } catch (error) {
      this.update((s) => ({ ...s, projects: current }));
      this.toast("error", "Não foi possível reordenar os projetos", errorMessage(error));
    }
  }

  async hideProject(cwd: string): Promise<void> {
    const project = this.state.projects.find((p) => p.cwd === cwd);
    if (!project) {
      return;
    }
    this.update((s) => ({ ...s, projects: s.projects.filter((p) => p.cwd !== cwd) }));
    const route = this.state.route;
    const active = route.kind === "thread" ? this.state.sessions[route.sessionId] : null;
    if ((route.kind === "new" && route.cwd === cwd) || active?.cwd === cwd) {
      this.navigate({ kind: "home" });
    }
    try {
      await this.client.hideProject(cwd);
      this.toast("info", `Removeu ${project.displayName} da lateral`, "Suas conversas do Muse estão intactas.", {
        label: "Undo",
        run: () => void this.addProject(cwd),
      });
    } catch (error) {
      void this.refresh();
      this.toast("error", "Não foi possível remover o projeto", errorMessage(error));
    }
  }

  async refreshProject(cwd: string): Promise<void> {
    try {
      await this.client.discover(cwd);
      await this.refresh();
    } catch (error) {
      this.toast("error", "Não foi possível atualizar esse projeto", errorMessage(error));
    }
  }

  async togglePin(cwd: string): Promise<void> {
    const project = this.state.projects.find((p) => p.cwd === cwd);
    if (!project) {
      return;
    }
    try {
      await this.client.setPinned(cwd, !project.pinned);
      await this.refresh();
    } catch (error) {
      this.toast("error", "Não foi possível atualizar o projeto", errorMessage(error));
    }
  }

  // ---------------------------------------------------------------- slash commands, skills and shell

  /** A pasta em que os comandos do composer agem: a da conversa aberta, ou onde uma nova conversa começaria. */
  composerCwd(): string | null {
    const route = this.state.route;
    if (route.kind === "thread") {
      return this.state.sessions[route.sessionId]?.cwd ?? null;
    }
    return (route.kind === "new" ? route.cwd : null) ?? this.state.prefs.lastProject ?? this.state.projects[0]?.cwd ?? null;
  }

  private readonly skillLoads = new Map<string, Promise<void>>();

  /**
   * Carrega as skills de uma pasta para o menu de barra. Uma lista carregada é reusada por um minuto e um carregamento falho
   * tenta de novo após dez segundos; um carregamento já rodando é compartilhado, para um comando enviado no meio esperar por ele.
   */
  loadSkills(cwd: string): Promise<void> {
    const running = this.skillLoads.get(cwd);
    if (running) {
      return running;
    }
    const current = this.state.skills[cwd];
    const age = this.platform.now() - (current?.loadedAt ?? 0);
    if (current && age < (current.status === "ready" ? SKILLS_FRESH_MS : SKILLS_RETRY_MS)) {
      return Promise.resolve();
    }
    const load = this.fetchSkills(cwd, current).finally(() => this.skillLoads.delete(cwd));
    this.skillLoads.set(cwd, load);
    return load;
  }

  /** O Muse disse que as skills de uma conversa mudaram: a lista de sua pasta está velha, e o composer aberto deve ver a nova. */
  private refreshSkillsFor(sessionId: string): void {
    const cwd = this.state.sessions[sessionId]?.cwd;
    const current = cwd ? this.state.skills[cwd] : undefined;
    if (!cwd || !current) {
      return;
    }
    this.setSkills(cwd, { ...current, loadedAt: 0 });
    void this.loadSkills(cwd);
  }

  /** A conversa aberta, quando está em `cwd`: a lista de skills do próprio Muse para ela é a que se mostra. */
  private skillSession(cwd: string): string | undefined {
    const route = this.state.route;
    return route.kind === "thread" && this.state.sessions[route.sessionId]?.cwd === cwd ? route.sessionId : undefined;
  }

  private async fetchSkills(cwd: string, current: SkillsState | undefined): Promise<void> {
    this.setSkills(cwd, { status: "loading", skills: current?.skills ?? [], error: null, loadedAt: current?.loadedAt ?? 0 });
    try {
      const catalog = await this.client.listSkills(cwd, this.skillSession(cwd));
      this.setSkills(cwd, {
        status: catalog.error ? "error" : "ready",
        skills: catalog.skills,
        error: catalog.error,
        loadedAt: this.platform.now(),
      });
    } catch (error) {
      this.setSkills(cwd, { status: "error", skills: current?.skills ?? [], error: errorMessage(error), loadedAt: this.platform.now() });
    }
  }

  private setSkills(cwd: string, next: SkillsState): void {
    this.update((s) => ({ ...s, skills: { ...s.skills, [cwd]: next } }));
  }

  setPicker(picker: ComposerPicker | null): void {
    this.update((s) => (s.picker === picker ? s : { ...s, picker }));
  }

  /** Fecha `picker` só se ainda for o aberto, para um menu fechando após passar para um diálogo deixar o diálogo aberto. */
  closePicker(picker: ComposerPicker): void {
    this.update((s) => (s.picker === picker ? { ...s, picker: null } : s));
  }

  /** `!comando` roda no shell da pasta da conversa; na tela de nova conversa ele começa a conversa primeiro. */
  private async runShell(command: string): Promise<boolean> {
    const run = async (sessionId: string): Promise<boolean> => {
      const thread = this.state.threads[sessionId];
      if (thread?.readOnly) {
        this.toast("info", "Esta conversa é só de leitura aqui", thread.readOnlyReason ?? "Outra sessão do Muse a tem aberta.");
        return false;
      }
      const key = `shell:${sessionId}`;
      if (this.state.busy[key]) {
        return false;
      }
      this.setBusy(key, true);
      try {
        // O Helicon roda `!` sozinho: o host do próprio Muse não tem sandbox para estes, então nunca os roda.
        this.addShellRun(sessionId, await this.client.runShellProxy(sessionId, command));
        return true;
      } catch (error) {
        this.toast("error", "Comando não executado", errorMessage(error));
        return false;
      } finally {
        this.setBusy(key, false);
      }
    };
    const route = this.state.route;
    if (route.kind === "thread") {
      return run(route.sessionId);
    }
    const target = this.newThreadTarget();
    return target ? this.startThread(target, `!${command}`, run) : false;
  }

  /**
   * O servidor retorna uma URL relativa para cada arquivo salvo. O navegador as carrega sozinho, fora das
   * chamadas do cliente, então um servidor protegido por token recusaria todas elas: a imagem na transcrição
   * e os bytes que uma repetição relê. Elas carregam as mesmas credenciais que todo o resto daqui em diante.
   */
  private stamp(file: AttachmentView): AttachmentView {
    return { ...file, url: this.client.assetUrl(file.url) };
  }

  /** Adiciona arquivos que o servidor acabou de salvar à conversa aberta, pulando os que ela já tem. */
  private keepAttachments(sessionId: string, saved: AttachmentView[]): void {
    if (saved.length === 0) {
      return;
    }
    this.update((s) => {
      const thread = s.threads[sessionId];
      if (!thread) {
        return s;
      }
      const known = new Set(thread.attachments.map((file) => file.id));
      const added = saved.filter((file) => !known.has(file.id)).map((file) => this.stamp(file));
      if (added.length === 0) {
        return s;
      }
      return { ...s, threads: { ...s.threads, [sessionId]: { ...thread, attachments: [...thread.attachments, ...added] } } };
    });
  }

  /** Guarda um comando que o Helicon rodou na conversa a que pertence, quem quer que o tenha iniciado. */
  private addShellRun(sessionId: string, run: import("../types.js").ShellRun): void {
    this.update((s) => {
      const thread = s.threads[sessionId];
      if (!thread || thread.shellRuns.some((existing) => existing.id === run.id)) {
        return s;
      }
      return { ...s, threads: { ...s.threads, [sessionId]: { ...thread, shellRuns: [...thread.shellRuns, run] } } };
    });
  }

  /** Entrega a saída de um comando ao Muse como próximo prompt, já que o Muse nunca o viu rodar. */
  sendShellOutput(sessionId: string, run: import("../types.js").ShellRun): Promise<boolean> {
    const fence = "`".repeat(Math.max(3, ...(run.output.match(/`+/g) ?? []).map((mark) => mark.length + 1)));
    const status = run.exitCode === 0 ? "" : ` (exit ${run.exitCode ?? "unknown"})`;
    const text = `I ran this in the workspace${status}:\n\n${fence}sh\n${run.command}\n${fence}\n\nIts output:\n\n${fence}\n${run.output.trim() || "(no output)"}\n${fence}`;
    return this.sendToThread(sessionId, text, { displayText: `Compartilhou a saída de \`${run.command}\`` }, false);
  }

  private async runSlash(typed: string, parsed: ParsedSlash, options: TurnDelivery): Promise<boolean> {
    const route = this.state.route;
    // Uma repetição nomeia a conversa a que o comando pertence; um comando digitado age onde o usuário está.
    const bound = options.sessionId ?? null;
    const cwd = bound ? (this.state.sessions[bound]?.cwd ?? null) : this.composerCwd();
    // Uma skill digitada antes das skills da pasta chegarem espera por elas em vez de ler como desconhecida;
    // nativos além de `/skill` nunca esperam por uma lista lenta de skills.
    const builtin = slashCommands([], { inThread: true }).find((c) => c.name === parsed.name || c.aliases.includes(parsed.name));
    if (cwd && (!builtin || builtin.action === "skill")) {
      await this.loadSkills(cwd);
    }
    const skills = cwd ? (this.state.skills[cwd]?.skills ?? []) : [];
    // Resolve contra todo nativo, para um comando só-de-conversa digitado fora de uma conversa ganhar uma resposta útil.
    const resolved = resolveSlash(parsed, slashCommands(skills, { inThread: true }), skills);
    if (resolved.kind === "unknown") {
      this.toast("info", `Nenhum comando chamado /${resolved.name}`, "Escolha um da lista, ou envie o texto como prompt pelo menu.");
      return false;
    }
    if (resolved.kind === "skill") {
      return this.runSkill(resolved.skill, resolved.args, typed, cwd, options);
    }
    const { command, args } = resolved;
    const sessionId = bound ?? (route.kind === "thread" ? route.sessionId : null);
    if (command.needsThread && !sessionId) {
      this.toast("info", `Abra uma conversa para usar /${command.name}`);
      return false;
    }
    switch (command.action) {
      case "compact":
        await this.compact(sessionId as string);
        return true;
      case "fork":
        return this.fork(sessionId as string);
      case "new":
        this.newThread(cwd);
        return true;
      case "resume":
        this.setPaletteOpen(true);
        return true;
      case "init":
        return this.deliver(INIT_PROMPT, { ...options, displayText: typed });
      case "goal": {
        if (!args) {
          this.toast("info", "Adicione a meta depois de /goal", "Por exemplo: /goal fazer a suíte de testes passar");
          return false;
        }
        const verb = /^(pause|resume|clear)$/i.exec(args.trim())?.[1]?.toLowerCase() as GoalAction | undefined;
        if (verb) {
          if (!sessionId) {
            this.toast("info", `Abra uma conversa para ${verb === "pause" ? "pausar" : verb === "resume" ? "continuar" : "limpar"} sua meta`);
            return false;
          }
          return this.goalAction(sessionId, verb);
        }
        if (sessionId) {
          return this.setGoal(sessionId, args, typed, options);
        }
        const target = this.newThreadTarget();
        if (!target) {
          return false;
        }
        return this.startThread(target, typed, (fresh) => this.setGoal(fresh, args, typed, options));
      }
      case "model": {
        if (!args) {
          this.setPicker("model");
          return true;
        }
        const model = findModel(this.state.models, args, modelDisplayName);
        if (!model) {
          this.toast("info", `Nenhum modelo chamado ${args}`, "Digite /model para escolher da lista.");
          return false;
        }
        await this.setModel(model.modelId);
        return true;
      }
      case "effort": {
        if (!args) {
          this.setPicker("effort");
          return true;
        }
        const effort = parseEffort(args);
        if (effort === undefined) {
          this.toast("info", `Nível de esforço desconhecido: ${args}`, "Use off, minimal, low, medium, high, xhigh, max ou auto.");
          return false;
        }
        this.setEffort(effort);
        return true;
      }
      case "permissions": {
        if (!args) {
          this.setPicker("permissions");
          return true;
        }
        const mode = parseMode(args);
        if (!mode) {
          this.toast("info", `Modo de permissão desconhecido: ${args}`, "Use ask, unlisted, deny ou full.");
          return false;
        }
        if (mode === "allowAll") {
          // Acesso total sempre passa pela sua confirmação.
          this.setPicker("confirmFullAccess");
          return true;
        }
        await this.setMode(mode);
        return true;
      }
      default:
        return false;
    }
  }

  /** Uma mensagem de skill: o modelo carrega a skill sozinho, ou recebe o corpo embutido quando só usuários podem invocá-la. */
  private async runSkill(
    skill: SkillEntry,
    args: string,
    typed: string,
    cwd: string | null,
    options: TurnDelivery,
  ): Promise<boolean> {
    let body: string | null = null;
    if (skill.activation === "user-invocable-only") {
      try {
        body = await this.client.skillBody(cwd ?? "", skill.id);
      } catch (error) {
        this.toast("error", `Não foi possível carregar /${skill.name}`, errorMessage(error));
        return false;
      }
    }
    const turn = skillTurn(skill, args, typed, body);
    return this.deliver(turn.text, { ...options, displayText: turn.displayText });
  }

  /**
   * Retoma uma meta. Uma meta pausada continua pelo comando de meta do próprio Muse; uma bloqueada, que esse comando
   * não cobre, ganha um prompt pedindo ao modelo para continuar.
   */
  async continueGoal(sessionId: string, objective: string, status?: string): Promise<boolean> {
    if (status === "paused" && (await this.goalAction(sessionId, "resume", undefined, { quiet: true }))) {
      return true;
    }
    return this.sendToThread(sessionId, `Keep working toward the goal: ${objective}`, { displayText: "Continuar trabalhando na meta" }, false);
  }

  /**
   * Define a meta da conversa via `goal/set`, que também começa o trabalho nela quando a conversa está ociosa. Um host sem
   * os comandos de meta pega a rota antiga: um prompt pedindo ao modelo para defini-la com sua própria ferramenta.
   */
  private async setGoal(sessionId: string, objective: string, typed: string, options: TurnDelivery): Promise<boolean> {
    const thread = this.state.threads[sessionId];
    if (thread?.readOnly) {
      this.toast("info", "Esta conversa é só de leitura aqui", thread.readOnlyReason ?? "Outra sessão do Muse a tem aberta.");
      return false;
    }
    try {
      await this.client.goal(sessionId, "set", objective);
      return true;
    } catch (error) {
      if (errorKind(error) === "methodNotFound") {
        return this.sendToThread(sessionId, goalPrompt(objective), { ...options, displayText: typed }, false);
      }
      this.toast("error", "Não foi possível definir a meta", errorMessage(error));
      return false;
    }
  }

  /** Pause, resume, clear or edit the thread's goal. `quiet` leaves failures to the caller. */
  async goalAction(sessionId: string, action: GoalAction, objective?: string, options: { quiet?: boolean } = {}): Promise<boolean> {
    const key = `goal:${sessionId}`;
    if (this.state.busy[key]) {
      return false;
    }
    this.setBusy(key, true);
    try {
      await this.client.goal(sessionId, action, objective);
      return true;
    } catch (error) {
      if (!options.quiet) {
        // Muse refuses a verb the goal's current state does not allow, like pausing one that is already blocked.
        const stale = /invalid_goal_state|missing_goal/.test(errorMessage(error));
        this.toast(stale ? "info" : "error", GOAL_FAILURES[action], stale ? "The goal changed since this panel last updated. Try again once it catches up." : errorMessage(error));
      }
      return false;
    } finally {
      this.setBusy(key, false);
    }
  }

  // ---------------------------------------------------------------- tasks, subagents and workflows

  /** `background` or `stop` one tool task by its item id, or `stopAll` the thread's background work. */
  async taskAction(sessionId: string, action: TaskAction, taskId?: string): Promise<boolean> {
    const key = `task:${sessionId}:${taskId ?? "all"}`;
    if (this.state.busy[key]) {
      return false;
    }
    this.setBusy(key, true);
    try {
      await this.client.task(sessionId, action, taskId);
      return true;
    } catch (error) {
      this.toast("error", TASK_FAILURES[action], errorMessage(error));
      return false;
    } finally {
      this.setBusy(key, false);
    }
  }

  async subagentAction(sessionId: string, action: SubagentAction, subagentId: string, body?: string): Promise<boolean> {
    const key = `subagent:${sessionId}:${subagentId}`;
    if (this.state.busy[key]) {
      return false;
    }
    this.setBusy(key, true);
    try {
      await this.client.subagent(sessionId, action, subagentId, body ? { body } : {});
      return true;
    } catch (error) {
      this.toast("error", "The subagent did not take that", errorMessage(error));
      return false;
    } finally {
      this.setBusy(key, false);
    }
  }

  async workflowAction(
    sessionId: string,
    action: WorkflowAction,
    workflowRunId: string,
    child?: { childId: string; attempt: number },
  ): Promise<boolean> {
    const key = `workflow:${sessionId}:${workflowRunId}:${child?.childId ?? "run"}`;
    if (this.state.busy[key]) {
      return false;
    }
    this.setBusy(key, true);
    try {
      await this.client.workflow(sessionId, action, workflowRunId, child);
      return true;
    } catch (error) {
      // A stale attempt means the child moved on since this card last drew; the next view update redraws it.
      const stale = errorKind(error) === "stale_attempt";
      this.toast(stale ? "info" : "error", stale ? "That agent already moved on" : "The workflow did not take that", stale ? "Try again once the card updates." : errorMessage(error));
      return false;
    } finally {
      this.setBusy(key, false);
    }
  }

  /** One page of a tool's full stored output; the caller keeps asking from `offsetBytes + byteLen` until `eof`. */
  readOutput(sessionId: string, itemId: string, outputRef: string, offset = 0): Promise<OutputRange> {
    return this.client.readOutput(sessionId, itemId, outputRef, offset);
  }

  /** Hands a `!` command the host could not run to the agent, whose own shell tool can. */
  askToRun(sessionId: string, command: string): Promise<boolean> {
    // A fence longer than any run of backticks in the command, so the command cannot close its own block.
    const runs = command.match(/`+/g) ?? [];
    const fence = "`".repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
    // The failed `!` item says the environment is broken, which makes the agent refuse; tell it that its own shell is fine.
    const text =
      `Run this with your shell tool and show me the output:\n\n${fence}sh\n${command}\n${fence}\n\n` +
      "That failure came from Helicon's `!` path, not from your tools: your own shell works here.";
    return this.sendToThread(sessionId, text, {}, false);
  }

  /** Branches a thread into a new one and opens it. */
  async fork(sessionId: string): Promise<boolean> {
    const key = `fork:${sessionId}`;
    if (this.state.busy[key]) {
      return false;
    }
    this.setBusy(key, true);
    try {
      const session = await this.client.forkSession(sessionId);
      this.upsertSession(session);
      this.navigate({ kind: "thread", sessionId: session.sessionId });
      this.toast("success", "Forked into a new thread", "The original thread stays as it was.");
      return true;
    } catch (error) {
      this.toast(
        "error",
        "Could not fork the thread",
        errorKind(error) === "forkBoundaryInvalid" ? "Muse could not find a point in this thread to fork it at." : errorMessage(error),
      );
      return false;
    } finally {
      this.setBusy(key, false);
    }
  }

  /** True only when Muse took the compaction on: a refusal or a noop leaves the history exactly as it was. */
  async compact(sessionId: string): Promise<boolean> {
    try {
      const result = await this.client.compact(sessionId);
      if (result.noop) {
        const reason = result.reason === "no_compactable_history" ? "There is no earlier history to summarize." : result.reason;
        this.toast("info", "Nothing to compact yet", reason ? `${reason.charAt(0).toUpperCase()}${reason.slice(1).replace(/_/g, " ")}` : undefined);
        return false;
      }
      this.toast("info", "Compacting context", "Muse will summarize earlier turns to free up the context window.");
      return true;
    } catch (error) {
      this.toast("error", "Could not compact the context", errorMessage(error));
      return false;
    }
  }

  /**
   * For a thread whose history the provider will not take: summarize it, which leaves the unusable part
   * behind, then send the prompt again. The retry queues behind the compaction Muse runs as its own turn.
   */
  /**
   * For a thread whose stored reasoning cannot be replayed at all: start one beside it in the same project
   * and send the prompt there. Compacting keeps the recent turns as they are, so it cannot clear that.
   */
  async freshThread(
    sessionId: string,
    prompt: string | null,
    files: { attachments?: OutgoingAttachment[]; previews?: EchoAttachment[] } = {},
  ): Promise<boolean> {
    const cwd = this.state.sessions[sessionId]?.cwd ?? null;
    if (!cwd) {
      this.toast("error", "Could not start a new thread", "That thread's project is not known here.");
      return false;
    }
    // An image with no words of its own is still a question, so it goes too; with neither, there is
    // nothing to ask again and the new thread simply opens.
    const carrying = files.attachments?.length ?? 0;
    if (!prompt && carrying === 0) {
      this.newThread(cwd);
      return true;
    }
    const text = prompt ?? "";
    // Through the retry path, so a prompt entered as `/goal …` or a skill is expanded again rather than
    // reaching the model as the literal command the transcript showed.
    // The real result, so a prompt that did not go comes back to the composer instead of being lost.
    return this.startThread(cwd, text, (fresh) => this.retryTurn(fresh, text, files), files);
  }

  async compactAndRetry(
    sessionId: string,
    prompt: string | null,
    files: { attachments?: OutgoingAttachment[]; previews?: EchoAttachment[] } = {},
  ): Promise<void> {
    // Only a compaction Muse took on changes the history: after a refusal or a noop, the prompt would fail
    // exactly as before. The retry queues behind the compaction turn, which may not have reached us yet.
    if (!(await this.compact(sessionId)) || !prompt) {
      return;
    }
    await this.retryTurn(sessionId, prompt, { ...files, queue: true });
  }

  async openFolder(cwd: string, target: "files" | "editor"): Promise<void> {
    try {
      await this.client.openFolder(cwd, target);
    } catch (error) {
      this.toast("error", target === "editor" ? "Could not open VS Code" : "Could not open the folder", errorMessage(error));
    }
  }

  // ---------------------------------------------------------------- prefs and chrome

  setPrefs(patch: Partial<Prefs>): void {
    this.update((s) => ({ ...s, prefs: { ...s.prefs, ...patch } }));
    if (this.saveHandle === null) {
      this.saveHandle = this.platform.schedule(() => {
        this.saveHandle = null;
        this.platform.savePrefs(this.state.prefs);
      }, 400);
    }
  }

  markSeen(sessionId: string, force = false): void {
    const now = new Date(this.platform.now()).toISOString();
    const previous = this.state.prefs.lastSeen[sessionId];
    if (!force && previous && Date.parse(now) - Date.parse(previous) < 2000) {
      return;
    }
    this.setPrefs({ lastSeen: { ...this.state.prefs.lastSeen, [sessionId]: now } });
  }

  /**
   * Remembers whether a dock card is open, per thread. Without this the card is local state that dies with
   * the view, so leaving a thread and coming back reopens what the user had folded away.
   */
  setCardOpen(key: string, open: boolean): void {
    const collapsed = this.state.prefs.collapsedCards;
    if (open === !collapsed.includes(key)) {
      return;
    }
    this.setPrefs({ collapsedCards: open ? collapsed.filter((k) => k !== key) : [...collapsed, key] });
  }

  /** Closes a dock card for good, or brings it back. The oldest are forgotten past a few hundred threads. */
  setCardHidden(key: string, hidden: boolean): void {
    const current = this.state.prefs.hiddenCards;
    if (hidden === current.includes(key)) {
      return;
    }
    this.setPrefs({ hiddenCards: hidden ? [...current, key].slice(-300) : current.filter((k) => k !== key) });
  }

  /** Brings back every dock card closed in one thread. */
  showThreadCards(sessionId: string): void {
    const suffix = `:${sessionId}`;
    const current = this.state.prefs.hiddenCards;
    const kept = current.filter((k) => !k.endsWith(suffix));
    if (kept.length !== current.length) {
      this.setPrefs({ hiddenCards: kept });
    }
  }

  setGroupBy(groupBy: GroupBy): void {
    this.setPrefs({ groupBy });
  }

  setTheme(theme: ThemePref): void {
    this.setPrefs({ theme });
  }

  setCodeTheme(codeTheme: CodeTheme): void {
    this.setPrefs({ codeTheme });
  }

  setZoom(zoom: number): void {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(zoom * 100) / 100));
    this.setPrefs({ zoom: clamped });
  }

  zoomIn(): void {
    const current = this.state.prefs.zoom;
    this.setZoom(ZOOM_STEPS.find((step) => step > current + 1e-9) ?? ZOOM_MAX);
  }

  zoomOut(): void {
    const current = this.state.prefs.zoom;
    this.setZoom([...ZOOM_STEPS].reverse().find((step) => step < current - 1e-9) ?? ZOOM_MIN);
  }

  resetZoom(): void {
    this.setZoom(1);
  }

  toggleSidebar(): void {
    this.setPrefs({ sidebarCollapsed: !this.state.prefs.sidebarCollapsed });
  }

  // ---------------------------------------------------------------- files

  /** Shows or hides the file viewer beside threads; it keeps each thread's open files either way. */
  toggleFiles(open?: boolean): void {
    this.setPrefs({ filesOpen: open ?? !this.state.prefs.filesOpen });
  }

  setFilesWidth(width: number): void {
    this.setPrefs({ filesWidth: Math.round(Math.min(FILES_WIDTH_MAX, Math.max(FILES_WIDTH_MIN, width))) });
  }

  private patchPanel(sessionId: string, fn: (panel: FilePanel) => FilePanel): void {
    this.update((s) => {
      const current = s.filePanels[sessionId] ?? { tabs: [], active: null, tree: true, line: null };
      return { ...s, filePanels: { ...s.filePanels, [sessionId]: fn(current) } };
    });
  }

  /**
   * Opens a file in a thread's viewer, from the tree or from a path a reply named, and shows the viewer. A path with
   * a line (`app.ts:12`) scrolls there. Returns false when the thread's project is unknown.
   */
  openFile(sessionId: string, raw: string, line: LineRange | null = null): boolean {
    const cwd = this.state.sessions[sessionId]?.cwd;
    const target = cwd ? fileTarget(raw, cwd) : null;
    if (!cwd || !target || !target.path) {
      return false;
    }
    this.patchPanel(sessionId, (panel) => ({
      tabs: panel.tabs.includes(target.path) ? panel.tabs : [...panel.tabs, target.path],
      active: target.path,
      tree: false,
      line: line ?? target.line,
    }));
    if (!this.state.prefs.filesOpen) {
      this.setPrefs({ filesOpen: true });
    }
    return true;
  }

  showFileTree(sessionId: string, tree: boolean): void {
    this.patchPanel(sessionId, (panel) => ({ ...panel, tree: tree || panel.active === null }));
  }

  activateFile(sessionId: string, path: string): void {
    this.patchPanel(sessionId, (panel) => (panel.tabs.includes(path) ? { ...panel, active: path, tree: false, line: null } : panel));
  }

  /** Closes a tab, discarding its unsaved edit; the view asks first when there is one. */
  closeFile(sessionId: string, path: string): void {
    const cwd = this.state.sessions[sessionId]?.cwd;
    if (cwd) {
      this.setFileDraft(cwd, path, null);
    }
    this.patchPanel(sessionId, (panel) => {
      const index = panel.tabs.indexOf(path);
      const tabs = panel.tabs.filter((tab) => tab !== path);
      // The neighbour to the left takes over, as in an editor; closing the last tab shows the tree.
      const active = panel.active !== path ? panel.active : (tabs[Math.max(0, index - 1)] ?? null);
      return { tabs, active, tree: active === null ? true : panel.tree, line: panel.active === path ? null : panel.line };
    });
  }

  /** Keeps an unsaved edit across tab switches; null drops it. */
  setFileDraft(cwd: string, path: string, content: string | null, baseMtimeMs: number | null = null): void {
    const key = fileKey(cwd, path);
    this.update((s) => {
      const fileDrafts = { ...s.fileDrafts };
      if (content === null) {
        delete fileDrafts[key];
      } else {
        fileDrafts[key] = { content, baseMtimeMs: fileDrafts[key]?.baseMtimeMs ?? baseMtimeMs };
      }
      return { ...s, fileDrafts };
    });
  }

  /**
   * Saves a file's unsaved edit. When the file changed on disk since it was opened, nothing is written and the user
   * chooses: the toast's action overwrites, or reloading the file shows the other change. Returns the new write time.
   */
  async saveFile(cwd: string, path: string, overwrite = false): Promise<number | null> {
    const key = fileKey(cwd, path);
    const draft = this.state.fileDrafts[key];
    if (!draft || this.state.busy[`save:${key}`]) {
      return null;
    }
    this.setBusy(`save:${key}`, true);
    try {
      const saved = await this.client.writeFile(cwd, path, draft.content, overwrite ? null : draft.baseMtimeMs);
      // Only a draft still holding what was sent is done; typing during the save keeps the newer text as unsaved.
      this.update((s) => {
        const fileDrafts = { ...s.fileDrafts };
        if (fileDrafts[key]?.content === draft.content) {
          delete fileDrafts[key];
        } else if (fileDrafts[key]) {
          fileDrafts[key] = { ...fileDrafts[key], baseMtimeMs: saved.mtimeMs };
        }
        return { ...s, fileDrafts, fileVersions: { ...s.fileVersions, [key]: (s.fileVersions[key] ?? 0) + 1 } };
      });
      return saved.mtimeMs;
    } catch (error) {
      if (errorKind(error) === "fileChanged") {
        this.toast("error", "This file changed on disk", "Something else saved it since you opened it. Reload to see that change, or overwrite it with yours.", {
          label: "Overwrite",
          run: () => void this.saveFile(cwd, path, true),
        });
      } else {
        this.toast("error", "Could not save the file", errorMessage(error));
      }
      return null;
    } finally {
      this.setBusy(`save:${key}`, false);
    }
  }

  toggleTreeFolder(cwd: string, path: string): void {
    this.update((s) => {
      const open = s.fileTreeOpen[cwd] ?? [];
      const next = open.includes(path) ? open.filter((p) => p !== path) : [...open, path];
      return { ...s, fileTreeOpen: { ...s.fileTreeOpen, [cwd]: next } };
    });
  }

  listFiles(cwd: string, path: string) {
    return this.client.listFiles(cwd, path);
  }

  readFile(cwd: string, path: string) {
    return this.client.readFile(cwd, path);
  }

  searchFiles(cwd: string, query: string) {
    return this.client.searchFiles(cwd, query);
  }

  fileUrl(cwd: string, path: string): string {
    return this.client.fileUrl(cwd, path);
  }

  async openFileExternally(cwd: string, path: string): Promise<void> {
    try {
      await this.client.openFileExternally(cwd, path);
    } catch (error) {
      this.toast("error", "Could not open the file", errorMessage(error));
    }
  }

  setSidebarWidth(width: number): void {
    this.setPrefs({ sidebarWidth: Math.round(Math.min(480, Math.max(220, width))) });
  }

  toggleProjectCollapsed(cwd: string): void {
    const collapsed = this.state.prefs.collapsedProjects;
    this.setPrefs({
      collapsedProjects: collapsed.includes(cwd) ? collapsed.filter((c) => c !== cwd) : [...collapsed, cwd],
    });
  }

  setPaletteOpen(open: boolean): void {
    this.update((s) => (s.paletteOpen === open ? s : { ...s, paletteOpen: open }));
  }

  setAddProjectOpen(open: boolean): void {
    this.update((s) => (s.addProjectOpen === open ? s : { ...s, addProjectOpen: open }));
  }

  toast(tone: Toast["tone"], title: string, detail?: string, action?: Toast["action"]): void {
    this.toastSeq += 1;
    const id = this.toastSeq;
    this.update((s) => ({ ...s, toasts: [...s.toasts.slice(-3), { id, tone, title, detail, action }] }));
    this.platform.schedule(() => this.dismissToast(id), TOAST_MS[tone]);
  }

  dismissToast(id: number): void {
    this.update((s) => (s.toasts.some((t) => t.id === id) ? { ...s, toasts: s.toasts.filter((t) => t.id !== id) } : s));
  }

  // ---------------------------------------------------------------- helpers

  private setBusy(key: string, on: boolean): void {
    this.update((s) => {
      if (Boolean(s.busy[key]) === on) {
        return s;
      }
      const busy = { ...s.busy };
      if (on) {
        busy[key] = true;
      } else {
        delete busy[key];
      }
      return { ...s, busy };
    });
  }

  private setThread(sessionId: string, thread: ThreadState): void {
    this.update((s) => ({ ...s, threads: { ...s.threads, [sessionId]: thread } }));
  }

  private patchFold(sessionId: string, fn: (fold: ThreadFold) => ThreadFold): void {
    this.update((s) => {
      const thread = s.threads[sessionId];
      if (!thread) {
        return s;
      }
      const fold = fn(thread.fold);
      return fold === thread.fold ? s : { ...s, threads: { ...s.threads, [sessionId]: { ...thread, fold } } };
    });
  }

  private patchMeta(sessionId: string, patch: Partial<ThreadFold["meta"]>): void {
    this.patchFold(sessionId, (f) => ({ ...f, meta: { ...f.meta, ...patch } }));
  }

  private upsertSession(session: SessionSummary): void {
    this.update((s) => ({ ...s, sessions: { ...s.sessions, [session.sessionId]: session } }));
  }
}
