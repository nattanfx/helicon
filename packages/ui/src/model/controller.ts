import { errorKind, errorMessage, type HeliconClient } from "../client.js";
import { userFacingError } from "./errors.js";
import { olderThan } from "./archived.js";
import { defaultSettingsSection, isSettingsSectionId } from "./settingsSections.js";
import type {
  ApprovalMode,
  ApprovalRequest,
  AttachmentView,
  FailureEntry,
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
import {
  CONTRIBUTOR_NOTICE,
  describeTool,
  displayTitle,
  modelDisplayName,
  stripAttachmentMentions,
  stripImageMarkers,
} from "./format.js";
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
  abandonTurn,
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
  type FileDraft,
  type FilePanel,
  type GroupBy,
  type Prefs,
  type Route,
  type SkillsState,
  type ThemePref,
  type ThreadState,
  type Toast,
} from "./store.js";
import {
  FILE_DRAFTS_KEY,
  FILE_DRAFTS_LEAVE_MESSAGE,
  FILE_DRAFTS_LEAVE_UNSAFE_MESSAGE,
  FILE_DRAFTS_LIMIT_MESSAGE,
  oversizedFileDraftKeys,
  parseFileDrafts,
  serializeFileDrafts,
} from "./fileDrafts.js";
import type { AppIdentity } from "./identity.js";
import { NotificationManager, type Notifier, type NotifyPermission, type NotifyTrace } from "./notify.js";
import { playNotifySound } from "./notifySound.js";
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
  /** Cópias recuperáveis de edições de arquivo, fora das prefs. Ausente: começa vazio. */
  loadFileDrafts?(): unknown;
  saveFileDrafts?(drafts: Record<string, FileDraft>): void;
  /** True = pode sair. Usado no fechamento da janela do desktop, não no `beforeunload` do navegador. */
  confirmLeave?(message: string): boolean;
  /**
   * `dialog: true` no fechar do desktop (pode perguntar). `dialog: false` no unload do navegador
   * (só o aviso genérico). True = deixar fechar.
   */
  onBeforeClose?(handler: (options: { dialog: boolean }) => boolean): () => void;
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
    loadFileDrafts: () => {
      try {
        const raw = window.localStorage.getItem(FILE_DRAFTS_KEY);
        return raw ? (JSON.parse(raw) as unknown) : null;
      } catch {
        return null;
      }
    },
    saveFileDrafts: (drafts) => {
      const payload = serializeFileDrafts(drafts);
      if (Object.keys(payload).length === 0) {
        window.localStorage.removeItem(FILE_DRAFTS_KEY);
      } else {
        window.localStorage.setItem(FILE_DRAFTS_KEY, JSON.stringify(payload));
      }
    },
    confirmLeave: (message) => (typeof window.confirm === "function" ? window.confirm(message) : true),
    onBeforeClose: (handler) => {
      const onUnload = (event: BeforeUnloadEvent) => {
        if (!handler({ dialog: false })) {
          event.preventDefault();
          event.returnValue = "";
        }
      };
      window.addEventListener("beforeunload", onUnload);
      return () => window.removeEventListener("beforeunload", onUnload);
    },
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
    stalled: false,
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
/** How often loaded threads are checked for a stream that went silent. */
const STALE_CHECK_MS = 30_000;
/** A fold still showing a turn the server finished this long ago missed its ending: reload it. */
const DIVERGED_GRACE_MS = 30_000;
/** Both sides agree a turn is running, but nothing landed for this long: reload it. */
const QUIET_TURN_MS = 90_000;
/**
 * Reloads one stuck turn is worth. A turn whose ending is missing from history too, rather than
 * just from the stream, converges on nothing: without a cap the thread would refetch its whole
 * history every grace period for as long as it stays open, which is worst on the very large
 * sessions this watchdog exists for.
 */
const STALE_RELOAD_LIMIT = 2;

/** Why a loaded thread needs reloading from history: its ending never landed, or its stream went quiet mid-turn. */
export type StaleThreadReason = "diverged" | "quiet";

/**
 * Whether a loaded thread is stale enough to reload. A fold still showing a turn the server has
 * finished is a missed ending (#32: the view froze while the backend kept working); a turn both
 * sides agree is running but silent is a dead stream. Either way history converges the view, so a
 * reload is what a restart would have done, without losing the rest of the app.
 */
export function staleThreadReason(
  foldActiveTurnId: string | null,
  liveActiveTurnId: string | null | undefined,
  lastAppliedAt: number | null,
  now: number,
): StaleThreadReason | null {
  if (!foldActiveTurnId || lastAppliedAt === null) {
    return null;
  }
  if (!liveActiveTurnId) {
    return now - lastAppliedAt > DIVERGED_GRACE_MS ? "diverged" : null;
  }
  return now - lastAppliedAt > QUIET_TURN_MS ? "quiet" : null;
}

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
  /** Carregamentos simultâneos da mesma conversa compartilham a leitura e o buffer. */
  private readonly inflightLoads = new Map<string, Promise<void>>();
  /** Chaves de entregas de prompt ainda esperando o servidor, para um rascunho enviado duas vezes virar uma. */
  private readonly inflightSends = new Set<string>();
  private readonly disposers: (() => void)[] = [];
  private flushHandle: unknown = null;
  private refreshHandle: unknown = null;
  private saveHandle: unknown = null;
  private draftSaveHandle: unknown = null;
  private draftsPersistFailed = false;
  private staleHandle: unknown = null;
  private disposed = false;
  /** When stream events were last applied per session, so a thread that went silent can be noticed. */
  private readonly appliedAt = new Map<string, number>();
  /** Reloads already spent on a thread's current stuck turn, so a hopeless one is not refetched forever. */
  private readonly staleReloads = new Map<string, { turnId: string; count: number }>();
  /** Turno que o usuário abandonou por conversa, para um recarregamento não ressuscitar o que o host nunca fechou. */
  // IDs are unique: keep explicit abandonments for this controller's lifetime. Neither a
  // different active turn nor a truncated/older snapshot proves that replay is over.
  private readonly abandonedTurns = new Map<string, Set<string>>();
  private refreshing: Promise<void> | null = null;
  private refreshQueued = false;
  private toastSeq = 0;
  /** Incrementada a cada pedido de configuração de títulos, para aplicar apenas a resposta ou reversão mais recente. */
  private titleSettingsRev = 0;
  /** Incrementada a cada pedido de configuração da sandbox, para aplicar apenas a resposta ou reversão mais recente. */
  private sandboxSettingsRev = 0;
  /** PATCHs da sandbox andam em fila para que viradas opostas rápidas persistam em ordem. */
  private sandboxSettingsChain: Promise<void> = Promise.resolve();
  /** Incrementada a cada pedido de YOLO, para aplicar apenas a resposta ou reversão mais recente. */
  private yoloSettingsRev = 0;
  private archivedRev = 0;
  /** PATCHs do YOLO andam em fila para que viradas opostas rápidas persistam em ordem. */
  private yoloSettingsChain: Promise<void> = Promise.resolve();
  /** Modos de aprovação de antes de ligar o YOLO, restaurados ao desligá-lo. Null quando nunca foi ligado aqui. */
  private preYolo: { defaultMode: ApprovalMode; threads: Record<string, ApprovalMode | null> } | null = null;
  /** A rota principal para a qual o Voltar sai das páginas de configurações/uso; limpa ao voltar para uma rota principal. */
  private returnRoute: Route | null = null;

  private updates: UpdateManager | null = null;
  private notifications: NotificationManager | null = null;
  /** Guardado junto com o manager, porque pedir permissão é trabalho do shell, não do manager. */
  private notifier: Notifier | null = null;

  constructor(
    readonly client: HeliconClient,
    private readonly platform: Platform = browserPlatform(),
  ) {
    const fallback = defaultPrefs(new Date(platform.now()).toISOString());
    const state = initialState(revivePrefs(platform.loadPrefs(), fallback));
    this.store = new Store({ ...state, fileDrafts: parseFileDrafts(platform.loadFileDrafts?.() ?? null) });
    // Leva a foto pré-YOLO por cima de um recarregar: o campo em si é por execução, mas as prefs não.
    this.preYolo = this.state.prefs.preYolo;
  }

  private get state(): AppState {
    return this.store.get();
  }

  private update(fn: (state: AppState) => AppState): void {
    this.store.set(fn);
  }

  start(): () => void {
    this.disposed = false;
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
    if (this.platform.onBeforeClose) {
      this.disposers.push(this.platform.onBeforeClose((options) => this.allowClose(options.dialog)));
    }
    if (Object.keys(this.state.fileDrafts).length > 0) {
      this.toast("info", "Edições de arquivo não gravadas", "Abra o arquivo no visualizador para continuar. Nada foi escrito no disco.");
    }
    this.scheduleStaleCheck();
    void this.ensureNotifyPermission();
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
      () => ({
        enabled: this.state.prefs.notifications,
        focused: this.platform.focused(),
        sound: this.state.prefs.notificationSound,
        balloonForeground: this.state.prefs.notificationsForeground,
        soundForeground: this.state.prefs.notificationSoundForeground,
      }),
      () => this.platform.now(),
      async () => {
        // No desktop o som é o do sistema; o bipe sintetizado só aparece onde não há som nativo.
        if (notifier.systemSound) {
          try {
            await notifier.systemSound();
            return { scheduled: true, audioState: "sistema" };
          } catch {
            /* cai para o bipe */
          }
        }
        let audioState = "desconhecido";
        const scheduled = playNotifySound(undefined, (info) => {
          audioState = info.state;
        });
        return { scheduled, audioState };
      },
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

  /** Tentativas recentes de aviso, para o bloco de diagnóstico temporário das Configurações. */
  notificationTrace(): NotifyTrace[] {
    return this.notifications?.recent() ?? [];
  }

  /** O que o sistema diz sobre os avisos, sem perguntar: as Configurações mostram com honestidade. */
  async notifyPermission(): Promise<NotifyPermission> {
    try {
      return (await this.notifier?.permission()) ?? "denied";
    } catch {
      return "denied";
    }
  }

  /** Prova de cada canal a pedido: os botões de teste das Configurações passam por aqui. */
  async testNotify(channel: "balloon" | "sound" | "both"): Promise<void> {
    const manager = this.notifications;
    if (!manager) {
      this.toast("info", "Sem aviso", "Este shell não mostra notificações de sistema.");
      return;
    }
    await manager.preview(channel);
    if (channel !== "sound" && (await this.notifyPermission()) !== "granted") {
      this.toast("info", "Balão sem permissão", "O sistema não autorizou os avisos; o teste ficou registrado no diagnóstico.");
    }
  }

  /**
   * Uma vez por abertura, no desktop com o balão ligado e ainda sem permissão: pede, para a
   * abertura fria não calar todo balão. Nunca no navegador, que exige gesto para conceder.
   */
  private async ensureNotifyPermission(): Promise<void> {
    try {
      if (!this.state.prefs.notifications || this.notifier?.startupRequest !== true) {
        return;
      }
      if ((await this.notifier.permission()) === "granted") {
        return;
      }
      await this.notifier.request();
    } catch {
      /* permissão é melhor esforço na abertura; as Configurações mostram como pedir */
    }
  }

  /** Versão e canal informados pelo shell, sem consultar um atualizador. */
  attachIdentity(identity: AppIdentity): void {
    this.update((s) => ({ ...s, identity }));
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
    this.disposed = true;
    for (const dispose of this.disposers.splice(0)) {
      dispose();
    }
    for (const handle of [this.flushHandle, this.refreshHandle, this.saveHandle, this.draftSaveHandle, this.staleHandle]) {
      if (handle !== null) {
        this.platform.cancel(handle);
      }
    }
    this.staleHandle = null;
    this.draftSaveHandle = null;
    this.persistFileDrafts();
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
      void this.loadTitleSettings();
      void this.loadSandboxSettings();
      void this.loadYoloSettings();
      void this.loadPlanUsage();
    } catch (error) {
      this.update((s) => ({ ...s, boot: "error", bootError: userFacingError(error) }));
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
      await Promise.all([this.refresh(), this.loadPlanUsage()]);
      if (!silent) {
        this.toast("success", "Conversas atualizadas");
      }
    } catch (error) {
      if (!silent) {
        this.toast("error", "Não foi possível atualizar as conversas a partir do Muse", userFacingError(error));
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

  private async loadTitleSettings(): Promise<void> {
    const rev = ++this.titleSettingsRev;
    try {
      const titleSettings = await this.client.getTitleSettings();
      if (rev === this.titleSettingsRev) {
        this.update((s) => ({ ...s, titleSettings }));
      }
    } catch {
      /* abrir Configurações tenta carregar novamente */
    }
  }

  private async loadSandboxSettings(): Promise<void> {
    const rev = ++this.sandboxSettingsRev;
    try {
      const sandboxSettings = await this.client.getSandboxSettings();
      if (rev === this.sandboxSettingsRev) {
        this.update((s) => ({ ...s, sandboxSettings }));
      }
    } catch {
      /* abrir Configurações tenta carregar novamente */
    }
  }

  private async loadYoloSettings(): Promise<void> {
    const rev = ++this.yoloSettingsRev;
    // Guardado antes da atualização sobrescrevê-lo: outro app pode desligar o YOLO sem este nunca
    // chamar `setYoloEnabled`, e essa virada só aparece comparando o que este carregamento substitui.
    const wasEnabled = this.state.yoloSettings?.enabled === true;
    try {
      const yoloSettings = await this.client.getYoloSettings();
      if (rev === this.yoloSettingsRev) {
        this.update((s) => ({ ...s, yoloSettings }));
        if (yoloSettings.enabled) {
          // A inicialização traz conversas e configurações em qualquer ordem; uma conversa que carregou antes entra no YOLO mesmo assim.
          for (const sessionId of Object.keys(this.state.threads)) {
            this.convergeThread(sessionId);
          }
        } else if (wasEnabled) {
          // Outro app desligou o YOLO. Este app também precisa parar de aprovar sozinho, tenha ou
          // não uma foto local: o mesmo caminho de restauração que o `setYoloEnabled` usa numa virada
          // de verdade. O `applyYoloApprovals(false)` já consome `this.preYolo` quando há um, e cai
          // para perguntar-antes quando não há, então chamar aqui é seguro de todo jeito.
          this.applyYoloApprovals(false);
        }
      }
    } catch {
      /* abrir Configurações tenta carregar novamente */
    }
  }

  /**
   * Traz uma conversa aberta para o acesso total do YOLO, quando o YOLO está ligado e a conversa ainda
   * não está lá. O modo da própria conversa continuaria perguntando, respondido uma aprovação por vez
   * pelo bypass implícito em vez de nunca perguntar.
   */
  private convergeThread(sessionId: string): void {
    if (this.state.yoloSettings?.enabled !== true) {
      return;
    }
    const thread = this.state.threads[sessionId];
    const mode = thread?.fold.meta.approvalMode ?? null;
    if (thread && !thread.readOnly && mode !== "allowAll") {
      this.patchMeta(sessionId, { approvalMode: "allowAll" });
      void this.pushThreadModes({ [sessionId]: "allowAll" }, { [sessionId]: mode }, "perguntando antes");
    }
  }

  // ---------------------------------------------------------------- routing

  navigate(route: Route): void {
    this.applyRoute(route, true);
  }

  /** Sai das páginas de configurações/uso para onde o usuário estava antes de abri-las. */
  goBack(): void {
    this.navigate(this.returnRoute ?? { kind: "home" });
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
    const overlay = route.kind === "usage" || route.kind === "settings";
    const wasOverlay = previous.kind === "usage" || previous.kind === "settings";
    if (overlay) {
      if (!wasOverlay) {
        this.returnRoute = previous;
      }
    } else {
      this.returnRoute = null;
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
    } else if (route.kind === "settings") {
      this.update((s) => (s.settingsSection === null ? s : { ...s, settingsSection: null }));
      void this.loadArchived();
      if (this.state.titleSettings === null) {
        void this.loadTitleSettings();
      }
      if (this.state.sandboxSettings === null) {
        void this.loadSandboxSettings();
      }
      if (this.state.yoloSettings === null) {
        void this.loadYoloSettings();
      }
    }
  }

  /** Uma tentativa manual renova o limite de recuperação automática desse turno. */
  retryStalledThread(sessionId: string): Promise<void> {
    this.staleReloads.delete(sessionId);
    return this.loadThread(sessionId);
  }

  /**
   * Desiste do turno que o host nunca fecha: pede o cancelamento como melhor esforço e declara o
   * turno encerrado localmente, para a conversa sair do modo fila. A fila atrás dele é preservada —
   * se o host responder ao cancelamento, ela anda; se não, cada item continua removível.
   */
  async abandonStalledTurn(sessionId: string): Promise<void> {
    const thread = this.state.threads[sessionId];
    const turnId = thread?.fold.activeTurnId;
    if (!thread || !turnId) {
      return;
    }
    const abandoned = this.abandonedTurns.get(sessionId) ?? new Set<string>();
    abandoned.add(turnId);
    this.abandonedTurns.set(sessionId, abandoned);
    this.staleReloads.delete(sessionId);
    // Commit locally before waiting: the host may finish this turn and start queued work
    // while cancel is in flight. Never overwrite those events with the captured thread.
    this.setThread(sessionId, { ...thread, fold: abandonTurn(thread.fold, turnId), stalled: false });
    let cancelled = true;
    try {
      await this.client.cancelTurn(sessionId, turnId);
    } catch {
      /* host morto ou inalcançável: o abandono local ainda livra a conversa */
      cancelled = false;
    }
    if (cancelled) {
      this.toast("success", "Turno abandonado", "O turno foi encerrado localmente e o Muse recebeu o pedido de cancelamento. Mensagens da fila podem continuar.");
    } else {
      this.toast("info", "Turno abandonado localmente", "O Muse não respondeu; mensagens novas podem enfileirar até ele voltar.");
    }
  }

  /**
   * Reinicia os servidores Muse a pedido, para recuperar de um host envenenado sem fechar o app:
   * os hosts vivos fecham e a próxima mensagem os recria. Turnos em andamento são interrompidos.
   * O evento de reinício anuncia o sucesso; aqui só a falha ao pedir avisa.
   */
  async restartMuseHosts(): Promise<void> {
    try {
      await this.client.restartHosts();
    } catch (error) {
      this.toast("error", "Não foi possível reiniciar o Muse", userFacingError(error));
    }
  }

  async loadThread(sessionId: string): Promise<void> {
    // A second load while one is in flight would orphan the first load's buffer: every event that
    // streamed into it is dropped, and the thread never shows them (#32: a frozen view on a thread
    // whose backend kept working). Coalescing waits on the one buffer instead, so nothing is lost.
    const inflight = this.inflightLoads.get(sessionId);
    if (inflight) {
      return inflight;
    }
    const run = this.reloadThread(sessionId).finally(() => {
      if (this.inflightLoads.get(sessionId) === run) {
        this.inflightLoads.delete(sessionId);
      }
    });
    this.inflightLoads.set(sessionId, run);
    return run;
  }

  private async reloadThread(sessionId: string): Promise<void> {
    const existing = this.state.threads[sessionId];
    this.loading.set(sessionId, []);
    this.setThread(sessionId, { ...(existing ?? blankThread()), load: "loading", error: null });
    try {
      const load = await this.client.loadTranscript(sessionId);
      const buffered = this.loading.get(sessionId) ?? [];
      this.loading.delete(sessionId);
      let fold = foldFromLoad(load, existing?.fold ?? null);
      // Restore only explicitly abandoned IDs, including ones missing from truncated history.
      // This also guards subsequent turn/started replays while leaving new IDs untouched.
      // Apply buffered host endings afterwards so real terminal details always win.
      for (const turnId of this.abandonedTurns.get(sessionId) ?? []) {
        if (!fold.turns[turnId]?.terminal) {
          fold = applyEvents(fold, [{ method: "turn/completed", params: { turnId, terminal: "cancelled" } }]);
        }
      }
      fold = applyEvents(fold, buffered);
      this.appliedAt.set(sessionId, this.platform.now());
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
            // Sem eventos novos, só manter o aviso se ainda for o mesmo turno.
            stalled: Boolean(existing?.stalled && fold.activeTurnId &&
              fold.activeTurnId === existing.fold.activeTurnId && buffered.length === 0),
          },
        },
        sessions: load.session ? { ...s.sessions, [sessionId]: load.session } : s.sessions,
      }));
      // O que já estava esperando quando a conversa abriu conta também, não só o que chega depois.
      this.autoAllow([sessionId]);
      this.convergeThread(sessionId);
    } catch (error) {
      this.loading.delete(sessionId);
      this.setThread(sessionId, {
        ...(this.state.threads[sessionId] ?? blankThread()),
        load: "error",
        error: userFacingError(error),
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
        this.announce(event.sessionId, displayTitle(known), before, event.live);
        // A única notícia que temos sobre uma conversa que este app nunca abriu: ela está esperando alguém.
        if (this.bypassArmed(event.sessionId) && (event.live?.pendingApprovals ?? 0) > 0) {
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
        } else if (event.state === "restarted") {
          this.update((s) => ({ ...s, hostError: null }));
          this.toast("info", "Servidores Muse reiniciados", event.message);
          // Um reinício segue qualquer PATCH de configuração, inclusive de outro app. Recarrega os dois
          // para a postura deste app (e de qualquer conversa dele) acompanhar o que valeu de fato.
          void this.loadYoloSettings();
          void this.loadSandboxSettings();
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
    const appliedNow = this.platform.now();
    for (const [id] of batches) {
      this.appliedAt.set(id, appliedNow);
    }

    this.update((s) => {
      const threads = { ...s.threads };
      for (const [id, events] of batches) {
        const thread = threads[id];
        if (thread) {
          threads[id] = { ...thread, fold: applyEvents(thread.fold, events), stalled: false };
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

  private scheduleStaleCheck(): void {
    if (this.staleHandle !== null || this.disposed) {
      return;
    }
    this.staleHandle = this.platform.schedule(() => {
      this.staleHandle = null;
      this.checkStaleThreads();
    }, STALE_CHECK_MS);
  }

  /**
   * Reloads loaded threads whose stream went silent: a missed ending or a dead stream looks exactly
   * like a frozen view with a spinner (#32), and history converges it the way a restart would. A
   * reload stamps the thread fresh, so a thread that stays silent is retried at most once per grace
   * period — and a reload can never loop with itself, since a thread already loading is skipped.
   */
  private checkStaleThreads(): void {
    if (this.disposed) {
      return;
    }
    this.scheduleStaleCheck();
    const now = this.platform.now();
    for (const [id, thread] of Object.entries(this.state.threads)) {
      if (thread.load !== "ready" || this.loading.has(id)) {
        continue;
      }
      const turnId = thread.fold.activeTurnId;
      if (!turnId) {
        this.staleReloads.delete(id);
        continue;
      }
      const applied = this.appliedAt.get(id) ?? null;
      if (applied === null) {
        continue;
      }
      // A turn waiting on the user is quiet because it should be, not because the stream died (#54).
      // Reloading it sends session/resume into a live session mid-question, which is how a turn that
      // was fine came to be reported failed. Treat the wait as activity, so the grace period starts
      // over once the answer goes in rather than firing the moment it does.
      const live = this.state.sessions[id]?.live;
      const waiting =
        Object.keys(thread.fold.userInputs).length > 0 ||
        Object.keys(thread.fold.approvals).length > 0 ||
        (live?.pendingInputs ?? 0) > 0 ||
        (live?.pendingApprovals ?? 0) > 0;
      if (waiting) {
        this.appliedAt.set(id, now);
        this.staleReloads.delete(id);
        if (thread.stalled) {
          this.setThread(id, { ...thread, stalled: false });
        }
        continue;
      }
      if (staleThreadReason(turnId, live?.activeTurnId ?? null, applied, now) === null) {
        continue;
      }
      const spent = this.staleReloads.get(id);
      const count = spent && spent.turnId === turnId ? spent.count : 0;
      if (count >= STALE_RELOAD_LIMIT) {
        if (!thread.stalled) {
          this.setThread(id, { ...thread, stalled: true });
        }
        continue;
      }
      this.staleReloads.set(id, { turnId, count: count + 1 });
      void this.loadThread(id);
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
      // O YOLO é dono da postura de cada conversa enquanto ligado, nova ou velha: um padrão velho de antes
      // dele ligar nunca pode semear uma conversa que pergunta quando o resto do app não pergunta.
      const approvalMode: ApprovalMode = this.state.yoloSettings?.enabled === true ? "allowAll" : defaultMode;
      const session = await this.client.startSession(cwd, {
        approvalMode,
        modelId: defaultModelId ?? undefined,
      });
      const base = emptyFold();
      const fold: ThreadFold = {
        ...base,
        meta: { ...base.meta, modelId: session.modelId ?? defaultModelId, approvalMode },
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
            stalled: false,
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
      this.toast("error", "Não foi possível começar uma conversa", userFacingError(error));
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
    // E o servidor pode ver um turno ativo que o fold não vê: uma falha espúria limpa o id local enquanto
    // o host ainda trabalha. Sem esse id, a próxima mensagem iria como livre para uma sessão ocupada.
    const liveActiveTurnId = this.state.sessions[sessionId]?.live?.activeTurnId ?? null;
    const running = thread.fold.activeTurnId !== null || liveActiveTurnId !== null || options.queue === true;
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
      this.toast("error", "Mensagem não enviada", userFacingError(error));
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
      this.toast("error", "Não foi possível parar a mensagem", userFacingError(error));
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
      this.toast("info", "Essa mensagem já começou", userFacingError(error));
    }
  }

  /** Limpa o aviso de uma mensagem falha, para quando o usuário já agiu sobre ele e ele só está ocupando espaço. */
  /**
   * Fecha o aviso de uma mensagem falha. Guardado nas prefs além do fold: o fold é reconstruído do histórico do Muse
   * sempre que a conversa recarrega, e o aviso voltaria com ele. `transient` esconde só nesta sessão: uma recarga
   * reavalia — o certo após verificar que o turno está vivo, pois uma morte posterior real deve voltar a aparecer.
   */
  dismissTurnError(sessionId: string, turnId: string | null, options: { transient?: boolean } = {}): void {
    if (!turnId) {
      return;
    }
    if (!options.transient) {
      const key = `${sessionId}:${turnId}`;
      const dismissed = this.state.prefs.dismissedTurnErrors;
      if (!dismissed.includes(key)) {
        this.setPrefs({ dismissedTurnErrors: [...dismissed, key].slice(-300) });
      }
    }
    this.patchFold(sessionId, (f) => {
      const info = f.turns[turnId];
      if (!info || (!options.transient && !info.error)) {
        return f;
      }
      if (options.transient) {
        return { ...f, turns: { ...f.turns, [turnId]: { ...info, dismissed: true } } };
      }
      const { error: _error, ...rest } = info;
      return { ...f, turns: { ...f.turns, [turnId]: { ...rest, dismissed: true } } };
    });
  }

  /**
   * Verdadeiro quando o turno está vivo agora: ativo no fold ou no retrato fresco do servidor. Uma falha sem
   * detalhe sobre um turno vivo é retrato obsoleto, não morte — verificar antes de oferecer repetição ou restart.
   */
  async verifyTurnAlive(sessionId: string, turnId: string | null): Promise<boolean> {
    if (!turnId) {
      return false;
    }
    if (this.state.threads[sessionId]?.fold.activeTurnId === turnId) {
      return true;
    }
    await this.refresh();
    return this.state.sessions[sessionId]?.live?.activeTurnId === turnId;
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
    // O texto gravado traz o que o host/servidor anexou ([Image #n], menções de anexo), e os arquivos vão junto de
    // novo: reenviar como está duplicaria os sufixos. A repetição manda o texto digitado; cada lado anexa outra vez.
    const clean = stripAttachmentMentions(stripImageMarkers(prompt));
    // Uma mensagem começada por `/plan …` ou `/init` mostra o comando, então repetir roda o comando de novo.
    const parsed = parseSlash(clean);
    const cwd = this.state.sessions[sessionId]?.cwd ?? null;
    if (parsed && cwd) {
      await this.loadSkills(cwd);
      const skills = this.state.skills[cwd]?.skills ?? [];
      if (resolveSlash(parsed, slashCommands(skills, { inThread: true }), skills).kind !== "unknown") {
        return this.runSlash(clean, parsed, delivery);
      }
    }
    return this.sendToThread(sessionId, clean, delivery, false);
  }

  // ---------------------------------------------------------------- approvals and questions

  /** Verdadeiro quando esta conversa responde às próprias aprovações: pelo próprio armamento, pelo interruptor geral ou pelo YOLO. */
  bypassArmed(sessionId: string): boolean {
    return this.state.bypassAll || this.state.yoloSettings?.enabled === true || this.state.bypassThreads.includes(sessionId);
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
    // Uma conversa armada responde às próprias aprovações, então "precisa de você" seria mentira contada um
    // segundo antes do bypass chegar. Mas um pedido só-de-regra não oferece nada para o bypass clicar, então
    // fica para o usuário exatamente como o `autoAllow` o deixa: esse ainda precisa do anúncio.
    if (
      (after.pendingApprovals ?? 0) > 0 &&
      (before?.pendingApprovals ?? 0) === 0 &&
      (!this.bypassArmed(sessionId) || this.hasUnanswerableApproval(sessionId))
    ) {
      void manager.announce({ kind: "approval", sessionId, thread });
    }
    if ((after.pendingInputs ?? 0) > 0 && (before?.pendingInputs ?? 0) === 0) {
      void manager.announce({ kind: "question", sessionId, thread });
    }
    if (after.activeTurnId === null && before?.activeTurnId != null && after.lastTerminal) {
      const failed = Boolean(after.lastError) || after.lastTerminal === "failed";
      void manager.announce({ kind: "finished", sessionId, thread, failed, turnId: before?.activeTurnId ?? null });
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

  /**
   * Verdadeiro quando uma aprovação pendente conhecida nesta conversa não tem oferta simples de permitir para o
   * `autoAllow` aceitar, só prévia de regra ou nada. O `announce` usa isto para avisar mesmo assim de um pedido
   * que um bypass armado vai deixar parado, usando o mesmo predicado que o `autoAllow` responde.
   */
  private hasUnanswerableApproval(sessionId: string): boolean {
    const thread = this.state.threads[sessionId];
    if (!thread) {
      return false;
    }
    return Object.values(thread.fold.approvals).some((request) => this.allowOnce(request) === null);
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
        this.toast("error", "Decisão não enviada", userFacingError(error));
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
        this.toast("error", failure, userFacingError(error));
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
      this.toast("info", "Modelo de contribuidor selecionado", CONTRIBUTOR_NOTICE);
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
      this.toast("error", "Não foi possível trocar de modelo", userFacingError(error));
    }
  }

  async setMode(mode: ApprovalMode): Promise<void> {
    // O menu desativa seus modos sob o YOLO, mas o `/permissions` ainda chega aqui. Recusar é melhor
    // que largar o YOLO em silêncio: um comando de conversa não pode virar uma postura geral por trás de um reinício.
    if (this.state.yoloSettings?.enabled === true) {
      this.toast("info", "O YOLO está ligado", "Desligue o YOLO para mudar as permissões.");
      return;
    }
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
      this.toast("error", "Não foi possível alterar as permissões", userFacingError(error));
    }
  }

  async setTitleEnabled(enabled: boolean): Promise<void> {
    const previous = this.state.titleSettings;
    const rev = ++this.titleSettingsRev;
    this.update((s) => ({ ...s, titleSettings: { enabled, modelId: previous?.modelId ?? null } }));
    try {
      const titleSettings = await this.client.setTitleSettings({ enabled });
      if (rev === this.titleSettingsRev) {
        this.update((s) => ({ ...s, titleSettings }));
      }
    } catch (error) {
      if (rev === this.titleSettingsRev) {
        this.update((s) => ({ ...s, titleSettings: previous }));
        this.toast("error", "Não foi possível alterar os títulos das conversas", userFacingError(error));
      }
    }
  }

  async setTitleModel(modelId: string | null): Promise<void> {
    const previous = this.state.titleSettings;
    const rev = ++this.titleSettingsRev;
    this.update((s) => ({ ...s, titleSettings: { enabled: previous?.enabled ?? true, modelId } }));
    try {
      const titleSettings = await this.client.setTitleSettings({ modelId });
      if (rev === this.titleSettingsRev) {
        this.update((s) => ({ ...s, titleSettings }));
      }
    } catch (error) {
      if (rev === this.titleSettingsRev) {
        this.update((s) => ({ ...s, titleSettings: previous }));
        this.toast("error", "Não foi possível alterar o modelo dos títulos", userFacingError(error));
      }
    }
  }

  async setSandboxDisabled(disabled: boolean): Promise<void> {
    // A linha da sandbox desativa seu interruptor sob o YOLO, mas nada mais passa por aqui hoje.
    // Recusar mesmo assim: o YOLO já força a sandbox desligada, e virar este interruptor por trás dele
    // enfileiraria um reinício inútil e dessincronizaria o botão da configuração que ele não controla mais.
    if (this.state.yoloSettings?.enabled === true) {
      this.toast("info", "O modo YOLO está ligado", "A sandbox já está desligada. Desligue o YOLO para controlá-la separadamente.");
      return;
    }
    const previous = this.state.sandboxSettings;
    const rev = ++this.sandboxSettingsRev;
    this.update((s) => ({ ...s, sandboxSettings: { disabled } }));
    // A revisão abaixo descarta respostas velhas, mas não ordena os pedidos. Os PATCHs andam
    // em fila para que uma desativação lenta nunca persista depois de uma reativação rápida.
    const run = this.sandboxSettingsChain.then(() => this.client.setSandboxSettings({ disabled }));
    this.sandboxSettingsChain = run.then(
      () => undefined,
      () => undefined,
    );
    try {
      const sandboxSettings = await run;
      if (rev === this.sandboxSettingsRev) {
        this.update((s) => ({ ...s, sandboxSettings }));
      }
    } catch (error) {
      if (rev === this.sandboxSettingsRev) {
        this.update((s) => ({ ...s, sandboxSettings: previous }));
        this.toast("error", "Não foi possível alterar a configuração da sandbox", userFacingError(error));
      }
    }
  }

  /**
   * Liga ou desliga o YOLO: o servidor recria seus hosts com `--disable-sandbox --trust-workspace`,
   * e cada conversa aberta vai para acesso total com o bypass implícito, como `muse --yolo`.
   * Desligar restaura os modos de antes de ligar, ou perguntar-antes quando são desconhecidos.
   */
  async setYoloEnabled(enabled: boolean): Promise<void> {
    // Virar para o valor que já está na tela é clique duplo, não intenção: responder a isso
    // fotografaria os modos do YOLO como os pré-YOLO (ou restauraria por cima deles) e faria PATCH à toa.
    if (this.state.yoloSettings?.enabled === enabled) {
      return;
    }
    const previous = this.state.yoloSettings;
    const rev = ++this.yoloSettingsRev;
    let capturedPreYolo = false;
    if (enabled && this.preYolo === null) {
      this.capturePreYolo();
      capturedPreYolo = true;
    }
    this.update((s) => ({ ...s, yoloSettings: { enabled } }));
    // O PATCH enfileira um reinício de hosts no servidor, e os hosts só são adquiridos depois da fila, então um
    // modo de aprovação empurrado antes do PATCH valer seria aplicado antes do reinício, não depois
    // dele: o host voltaria e veria na hora uma sessão com a postura errada. Esperar o PATCH
    // resolver antes de tocar no modo de aprovação de qualquer conversa.
    const run = this.yoloSettingsChain.then(() => this.client.setYoloSettings({ enabled }));
    this.yoloSettingsChain = run.then(
      () => undefined,
      () => undefined,
    );
    try {
      const yoloSettings = await run;
      if (rev === this.yoloSettingsRev) {
        this.update((s) => ({ ...s, yoloSettings }));
        this.applyYoloApprovals(enabled);
      }
    } catch (error) {
      if (rev === this.yoloSettingsRev) {
        // A virada nunca chegou ao servidor, então nenhum modo foi empurrado: só a bandeira
        // otimista volta, nada para desfazer do lado das aprovações.
        this.update((s) => ({ ...s, yoloSettings: previous }));
        this.toast("error", "Não foi possível mudar o modo YOLO", userFacingError(error));
        if (capturedPreYolo) {
          // A foto desta chamada nunca ligou nada: descartá-la para o próximo ligar fotografar
          // uma nova em vez de restaurar modos de uma sessão YOLO que nunca aconteceu.
          this.preYolo = null;
          this.setPrefs({ preYolo: null });
        }
      }
    }
  }

  /**
   * Os modos de aprovação como estão agora, para desligar o YOLO os restaurar. Guardados nas prefs
   * também, para um recarregar com o YOLO ligado não os perder: o campo em memória recomeça a cada
   * execução, mas a foto que ele teria tirado agora é exatamente o que a inicialização já persistiu.
   */
  private capturePreYolo(): void {
    this.preYolo = {
      defaultMode: this.state.prefs.defaultMode,
      threads: Object.fromEntries(
        Object.entries(this.state.threads).map(([id, thread]) => [id, thread.fold.meta.approvalMode ?? null]),
      ),
    };
    this.setPrefs({ preYolo: this.preYolo });
  }

  /** Conversas que o YOLO pode virar: abertas daqui, nunca a conversa só-leitura de outra sessão. */
  private yoloThreadIds(): string[] {
    return Object.entries(this.state.threads)
      .filter(([, thread]) => !thread.readOnly)
      .map(([id]) => id);
  }

  private applyYoloApprovals(enabled: boolean): void {
    if (enabled) {
      this.setPrefs({ defaultMode: "allowAll" });
      const modes: Record<string, ApprovalMode> = {};
      for (const sessionId of this.yoloThreadIds()) {
        this.patchMeta(sessionId, { approvalMode: "allowAll" });
        modes[sessionId] = "allowAll";
      }
      void this.pushThreadModes(modes, this.preYolo?.threads ?? {}, "perguntando antes");
      this.autoAllow(Object.keys(this.state.threads));
      return;
    }
    const prev = this.preYolo;
    this.preYolo = null;
    this.setPrefs({ preYolo: null });
    if (prev) {
      this.setPrefs({ defaultMode: prev.defaultMode });
    } else if (this.state.prefs.defaultMode === "allowAll") {
      // Sem foto para restaurar. Só limpar um padrão que este mesmo app forçou para acesso total;
      // um padrão que o usuário definiu de outro jeito, antes de ligarem o YOLO lá fora, não é nosso para mexer.
      this.setPrefs({ defaultMode: "onRequest" });
    }
    const modes: Record<string, ApprovalMode> = {};
    const fallback: Record<string, ApprovalMode | null> = {};
    for (const sessionId of this.yoloThreadIds()) {
      // Uma conversa que a foto nunca viu (abriu depois de ligar) cai no padrão da foto;
      // sem foto alguma, cada conversa vai para perguntar-antes em vez de adivinhar pelo padrão atual.
      const mode = prev ? (prev.threads[sessionId] ?? prev.defaultMode) : "onRequest";
      this.patchMeta(sessionId, { approvalMode: mode });
      modes[sessionId] = mode;
      fallback[sessionId] = "allowAll";
    }
    void this.pushThreadModes(modes, fallback, "com acesso total");
  }

  /**
   * Empurra modos de aprovação conversa por conversa; uma conversa que o servidor recusar mantém seu modo
   * `fallback` localmente em vez de fingir que a virada valeu. Um toast para qualquer quantidade de falhas.
   */
  private async pushThreadModes(
    modes: Record<string, ApprovalMode>,
    fallback: Record<string, ApprovalMode | null>,
    kept: string,
  ): Promise<void> {
    const ids = Object.keys(modes);
    if (ids.length === 0) {
      return;
    }
    const results = await Promise.allSettled(ids.map((sessionId) => this.client.setApprovalMode(sessionId, modes[sessionId] as ApprovalMode)));
    let failed = 0;
    results.forEach((result, i) => {
      if (result.status === "rejected") {
        failed += 1;
        const sessionId = ids[i] as string;
        this.patchMeta(sessionId, { approvalMode: fallback[sessionId] ?? null });
      }
    });
    if (failed > 0) {
      this.toast(
        "error",
        "Não foi possível alterar as permissões de todas as conversas",
        `${failed} conversa${failed === 1 ? " continua" : "s continuam"} ${kept}.`,
      );
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
        this.toast("error", "Não foi possível alterar o esforço desta conversa", userFacingError(error));
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
      this.toast("error", "Não foi possível renomear a conversa", userFacingError(error));
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
        label: "Desfazer",
        run: () => void this.unarchive(current),
      });
    } catch (error) {
      this.upsertSession(current);
      this.toast("error", "Não foi possível arquivar a conversa", userFacingError(error));
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
      this.toast("error", settled ? "Não foi possível resolver a conversa" : "Não foi possível trazer a conversa de volta", userFacingError(error));
    }
  }

  toggleShelf(key: string): void {
    const open = this.state.prefs.openShelves;
    this.setPrefs({ openShelves: open.includes(key) ? open.filter((k) => k !== key) : [...open, key] });
  }

  /** Arquivadas para a seção de Configurações; recarrega a cada abertura. */
  async loadArchived(): Promise<void> {
    const rev = ++this.archivedRev;
    try {
      const archived = await this.client.listSessions({ archived: true });
      if (rev === this.archivedRev) {
        this.update((s) => ({ ...s, archived, archivedLoaded: true, archivedError: null }));
      }
    } catch (error) {
      if (rev === this.archivedRev) {
        this.update((s) => ({ ...s, archivedLoaded: false, archivedError: userFacingError(error) }));
      }
    }
  }

  async restoreArchived(sessionId: string): Promise<void> {
    const current = this.state.archived.find((s) => s.sessionId === sessionId);
    if (!current) {
      return;
    }
    try {
      const saved = await this.client.updateSession(sessionId, { archived: false });
      this.upsertSession(saved ?? { ...current, archived: false });
      this.update((s) => ({ ...s, archived: s.archived.filter((a) => a.sessionId !== sessionId) }));
      this.toast("info", "Conversa restaurada", current.title);
    } catch (error) {
      this.toast("error", "Não foi possível restaurar a conversa", userFacingError(error));
    }
  }

  async deleteArchived(sessionId: string): Promise<void> {
    const current = this.state.archived.find((s) => s.sessionId === sessionId);
    if (!current || this.state.busy[`delete:${sessionId}`]) {
      return;
    }
    this.setBusy(`delete:${sessionId}`, true);
    try {
      await this.client.deleteSession(sessionId);
      this.update((s) => ({ ...s, archived: s.archived.filter((a) => a.sessionId !== sessionId) }));
      this.toast("info", "Conversa excluída", current.title);
    } catch (error) {
      this.toast("error", "Não foi possível excluir a conversa", userFacingError(error));
    } finally {
      this.setBusy(`delete:${sessionId}`, false);
    }
  }

  /** Troca a página das Configurações; id desconhecido cai na primeira seção. */
  openSettingsSection(id: string): void {
    const next = isSettingsSectionId(id) ? id : defaultSettingsSection().id;
    this.update((s) => (s.settingsSection === next ? s : { ...s, settingsSection: next }));
  }

  /**
   * Arquiva de uma vez as conversas ativas sem atividade há `days` dias ou mais.
   * Uma chamada por conversa, como arquivar uma a uma; um único aviso no fim.
   */
  async archiveOlderThan(days: number): Promise<{ archived: number; failed: number }> {
    if (this.state.busy["archive-older"]) {
      return { archived: 0, failed: 0 };
    }
    const candidates = olderThan(Object.values(this.state.sessions), days, this.platform.now());
    if (candidates.length === 0) {
      return { archived: 0, failed: 0 };
    }
    this.setBusy("archive-older", true);
    const ids = new Set(candidates.map((s) => s.sessionId));
    this.update((s) => {
      const sessions = { ...s.sessions };
      for (const id of ids) {
        delete sessions[id];
      }
      return { ...s, sessions };
    });
    const route = this.state.route;
    if (route.kind === "thread" && ids.has(route.sessionId)) {
      const current = candidates.find((s) => s.sessionId === route.sessionId);
      this.navigate({ kind: "new", cwd: current?.cwd ?? null });
    }
    let failed = 0;
    for (const session of candidates) {
      try {
        await this.client.updateSession(session.sessionId, { archived: true });
      } catch {
        failed += 1;
        this.upsertSession(session);
      }
    }
    this.setBusy("archive-older", false);
    const archived = candidates.length - failed;
    if (failed === 0) {
      this.toast("info", archived === 1 ? "1 conversa arquivada" : `${archived} conversas arquivadas`);
    } else if (archived === 0) {
      this.toast("error", "Não foi possível arquivar as conversas");
    } else {
      this.toast("error", `${archived} arquivadas, ${failed} falharam`);
    }
    return { archived, failed };
  }

  /** Restaura uma seleção de arquivadas com um único aviso no fim. */
  async restoreArchivedMany(sessionIds: readonly string[]): Promise<{ restored: number; failed: number }> {
    const targets = this.state.archived.filter((s) => sessionIds.includes(s.sessionId));
    if (targets.length === 0 || this.state.busy["restore-many"]) {
      return { restored: 0, failed: 0 };
    }
    this.setBusy("restore-many", true);
    let failed = 0;
    for (const current of targets) {
      try {
        const saved = await this.client.updateSession(current.sessionId, { archived: false });
        this.upsertSession(saved ?? { ...current, archived: false });
        this.update((s) => ({ ...s, archived: s.archived.filter((a) => a.sessionId !== current.sessionId) }));
      } catch {
        failed += 1;
      }
    }
    this.setBusy("restore-many", false);
    const restored = targets.length - failed;
    if (failed === 0) {
      this.toast("info", restored === 1 ? "1 conversa restaurada" : `${restored} conversas restauradas`);
    } else if (restored === 0) {
      this.toast("error", "Não foi possível restaurar as conversas");
    } else {
      this.toast("error", `${restored} restauradas, ${failed} falharam`);
    }
    return { restored, failed };
  }

  /** Exclui uma seleção de arquivadas com um único aviso no fim. A confirmação é da tela. */
  async deleteArchivedMany(sessionIds: readonly string[]): Promise<{ deleted: number; failed: number }> {
    const targets = this.state.archived.filter((s) => sessionIds.includes(s.sessionId));
    if (targets.length === 0 || this.state.busy["delete-many"]) {
      return { deleted: 0, failed: 0 };
    }
    this.setBusy("delete-many", true);
    let failed = 0;
    for (const current of targets) {
      try {
        await this.client.deleteSession(current.sessionId);
        this.update((s) => ({ ...s, archived: s.archived.filter((a) => a.sessionId !== current.sessionId) }));
      } catch {
        failed += 1;
      }
    }
    this.setBusy("delete-many", false);
    const deleted = targets.length - failed;
    if (failed === 0) {
      this.toast("info", deleted === 1 ? "1 conversa excluída" : `${deleted} conversas excluídas`);
    } else if (deleted === 0) {
      this.toast("error", "Não foi possível excluir as conversas");
    } else {
      this.toast("error", `${deleted} excluídas, ${failed} falharam`);
    }
    return { deleted, failed };
  }

  /** Apaga o histórico da caixa-preta do servidor; a tela confirma antes e recarrega depois. */
  clearFailures(): Promise<{ count: number; recent: FailureEntry[] }> {
    return this.client.clearFailures();
  }

  /** Linhas recentes da caixa-preta do servidor, para o diagnóstico do Sobre. Sem estado: a tela carrega ao abrir. */
  listFailures(limit = 50): Promise<{ count: number; recent: FailureEntry[] }> {
    return this.client.listFailures(limit);
  }

  private async unarchive(session: SessionSummary): Promise<void> {
    try {
      const saved = await this.client.updateSession(session.sessionId, { archived: false });
      this.upsertSession(saved ?? { ...session, archived: false });
    } catch (error) {
      this.toast("error", "Não foi possível restaurar a conversa", userFacingError(error));
    }
  }

  listDirectory(path: string): Promise<import("../types.js").DirectoryListing> {
    return this.client.listDirectory(path);
  }

  async revealPath(path: string): Promise<void> {
    try {
      await this.client.revealPath(path);
    } catch (error) {
      this.toast("error", "Não foi possível abrir a pasta", userFacingError(error));
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
      this.toast("error", "Não foi possível clonar o repositório", userFacingError(error));
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
      this.toast("error", "Não foi possível adicionar essa pasta", userFacingError(error));
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
      this.toast("error", "Não foi possível reordenar os projetos", userFacingError(error));
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
        label: "Desfazer",
        run: () => void this.addProject(cwd),
      });
    } catch (error) {
      void this.refresh();
      this.toast("error", "Não foi possível remover o projeto", userFacingError(error));
    }
  }

  async refreshProject(cwd: string): Promise<void> {
    try {
      await this.client.discover(cwd);
      await this.refresh();
    } catch (error) {
      this.toast("error", "Não foi possível atualizar esse projeto", userFacingError(error));
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
      this.toast("error", "Não foi possível atualizar o projeto", userFacingError(error));
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
      this.setSkills(cwd, { status: "error", skills: current?.skills ?? [], error: userFacingError(error), loadedAt: this.platform.now() });
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
        this.toast("error", "Comando não executado", userFacingError(error));
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
          // O YOLO já é dono do acesso total geral; abrir o diálogo de confirmação aqui prometeria uma
          // mudança de conversa que o próprio setMode recusa quando o diálogo diz sim.
          if (this.state.yoloSettings?.enabled === true) {
            this.toast("info", "O YOLO está ligado", "Desligue o YOLO para mudar as permissões.");
            return true;
          }
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
        this.toast("error", `Não foi possível carregar /${skill.name}`, userFacingError(error));
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
      this.toast("error", "Não foi possível definir a meta", userFacingError(error));
      return false;
    }
  }

  /** Pausa, continua, limpa ou edita a meta da conversa. `quiet` deixa as falhas com quem chamou. */
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
        // O Muse recusa um verbo que o estado atual da meta não permite, como pausar uma que já está bloqueada.
        const stale = /invalid_goal_state|missing_goal/.test(errorMessage(error));
        this.toast(stale ? "info" : "error", GOAL_FAILURES[action], stale ? "A meta mudou desde que este painel foi atualizado. Tente de novo quando ele alcançar." : userFacingError(error));
      }
      return false;
    } finally {
      this.setBusy(key, false);
    }
  }

  // ---------------------------------------------------------------- tasks, subagents and workflows

  /** `background` ou `stop` numa tarefa de ferramenta pelo id do item, ou `stopAll` no trabalho de fundo da conversa. */
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
      this.toast("error", TASK_FAILURES[action], userFacingError(error));
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
      this.toast("error", "O subagente não aceitou isso", userFacingError(error));
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
      // Uma tentativa obsoleta significa que o filho avançou desde que este cartão foi desenhado; a próxima atualização da tela o redesenha.
      const stale = errorKind(error) === "stale_attempt";
      this.toast(stale ? "info" : "error", stale ? "Esse agente já avançou" : "O workflow não aceitou isso", stale ? "Tente de novo quando o cartão atualizar." : userFacingError(error));
      return false;
    } finally {
      this.setBusy(key, false);
    }
  }

  /** Uma página da saída completa guardada de uma ferramenta; quem chama continua pedindo de `offsetBytes + byteLen` até `eof`. */
  readOutput(sessionId: string, itemId: string, outputRef: string, offset = 0): Promise<OutputRange> {
    return this.client.readOutput(sessionId, itemId, outputRef, offset);
  }

  /** Passa um comando `!` que o host não conseguiu rodar ao agente, cuja própria ferramenta de shell consegue. */
  askToRun(sessionId: string, command: string): Promise<boolean> {
    // Uma cerca maior que qualquer sequência de crases no comando, para o comando não fechar o próprio bloco.
    const runs = command.match(/`+/g) ?? [];
    const fence = "`".repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
    // O item `!` que falhou diz que o ambiente está quebrado, o que faz o agente recusar; diga a ele que o próprio shell dele funciona.
    const text =
      `Run this with your shell tool and show me the output:\n\n${fence}sh\n${command}\n${fence}\n\n` +
      "That failure came from Helicon's `!` path, not from your tools: your own shell works here.";
    return this.sendToThread(sessionId, text, {}, false);
  }

  /** Ramifica uma conversa no turno escolhido e, quando pedido, põe o prompt no rascunho do ramo. */
  async fork(
    sessionId: string,
    lastTurnId?: string,
    draft?: { text: string; attachments?: OutgoingAttachment[]; previews?: EchoAttachment[] },
  ): Promise<boolean> {
    const key = `fork:${sessionId}`;
    if (this.state.busy[key]) {
      return false;
    }
    this.setBusy(key, true);
    try {
      const session = await this.client.forkSession(sessionId, lastTurnId);
      this.upsertSession(session);
      if (draft) {
        this.update((s) => ({ ...s, draftHandoff: { key: session.sessionId, ...draft } }));
      }
      this.navigate({ kind: "thread", sessionId: session.sessionId });
      this.toast("success", "Ramificada numa nova conversa", draft
        ? "O pedido está no rascunho da nova conversa; confira e envie quando quiser."
        : "A conversa original continua como estava.");
      return true;
    } catch (error) {
      this.toast(
        "error",
        "Não foi possível ramificar a conversa",
        errorKind(error) === "forkBoundaryInvalid" ? "O Muse não encontrou um ponto nesta conversa para ramificá-la."
          : errorKind(error) === "forkCutUnconfirmed" ? "O Muse não confirmou o corte. Pode ter criado uma sessão sem ele; confira a lista antes de tentar de novo. A conversa original não mudou."
            : userFacingError(error),
      );
      return false;
    } finally {
      this.setBusy(key, false);
    }
  }

  /** Verdadeiro só quando o Muse assumiu a compactação: uma recusa ou uma operação vazia deixa o histórico exatamente como estava. */
  async compact(sessionId: string): Promise<boolean> {
    try {
      const result = await this.client.compact(sessionId);
      if (result.noop) {
        const reason = result.reason === "no_compactable_history" ? "Não há histórico anterior para resumir." : result.reason;
        this.toast("info", "Nada para compactar ainda", reason ? `${reason.charAt(0).toUpperCase()}${reason.slice(1).replace(/_/g, " ")}` : undefined);
        return false;
      }
      this.toast("info", "Compactando o contexto", "O Muse vai resumir as mensagens anteriores para liberar a janela de contexto.");
      return true;
    } catch (error) {
      this.toast("error", "Não foi possível compactar o contexto", userFacingError(error));
      return false;
    }
  }

  /**
   * Para uma conversa cujo histórico o provedor não aceita: resume-o, o que deixa a parte inutilizável
   * para trás, e reenvia o prompt. A repetição entra na fila atrás da compactação que o Muse roda como mensagem própria.
   */
  /**
   * Para uma conversa cujo raciocínio guardado não pode ser repetido: começa uma ao lado, no mesmo projeto
   * e envia o prompt para lá. Compactar mantém as mensagens recentes como estão, então não resolve isso.
   */
  async freshThread(
    sessionId: string,
    prompt: string | null,
    files: { attachments?: OutgoingAttachment[]; previews?: EchoAttachment[] } = {},
  ): Promise<boolean> {
    const cwd = this.state.sessions[sessionId]?.cwd ?? null;
    if (!cwd) {
      this.toast("error", "Não foi possível começar uma nova conversa", "O projeto dessa conversa é desconhecido aqui.");
      return false;
    }
    // Uma imagem sem palavras próprias ainda é uma pergunta, então ela vai junto; sem nenhum dos dois, não há
    // nada a perguntar de novo e a nova conversa apenas se abre.
    const carrying = files.attachments?.length ?? 0;
    if (!prompt && carrying === 0) {
      this.newThread(cwd);
      return true;
    }
    const text = prompt ?? "";
    // Pelo caminho de repetição, para que um prompt digitado como `/goal …` ou uma skill se expanda de novo em vez de
    // chegar ao modelo como o comando literal que a transcrição mostrou.
    // O resultado real, para um prompt que não foi voltar ao composer em vez de se perder.
    return this.startThread(cwd, text, (fresh) => this.retryTurn(fresh, text, files), files);
  }

  async compactAndRetry(
    sessionId: string,
    prompt: string | null,
    files: { attachments?: OutgoingAttachment[]; previews?: EchoAttachment[] } = {},
  ): Promise<void> {
    // Só uma compactação que o Muse assumiu muda o histórico: depois de uma recusa ou de uma operação vazia, o prompt falharia
    // exatamente como antes. A repetição entra na fila atrás da mensagem de compactação, que pode ainda não ter chegado até nós.
    if (!(await this.compact(sessionId)) || !prompt) {
      return;
    }
    await this.retryTurn(sessionId, prompt, { ...files, queue: true });
  }

  async openFolder(cwd: string, target: "files" | "editor"): Promise<void> {
    try {
      await this.client.openFolder(cwd, target);
    } catch (error) {
      this.toast("error", target === "editor" ? "Não foi possível abrir o VS Code" : "Não foi possível abrir a pasta", userFacingError(error));
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
   * Lembra se um cartão do dock está aberto, por conversa. Sem isso o cartão é um estado local que morre com
   * a tela, então sair de uma conversa e voltar reabriria o que o usuário tinha dobrado.
   */
  setCardOpen(key: string, open: boolean): void {
    const collapsed = this.state.prefs.collapsedCards;
    if (open === !collapsed.includes(key)) {
      return;
    }
    this.setPrefs({ collapsedCards: open ? collapsed.filter((k) => k !== key) : [...collapsed, key] });
  }

  /** Fecha um cartão do dock para valer, ou o traz de volta. Os mais antigos são esquecidos após algumas centenas de conversas. */
  setCardHidden(key: string, hidden: boolean): void {
    const current = this.state.prefs.hiddenCards;
    if (hidden === current.includes(key)) {
      return;
    }
    this.setPrefs({ hiddenCards: hidden ? [...current, key].slice(-300) : current.filter((k) => k !== key) });
  }

  /** Traz de volta todo cartão do dock fechado numa conversa. */
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

  /** Mostra ou esconde o visualizador de arquivos ao lado das conversas; ele mantém os arquivos abertos de cada conversa de todo jeito. */
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
   * Abre um arquivo no visualizador de uma conversa, da árvore ou de um caminho que uma resposta citou, e mostra o visualizador. Um caminho com
   * linha (`app.ts:12`) rola até lá. Retorna falso quando o projeto da conversa é desconhecido.
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

  /** Fecha uma aba, descartando sua edição não salva; a tela pergunta antes quando há uma. */
  closeFile(sessionId: string, path: string): void {
    const cwd = this.state.sessions[sessionId]?.cwd;
    if (cwd) {
      this.setFileDraft(cwd, path, null);
    }
    this.patchPanel(sessionId, (panel) => {
      const index = panel.tabs.indexOf(path);
      const tabs = panel.tabs.filter((tab) => tab !== path);
      // O vizinho à esquerda assume, como num editor; fechar a última aba mostra a árvore.
      const active = panel.active !== path ? panel.active : (tabs[Math.max(0, index - 1)] ?? null);
      return { tabs, active, tree: active === null ? true : panel.tree, line: panel.active === path ? null : panel.line };
    });
  }

  /** Mantém uma edição não salva ao trocar de aba; null a descarta. */
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
    if (content === null) {
      this.persistFileDrafts();
    } else {
      this.scheduleFileDraftsPersist();
    }
  }

  /** Descarta a cópia recuperável e recarrega o arquivo do disco, sem gravar o original. */
  reloadFile(cwd: string, path: string): void {
    this.setFileDraft(cwd, path, null);
    const key = fileKey(cwd, path);
    this.update((s) => ({ ...s, fileVersions: { ...s.fileVersions, [key]: (s.fileVersions[key] ?? 0) + 1 } }));
  }

  /**
   * Salva a edição não salva de um arquivo. Quando o arquivo mudou no disco desde que foi aberto, nada é escrito e o usuário
   * escolhe: a ação do toast sobrescreve, ou recarregar o arquivo mostra a outra mudança. Retorna o novo horário de escrita.
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
      // Só um rascunho ainda com o que foi enviado está pronto; digitar durante o salvamento mantém o texto mais novo como não salvo.
      this.update((s) => {
        const fileDrafts = { ...s.fileDrafts };
        if (fileDrafts[key]?.content === draft.content) {
          delete fileDrafts[key];
        } else if (fileDrafts[key]) {
          fileDrafts[key] = { ...fileDrafts[key], baseMtimeMs: saved.mtimeMs };
        }
        return { ...s, fileDrafts, fileVersions: { ...s.fileVersions, [key]: (s.fileVersions[key] ?? 0) + 1 } };
      });
      this.persistFileDrafts();
      return saved.mtimeMs;
    } catch (error) {
      if (errorKind(error) === "fileChanged") {
        this.toast("error", "Este arquivo mudou no disco", "Outra coisa o salvou desde que você o abriu. Recarregue para ver essa mudança, ou sobrescreva com a sua.", {
          label: "Sobrescrever",
          run: () => void this.saveFile(cwd, path, true),
        });
      } else {
        this.toast("error", "Não foi possível salvar o arquivo", userFacingError(error));
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

  private scheduleFileDraftsPersist(): void {
    if (this.draftSaveHandle !== null) {
      return;
    }
    this.draftSaveHandle = this.platform.schedule(() => {
      this.draftSaveHandle = null;
      this.persistFileDrafts();
    }, 400);
  }

  private persistFileDrafts(): void {
    if (this.draftSaveHandle !== null) {
      this.platform.cancel(this.draftSaveHandle);
      this.draftSaveHandle = null;
    }
    const omitted = oversizedFileDraftKeys(this.state.fileDrafts);
    try {
      this.platform.saveFileDrafts?.(serializeFileDrafts(this.state.fileDrafts));
      if (omitted.length > 0) {
        if (!this.draftsPersistFailed) {
          this.draftsPersistFailed = true;
          this.toast("info", "Cópia recuperável não foi guardada", FILE_DRAFTS_LIMIT_MESSAGE);
        }
        return;
      }
      this.draftsPersistFailed = false;
    } catch {
      if (!this.draftsPersistFailed) {
        this.draftsPersistFailed = true;
        this.toast(
          "info",
          "Cópia recuperável não foi guardada",
          "A edição continua nesta sessão. Reiniciar o Helicon pode perdê-la.",
        );
      }
    }
  }

  private allowClose(dialog: boolean): boolean {
    this.persistFileDrafts();
    if (Object.keys(this.state.fileDrafts).length === 0) {
      return true;
    }
    if (!dialog) {
      return false;
    }
    const unsafe = this.draftsPersistFailed || oversizedFileDraftKeys(this.state.fileDrafts).length > 0;
    return this.platform.confirmLeave?.(unsafe ? FILE_DRAFTS_LEAVE_UNSAFE_MESSAGE : FILE_DRAFTS_LEAVE_MESSAGE) ?? true;
  }

  fileUrl(cwd: string, path: string): string {
    return this.client.fileUrl(cwd, path);
  }

  async openFileExternally(cwd: string, path: string): Promise<void> {
    try {
      await this.client.openFileExternally(cwd, path);
    } catch (error) {
      this.toast("error", "Não foi possível abrir o arquivo", userFacingError(error));
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
