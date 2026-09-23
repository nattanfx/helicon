import type {
  ApprovalMode,
  EnvironmentStatus,
  FileContent,
  FileEntry,
  FileListing,
  GoalAction,
  HeliconEvent,
  IfBusy,
  ModelOption,
  OutgoingAttachment,
  OutputRange,
  PlanUsage,
  ProjectView,
  ReasoningEffort,
  SandboxSettings,
  SessionSummary,
  SkillCatalog,
  SubagentAction,
  TaskAction,
  TitleSettings,
  TranscriptLoad,
  UserInputAnswer,
  WorkflowAction,
} from "./types.js";
import { listedPrice } from "./model/pricing.js";

/** Um erro do servidor Helicon, carregando o tipo de erro MSP quando há um. */
export class HeliconError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: string | null = null,
  ) {
    super(message);
    this.name = "HeliconError";
  }
}

export function errorKind(error: unknown): string | null {
  return error instanceof HeliconError ? error.kind : null;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export type EventHandler = (event: HeliconEvent) => void;

export interface TurnOptions {
  ifBusy?: IfBusy;
  reasoningEffort?: ReasoningEffort;
  /** O que a transcrição mostra no lugar do texto que o modelo recebe, como `/plan tidy the API`. */
  displayText?: string;
  /** Arquivos que o usuário anexou: imagens chegam ao modelo, o resto cai na pasta do projeto como menção. */
  attachments?: OutgoingAttachment[];
}

export interface ApprovalDecisionInput {
  sessionId: string;
  approvalId: string;
  requirementId: unknown;
  choiceId: string;
  feedback?: string | null;
}

/** Tudo que a UI precisa de um transporte. Os shells web e de desktop implementam via REST e SSE. */
export interface HeliconClient {
  probeEnvironment(refresh?: boolean): Promise<EnvironmentStatus>;
  listProjects(): Promise<ProjectView[]>;
  /** `create` cria a pasta antes quando ela não existe. */
  addProject(cwd: string, options?: { create?: boolean }): Promise<{ cwd: string; warning: string | null }>;
  cloneProject(url: string, path: string): Promise<{ cwd: string; warning: string | null }>;
  listDirectory(path: string): Promise<import("./types.js").DirectoryListing>;
  /** Abre uma pasta no gerenciador de arquivos do SO. */
  revealPath(path: string): Promise<void>;
  hideProject(cwd: string): Promise<void>;
  setPinned(cwd: string, pinned: boolean): Promise<void>;
  /** A ordem em que o usuário arrastou os projetos da lateral. */
  setProjectOrder(cwds: string[]): Promise<void>;
  /** Uso de tokens em toda conversa que o servidor viu, para a página de uso. */
  usage(days?: number): Promise<import("./types.js").UsageReport>;
  listSessions(options?: { archived?: boolean }): Promise<SessionSummary[]>;
  discover(cwd?: string): Promise<void>;
  startSession(cwd: string, options?: { approvalMode?: ApprovalMode; modelId?: string }): Promise<SessionSummary>;
  loadTranscript(sessionId: string): Promise<TranscriptLoad>;
  /**
   * Um caminho do servidor que o navegador carrega sozinho, como os bytes de um anexo, retornado com a
   * autenticação das próprias chamadas do cliente: um servidor protegido por token recusa um sem ela.
   */
  assetUrl(path: string): string;
  updateSession(sessionId: string, patch: { title?: string; archived?: boolean; settled?: boolean }): Promise<SessionSummary | null>;
  /** `attachments` voltam salvos, para a conversa aberta mostrá-los sem esperar recarregar. */
  sendTurn(
    sessionId: string,
    text: string,
    options?: TurnOptions,
  ): Promise<{ turnId: string | null; disposition: string | null; attachments?: import("./types.js").AttachmentView[] }>;
  interruptTurn(sessionId: string, turnId?: string): Promise<void>;
  unqueueTurn(sessionId: string, turnId: string): Promise<void>;
  decideApproval(input: ApprovalDecisionInput): Promise<void>;
  answerUserInput(sessionId: string, userInputId: string, answers: UserInputAnswer[]): Promise<void>;
  cancelUserInput(sessionId: string, userInputId: string): Promise<void>;
  clarifyUserInput(sessionId: string, userInputId: string, content: string): Promise<void>;
  listModels(sessionId?: string): Promise<ModelOption[]>;
  getTitleSettings(): Promise<TitleSettings>;
  setTitleSettings(patch: { enabled?: boolean; modelId?: string | null }): Promise<TitleSettings>;
  getSandboxSettings(): Promise<SandboxSettings>;
  setSandboxSettings(patch: { disabled?: boolean }): Promise<SandboxSettings>;
  setSessionModel(sessionId: string, modelId: string): Promise<void>;
  setApprovalMode(sessionId: string, mode: ApprovalMode): Promise<void>;
  /** `noop` quando o Muse não tinha nada para resumir; `reason` é sua explicação em snake_case. */
  compact(sessionId: string): Promise<{ noop: boolean; reason: string | null }>;
  /** Roda um comando de shell na pasta do projeto da sessão; sua saída chega como item `userShell`. */
  runShell(sessionId: string, command: string): Promise<void>;
  /** Roda um comando `!` na pasta do projeto pelo próprio Helicon, para hosts que não conseguem rodar um. */
  runShellProxy(sessionId: string, command: string): Promise<import("./types.js").ShellRun>;
  /** Ramifica uma conversa numa nova levando toda mensagem concluída. */
  forkSession(sessionId: string): Promise<SessionSummary>;
  /** Com uma sessão carregada, a lista do próprio Muse para ela; senão, a lista da pasta do projeto via CLI. */
  listSkills(cwd: string, sessionId?: string): Promise<SkillCatalog>;
  /** As instruções completas de uma skill, sem seu frontmatter. */
  skillBody(cwd: string, skillId: string): Promise<string>;
  openFolder(cwd: string, target: "files" | "editor"): Promise<void>;
  /** O esforço de raciocínio vigente da sessão, que é o que o Muse aplica às suas mensagens. */
  setReasoningEffort(sessionId: string, effort: ReasoningEffort): Promise<void>;
  /** `set` e `edit` precisam do objetivo. Um verbo que acorda uma mensagem retorna seu id. */
  goal(sessionId: string, action: GoalAction, objective?: string): Promise<{ turnId: string | null }>;
  /** Um controle num item `subagent`. `body` é o texto da mensagem ou da tarefa de acompanhamento. */
  subagent(sessionId: string, action: SubagentAction, subagentId: string, options?: { reason?: string; body?: string }): Promise<void>;
  /** `background` e `stop` pegam o id do item da chamada de ferramenta; `stopAll` para toda tarefa de fundo na sessão. */
  task(sessionId: string, action: TaskAction, taskId?: string): Promise<void>;
  /** `cancel` para a execução; `skip` e `retry` agem num filho na sua tentativa atual. */
  workflow(sessionId: string, action: WorkflowAction, workflowRunId: string, child?: { childId: string; attempt: number }): Promise<void>;
  /** Uma página da saída completa guardada de uma ferramenta, de `offset` bytes em diante. */
  readOutput(sessionId: string, itemId: string, outputRef: string, offset?: number): Promise<OutputRange>;
  /** A janela de assinatura que o Muse viu por último; null até um host ver uma. */
  planUsage(): Promise<PlanUsage | null>;
  /** Uma pasta de um projeto, pastas primeiro. `path` é relativo ao projeto; "" é sua raiz. */
  listFiles(cwd: string, path: string): Promise<FileListing>;
  /** Um arquivo de projeto: texto embutido, mídia descrita. `path` também pode ser absoluto dentro do projeto. */
  readFile(cwd: string, path: string): Promise<FileContent>;
  /** Salva o texto de volta. Recusado com tipo `fileChanged` quando o arquivo avançou desde `baseMtimeMs`. */
  writeFile(cwd: string, path: string, content: string, baseMtimeMs: number | null): Promise<{ path: string; size: number; mtimeMs: number }>;
  /** Arquivos cujo caminho contém toda palavra de `query`. */
  searchFiles(cwd: string, query: string): Promise<FileEntry[]>;
  /** Abre um arquivo de projeto no app padrão do SO. */
  openFileExternally(cwd: string, path: string): Promise<void>;
  /** De onde o navegador carrega os bytes de um arquivo de projeto, para imagens, vídeo, áudio e PDFs. */
  fileUrl(cwd: string, path: string): string;
  /** Assina eventos do servidor; retorna uma função de descadastramento. */
  subscribe(handler: EventHandler): () => void;
}

/** Interpreta as configurações de títulos; respostas inválidas usam o padrão ativado, sem modelo escolhido. */
export function parseTitleSettings(value: unknown): TitleSettings {
  const r = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    enabled: typeof r["enabled"] === "boolean" ? r["enabled"] : true,
    modelId: typeof r["modelId"] === "string" && r["modelId"].trim() ? r["modelId"] : null,
  };
}

/** Interpreta o endpoint de sandbox; respostas inválidas usam a sandbox ligada. */
export function parseSandboxSettings(value: unknown): SandboxSettings {
  const r = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    disabled: r["disabled"] === true,
  };
}

/** Interpreta um resultado bruto de `model/list` em opções do seletor. */
export function parseModelList(value: unknown): ModelOption[] {
  const root = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const list = Array.isArray(root["models"]) ? root["models"] : Array.isArray(value) ? value : [];
  const options: ModelOption[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const r = entry as Record<string, unknown>;
    const modelId = typeof r["modelId"] === "string" ? r["modelId"] : null;
    if (!modelId) {
      continue;
    }
    const description = typeof r["description"] === "string" ? r["description"] : null;
    options.push({
      modelId,
      displayLabel: typeof r["displayLabel"] === "string" && r["displayLabel"] ? r["displayLabel"] : modelId,
      description,
      isDefault: r["isDefault"] === true,
      isActive: r["isActive"] === true,
      contextLimit: typeof r["contextLimit"] === "number" ? r["contextLimit"] : null,
      outputLimit: typeof r["outputLimit"] === "number" ? r["outputLimit"] : null,
      // O catálogo do Muse não traz preços hoje, então a tabela publicada o substitui quando ele não lista nenhum.
      cost: parseCost(r["cost"]) ?? listedPrice(modelId),
      contributor: /contributor/i.test(modelId) || /product improvement/i.test(description ?? ""),
    });
  }
  return options;
}

/** Preços do catálogo chegam como strings decimais por milhão de tokens. */
function parseCost(value: unknown): ModelOption["cost"] {
  if (!value || typeof value !== "object") {
    return null;
  }
  const r = value as Record<string, unknown>;
  const amount = (v: unknown): number | null => {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
    return Number.isFinite(n) ? n : null;
  };
  const input = amount(r["input"]);
  const output = amount(r["output"]);
  if (input === null || output === null) {
    return null;
  }
  return { input, output, cached: amount(r["cached"]) ?? input, currency: typeof r["currency"] === "string" ? r["currency"] : null };
}
