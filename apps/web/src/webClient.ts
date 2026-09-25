import {
  HeliconError,
  parseFailures,
  parseModelList,
  parseSandboxSettings,
  parseTitleSettings,
  parseYoloSettings,
  type ApprovalDecisionInput,
  type ApprovalMode,
  type AttachmentView,
  type DirectoryListing,
  type EnvironmentStatus,
  type EventHandler,
  type FailureEntry,
  type FileContent,
  type FileEntry,
  type FileListing,
  type GoalAction,
  type HeliconClient,
  type HeliconEvent,
  type ModelOption,
  type OutputRange,
  type PlanUsage,
  type ProjectView,
  type ReasoningEffort,
  type SandboxSettings,
  type SessionSummary,
  type ShellRun,
  type SkillCatalog,
  type SubagentAction,
  type TaskAction,
  type TitleSettings,
  type TranscriptLoad,
  type TurnOptions,
  type UsageReport,
  type UserInputAnswer,
  type WorkflowAction,
  type YoloSettings,
} from "@helicon/ui";

/** Com qual servidor esta página fala. Uma base vazia é a origem que serviu a página. */
export interface Daemon {
  base: string;
  token: string | null;
}

const DAEMON_KEY = "helicon:daemon";

function stored(): Daemon | null {
  try {
    const raw = window.localStorage.getItem(DAEMON_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<Daemon>;
    return { base: typeof parsed.base === "string" ? parsed.base : "", token: typeof parsed.token === "string" ? parsed.token : null };
  } catch {
    return null;
  }
}

function remember(next: Daemon): void {
  try {
    window.localStorage.setItem(DAEMON_KEY, JSON.stringify(next));
  } catch {
    /* um navegador com armazenamento desligado ainda funciona nesta sessão */
  }
}

/**
 * O token costumava ir na query string, o que o colocava no histórico e em todo link compartilhado.
 * Um ainda é aceito lá, porque era assim que links locais eram distribuídos, mas ele é tirado
 * da barra de endereço na hora e guardado aqui.
 */
function initial(): Daemon {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("token");
  if (fromUrl) {
    const next: Daemon = { base: "", token: fromUrl };
    remember(next);
    params.delete("token");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    return next;
  }
  return stored() ?? { base: "", token: null };
}

let daemon: Daemon = initial();

export function currentDaemon(): Daemon {
  return daemon;
}

/** Aponta esta página para outro servidor; quem chama recarrega para todo stream aberto recomeçar. */
export function setDaemon(next: Daemon): void {
  daemon = { base: next.base.replace(/\/$/, ""), token: next.token };
  remember(daemon);
}

function url(path: string): string {
  return daemon.base ? `${daemon.base}${path}` : path;
}

/** Longo o bastante para uma chamada local lenta, curto o bastante para uma travada nunca deixar a interface esperando para sempre. */
const CALL_TIMEOUT_MS = 60_000;
/** Um comando `!` pode rodar por dois minutos no servidor; a espera aqui tem que durar mais que isso. */
const SHELL_TIMEOUT_MS = 150_000;
/** Dois heartbeats perdidos. O servidor envia um a cada 25s, então silêncio por tanto tempo quer dizer que o stream caiu. */
const STREAM_IDLE_MS = 70_000;

async function call<T>(method: string, path: string, body?: unknown, timeoutMs = CALL_TIMEOUT_MS): Promise<T> {
  let response: Response;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    response = await fetch(url(path), {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        // Num cabeçalho em vez da URL, para ficar fora do histórico, dos logs e dos links compartilhados.
        ...(daemon.token ? { authorization: `Bearer ${daemon.token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: daemon.base ? "include" : "same-origin",
      signal: abort.signal,
    });
  } catch {
    throw new HeliconError(
      abort.signal.aborted
        ? "O servidor Helicon local demorou demais para responder."
        : "O servidor Helicon local não está acessível. Ele ainda está rodando?",
      0,
    );
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const failure = (data ?? {}) as { error?: unknown; kind?: unknown };
    throw new HeliconError(
      typeof failure.error === "string" ? failure.error : `${method} ${path} falhou com ${response.status}.`,
      response.status,
      typeof failure.kind === "string" ? failure.kind : null,
    );
  }
  return data as T;
}

const enc = encodeURIComponent;

/** O cliente Helicon sobre a API REST do servidor local e server-sent events. */
export class WebHeliconClient implements HeliconClient {
  private readonly handlers = new Set<EventHandler>();
  private source: EventSource | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  /** O handshake é aguardado antes do stream abrir; isto impede um segundo inscrito de disputar com ele. */
  private connecting = false;

  probeEnvironment(refresh = false): Promise<EnvironmentStatus> {
    return call<EnvironmentStatus>("GET", `/api/env${refresh ? "?refresh=1" : ""}`);
  }

  async listProjects(): Promise<ProjectView[]> {
    return (await call<{ projects: ProjectView[] }>("GET", "/api/projects")).projects;
  }

  async addProject(cwd: string, options?: { create?: boolean }): Promise<{ cwd: string; warning: string | null }> {
    const result = await call<{ project: { cwd: string }; warning: string | null }>("POST", "/api/projects", {
      cwd,
      create: options?.create === true,
    });
    return { cwd: result.project.cwd, warning: result.warning };
  }

  async cloneProject(url: string, path: string): Promise<{ cwd: string; warning: string | null }> {
    const result = await call<{ project: { cwd: string }; warning: string | null }>("POST", "/api/projects/clone", { url, path });
    return { cwd: result.project.cwd, warning: result.warning };
  }

  listDirectory(path: string): Promise<DirectoryListing> {
    return call<DirectoryListing>("GET", `/api/fs/list?path=${enc(path)}`);
  }

  async revealPath(path: string): Promise<void> {
    await call("POST", "/api/fs/reveal", { path });
  }

  async hideProject(cwd: string): Promise<void> {
    await call("DELETE", `/api/projects?cwd=${enc(cwd)}`);
  }

  async setPinned(cwd: string, pinned: boolean): Promise<void> {
    await call("PATCH", "/api/projects/pin", { cwd, pinned });
  }

  async setProjectOrder(cwds: string[]): Promise<void> {
    await call("PATCH", "/api/projects/order", { cwds });
  }

  usage(days?: number): Promise<UsageReport> {
    return call<UsageReport>("GET", `/api/usage${days ? `?days=${days}` : ""}`);
  }

  async runShellProxy(sessionId: string, command: string): Promise<ShellRun> {
    // O servidor deixa um comando rodar por dois minutos, então isto tem que durar mais que isso em vez de abandonar cedo.
    const result = await call<{ run: ShellRun }>("POST", `/api/sessions/${enc(sessionId)}/shell-proxy`, { command }, SHELL_TIMEOUT_MS);
    return result.run;
  }

  async listSessions(options?: { archived?: boolean }): Promise<SessionSummary[]> {
    return (await call<{ sessions: SessionSummary[] }>("GET", `/api/sessions${options?.archived ? "?archived=1" : ""}`)).sessions;
  }

  async discover(cwd?: string): Promise<void> {
    await call("POST", "/api/discover", cwd ? { cwd } : {});
  }

  async startSession(cwd: string, options?: { approvalMode?: ApprovalMode; modelId?: string }): Promise<SessionSummary> {
    const result = await call<{ session: SessionSummary }>("POST", "/api/sessions", {
      cwd,
      approvalMode: options?.approvalMode,
      modelId: options?.modelId,
    });
    return result.session;
  }

  loadTranscript(sessionId: string): Promise<TranscriptLoad> {
    return call<TranscriptLoad>("POST", `/api/sessions/${enc(sessionId)}/resume`, {});
  }

  async updateSession(sessionId: string, patch: { title?: string; archived?: boolean }): Promise<SessionSummary | null> {
    return (await call<{ session: SessionSummary | null }>("PATCH", `/api/sessions/${enc(sessionId)}`, patch)).session;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await call("DELETE", `/api/sessions/${enc(sessionId)}`);
  }

  async sendTurn(
    sessionId: string,
    text: string,
    options?: TurnOptions,
  ): Promise<{ turnId: string | null; disposition: string | null; attachments?: AttachmentView[] }> {
    const result = await call<{ turnId: string | null; disposition: unknown; attachments?: AttachmentView[] }>("POST", "/api/turns", {
      sessionId,
      text,
      ifBusy: options?.ifBusy,
      reasoningEffort: options?.reasoningEffort,
      displayText: options?.displayText,
      attachments: options?.attachments,
    });
    return {
      turnId: result.turnId ?? null,
      disposition: typeof result.disposition === "string" ? result.disposition : null,
      ...(result.attachments ? { attachments: result.attachments } : {}),
    };
  }

  async interruptTurn(sessionId: string, turnId?: string): Promise<void> {
    await call("POST", "/api/turns/interrupt", { sessionId, turnId });
  }

  async cancelTurn(sessionId: string, turnId: string): Promise<void> {
    await call("POST", "/api/turns/cancel", { sessionId, turnId });
  }

  async unqueueTurn(sessionId: string, turnId: string): Promise<void> {
    await call("POST", "/api/turns/unqueue", { sessionId, turnId });
  }

  async decideApproval(input: ApprovalDecisionInput): Promise<void> {
    await call("POST", "/api/approvals/decide", input);
  }

  async answerUserInput(sessionId: string, userInputId: string, answers: UserInputAnswer[]): Promise<void> {
    await call("POST", "/api/user-input/answer", { sessionId, userInputId, answers });
  }

  async cancelUserInput(sessionId: string, userInputId: string): Promise<void> {
    await call("POST", "/api/user-input/cancel", { sessionId, userInputId });
  }

  async clarifyUserInput(sessionId: string, userInputId: string, content: string): Promise<void> {
    await call("POST", "/api/user-input/clarify", { sessionId, userInputId, content });
  }

  async listModels(sessionId?: string): Promise<ModelOption[]> {
    const result = await call<{ models: unknown }>("GET", `/api/models${sessionId ? `?sessionId=${enc(sessionId)}` : ""}`);
    return parseModelList(result.models);
  }

  async getTitleSettings(): Promise<TitleSettings> {
    return parseTitleSettings(await call<unknown>("GET", "/api/title-settings"));
  }

  async setTitleSettings(patch: { enabled?: boolean; modelId?: string | null }): Promise<TitleSettings> {
    return parseTitleSettings(await call<unknown>("PATCH", "/api/title-settings", patch));
  }

  async getSandboxSettings(): Promise<SandboxSettings> {
    return parseSandboxSettings(await call<unknown>("GET", "/api/sandbox-settings"));
  }

  async setSandboxSettings(patch: { disabled?: boolean }): Promise<SandboxSettings> {
    return parseSandboxSettings(await call<unknown>("PATCH", "/api/sandbox-settings", patch));
  }

  async getYoloSettings(): Promise<YoloSettings> {
    return parseYoloSettings(await call<unknown>("GET", "/api/yolo-settings"));
  }

  async setYoloSettings(patch: { enabled?: boolean }): Promise<YoloSettings> {
    return parseYoloSettings(await call<unknown>("PATCH", "/api/yolo-settings", patch));
  }

  async restartHosts(): Promise<void> {
    await call("POST", "/api/hosts/restart", {});
  }

  async setSessionModel(sessionId: string, modelId: string): Promise<void> {
    await call("POST", `/api/sessions/${enc(sessionId)}/model`, { model: { modelId } });
  }

  async setApprovalMode(sessionId: string, mode: ApprovalMode): Promise<void> {
    await call("POST", `/api/sessions/${enc(sessionId)}/approval-mode`, { mode });
  }

  async compact(sessionId: string): Promise<{ noop: boolean; reason: string | null }> {
    const { result } = await call<{ result: { status?: unknown; reason?: unknown } | null }>(
      "POST",
      `/api/sessions/${enc(sessionId)}/compact`,
      {},
    );
    return { noop: result?.status === "noop", reason: typeof result?.reason === "string" ? result.reason : null };
  }

  async runShell(sessionId: string, command: string): Promise<void> {
    await call("POST", `/api/sessions/${enc(sessionId)}/shell`, { command });
  }

  async forkSession(sessionId: string, lastTurnId?: string): Promise<SessionSummary> {
    return (await call<{ session: SessionSummary }>("POST", `/api/sessions/${enc(sessionId)}/fork`,
      lastTurnId === undefined ? {} : { cutPoint: { lastTurnId } })).session;
  }

  listSkills(cwd: string, sessionId?: string): Promise<SkillCatalog> {
    return call<SkillCatalog>("GET", `/api/slash?cwd=${enc(cwd)}${sessionId ? `&sessionId=${enc(sessionId)}` : ""}`);
  }

  async skillBody(cwd: string, skillId: string): Promise<string> {
    return (await call<{ body: string }>("GET", `/api/slash/skill?cwd=${enc(cwd)}&id=${enc(skillId)}`)).body;
  }

  async openFolder(cwd: string, target: "files" | "editor"): Promise<void> {
    await call("POST", "/api/open", { cwd, target });
  }

  async setReasoningEffort(sessionId: string, effort: ReasoningEffort): Promise<void> {
    await call("POST", `/api/sessions/${enc(sessionId)}/effort`, { reasoningEffort: effort });
  }

  async goal(sessionId: string, action: GoalAction, objective?: string): Promise<{ turnId: string | null }> {
    const result = await call<{ turnId?: string | null }>("POST", `/api/sessions/${enc(sessionId)}/goal`, { action, objective });
    return { turnId: result.turnId ?? null };
  }

  async subagent(sessionId: string, action: SubagentAction, subagentId: string, options?: { reason?: string; body?: string }): Promise<void> {
    await call("POST", `/api/sessions/${enc(sessionId)}/subagent`, { action, subagentId, reason: options?.reason, body: options?.body });
  }

  async task(sessionId: string, action: TaskAction, taskId?: string): Promise<void> {
    await call("POST", `/api/sessions/${enc(sessionId)}/tasks`, { action, taskId });
  }

  async workflow(sessionId: string, action: WorkflowAction, workflowRunId: string, child?: { childId: string; attempt: number }): Promise<void> {
    await call("POST", `/api/sessions/${enc(sessionId)}/workflow`, { action, workflowRunId, childId: child?.childId, attempt: child?.attempt });
  }

  async readOutput(sessionId: string, itemId: string, outputRef: string, offset = 0): Promise<OutputRange> {
    const path = `/api/sessions/${enc(sessionId)}/output?itemId=${enc(itemId)}&outputRef=${enc(outputRef)}&offset=${offset}`;
    return (await call<{ output: OutputRange }>("GET", path)).output;
  }

  async planUsage(): Promise<PlanUsage | null> {
    return (await call<{ usage: PlanUsage | null }>("GET", "/api/plan-usage")).usage;
  }

  async listFailures(limit: number): Promise<{ count: number; recent: FailureEntry[] }> {
    return parseFailures(await call<unknown>("GET", `/api/failures?limit=${Math.floor(limit)}`));
  }

  listFiles(cwd: string, path: string): Promise<FileListing> {
    return call<FileListing>("GET", `/api/files/list?cwd=${enc(cwd)}&path=${enc(path)}`);
  }

  readFile(cwd: string, path: string): Promise<FileContent> {
    return call<FileContent>("GET", `/api/files/read?cwd=${enc(cwd)}&path=${enc(path)}`);
  }

  writeFile(cwd: string, path: string, content: string, baseMtimeMs: number | null): Promise<{ path: string; size: number; mtimeMs: number }> {
    return call("PUT", "/api/files/write", { cwd, path, content, baseMtimeMs });
  }

  async searchFiles(cwd: string, query: string): Promise<FileEntry[]> {
    return (await call<{ files: FileEntry[] }>("GET", `/api/files/search?cwd=${enc(cwd)}&q=${enc(query)}`)).files;
  }

  async openFileExternally(cwd: string, path: string): Promise<void> {
    await call("POST", "/api/files/open", { cwd, path });
  }

  fileUrl(cwd: string, path: string): string {
    return this.assetUrl(`/api/files/raw?cwd=${enc(cwd)}&path=${enc(path)}`);
  }

  /**
   * Um caminho do servidor que o navegador carrega sozinho, como os bytes de um anexo. Não leva token: o
   * cookie do handshake é o que deixa estes passar, então nada secreto termina numa tag `img`.
   */
  assetUrl(path: string): string {
    return url(path);
  }

  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler);
    void this.connect();
    return () => {
      this.handlers.delete(handler);
      if (this.handlers.size === 0) {
        this.stopWatchdog();
        this.source?.close();
        this.source = null;
      }
    };
  }

  private async connect(): Promise<void> {
    if (this.source || this.connecting) {
      return;
    }
    this.connecting = true;
    try {
      // O EventSource não consegue enviar cabeçalho, então o token compra um cookie primeiro e o stream usa esse.
      if (daemon.token) {
        await call("POST", "/api/auth", { token: daemon.token });
      }
    } catch {
      // Deixa o stream tentar mesmo assim: um servidor sem autenticação não precisa de handshake, e uma recusa real
      // aparece como conexão perdida em vez de um nada silencioso.
    } finally {
      this.connecting = false;
    }
    if (this.source || this.handlers.size === 0) {
      return;
    }
    const source = new EventSource(url("/api/events"), { withCredentials: Boolean(daemon.base) });
    source.addEventListener("helicon", (message) => {
      this.touch();
      try {
        this.dispatch(JSON.parse((message as MessageEvent<string>).data) as HeliconEvent);
      } catch {
        /* ignora frames malformados */
      }
    });
    // O heartbeat do servidor: prova de que o stream ainda está transmitindo, e nada mais.
    source.addEventListener("ping", () => this.touch());
    source.addEventListener("open", () => this.touch());
    source.addEventListener("error", () => this.dispatch({ type: "connection", state: "lost" }));
    this.source = source;
    this.touch();
  }

  /** Reinicia o temporizador de ociosidade. Um stream que não diz nada por dois heartbeats perdidos é tratado como morto. */
  private touch(): void {
    this.stopWatchdog();
    this.watchdog = setTimeout(() => this.revive(), STREAM_IDLE_MS);
  }

  private stopWatchdog(): void {
    if (this.watchdog !== null) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }

  /**
   * Um stream morto que o navegador não consegue ver: um proxy pode segurar a conexão aberta muito depois de o upstream
   * ter caído, então nenhum `error` dispara e o app fica sobre uma transcrição que parou de se mover. Derrubá-lo à mão
   * e abrir um novo traz de volta o `hello`, que é o que faz o app recarregar o que perdeu.
   */
  private revive(): void {
    this.stopWatchdog();
    this.source?.close();
    this.source = null;
    this.dispatch({ type: "connection", state: "lost" });
    if (this.handlers.size > 0) {
      void this.connect();
    }
  }

  private dispatch(event: HeliconEvent): void {
    for (const handler of [...this.handlers]) {
      handler(event);
    }
  }
}
