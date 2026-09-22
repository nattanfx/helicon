import type { ApprovalRequest, MspItem, SessionSummary } from "../types.js";
import { GOAL_TOOLS } from "./goal.js";

/** Tempo relativo compacto para barras laterais: agora, 4min, 3h, 2d, 3sem, depois uma data curta. */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) {
    return "";
  }
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return "";
  }
  const seconds = Math.max(0, (now - then) / 1000);
  if (seconds < 45) {
    return "agora";
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}min`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.round(hours / 24);
  if (days < 7) {
    return `${days}d`;
  }
  const weeks = Math.round(days / 7);
  if (weeks < 5) {
    return `${weeks}sem`;
  }
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) {
    return "";
  }
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 1) {
    return "menos de 1s";
  }
  if (total < 60) {
    return `${total}s`;
  }
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) {
    return seconds === 0 ? `${minutes}min` : `${minutes}min ${seconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}min`;
}

/** Um horário curto: `15:42` hoje, `10 de set., 15:42` em outro dia, com o ano quando difere. */
export function formatClock(ms: number, now = Date.now()): string {
  const date = new Date(ms);
  const today = new Date(now);
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === today.toDateString()) {
    return time;
  }
  const sameYear = date.getFullYear() === today.getFullYear();
  const day = date.toLocaleDateString(undefined, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  return `${day}, ${time}`;
}

/** A data e hora completas, para dicas atrás de um horário curto. */
export function formatFullDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
}

/** Velocidade de saída: `42 tok/s`, com uma casa decimal abaixo de dez. */
export function formatSpeed(tokensPerSecond: number): string {
  return `${tokensPerSecond < 10 ? tokensPerSecond.toFixed(1) : Math.round(tokensPerSecond)} tok/s`;
}

/** Velocidade média da sessão para as pílulas de telemetria: uma casa abaixo de 100, inteiro de lá pra cima. */
export function formatTokensPerSecond(tokensPerSecond: number): string {
  const value = tokensPerSecond < 100 ? tokensPerSecond.toFixed(1).replace(/\.0$/, "") : String(Math.round(tokensPerSecond));
  return `${value} tok/s`;
}

/** Um cronômetro correndo como o T3 Code mostra: `42s`, depois `7min`, depois `1h 7min`. */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}min`;
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
}

export function formatTokens(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "0";
  }
  if (value < 1000) {
    return String(Math.round(value));
  }
  if (value < 1_000_000) {
    const k = value / 1000;
    return `${k < 10 ? k.toFixed(1).replace(/\.0$/, "") : Math.round(k)}k`;
  }
  const m = value / 1_000_000;
  return `${m < 10 ? m.toFixed(1).replace(/\.0$/, "") : Math.round(m)}M`;
}

/** Uma contagem exata de tokens com separador de milhar, para o diálogo de uso. */
export function formatExactTokens(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "0";
  }
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Tokens compactos para as pílulas de telemetria: como formatTokens, mas com uma casa até as
 * dezenas de milhar, para uma sessão com 18.400 tokens ler `18.4k` em vez de `18k`.
 */
export function formatCompactTokens(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "0";
  }
  if (value >= 1000 && value < 100_000) {
    return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return formatTokens(value);
}

export function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || trimmed;
}

/** Mantém o fim de um caminho longo legível: `D:\...\helicon\packages\ui`. */
export function shortenPath(path: string, max = 48): string {
  if (path.length <= max) {
    return path;
  }
  const separator = path.includes("\\") ? "\\" : "/";
  const parts = path.split(/[\\/]/);
  let tail = parts.pop() ?? "";
  while (parts.length > 1) {
    const next = parts[parts.length - 1] as string;
    if ((next + separator + tail).length + 4 > max) {
      break;
    }
    tail = next + separator + tail;
    parts.pop();
  }
  const head = parts[0] ?? "";
  return `${head}${separator}...${separator}${tail}`;
}

/** Palavras de status conhecidas, para `humanize` as mostrar em português; o resto segue mecânico. */
const KNOWN_WORDS: Record<string, string> = {
  failed: "falhou",
  rejected: "rejeitado",
  cancelled: "cancelado",
  "timed out": "estourou o tempo",
  completed: "concluído",
  "in progress": "em execução",
  pending: "pendente",
  queued: "na fila",
  running: "executando",
  approved: "aprovado",
  denied: "negado",
  skipped: "ignorado",
  "tool call": "chamada de ferramenta",
};

const ANSI_PATTERN = `${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`;

/**
 * The last non-blank line of a (possibly huge) output, scanned from the end so a running tool
 * row's preview costs its tail rather than the whole log on every flush.
 */
export function lastLine(text: string | undefined): string | null {
  if (!text) {
    return null;
  }
  const ansi = new RegExp(ANSI_PATTERN, "g");
  let end = text.length;
  while (end > 0) {
    let lineEnd = end;
    if (text[lineEnd - 1] === "\n") {
      lineEnd -= 1;
    }
    if (lineEnd === 0) {
      return null;
    }
    const lineStart = text.lastIndexOf("\n", lineEnd - 1) + 1;
    const line = text.slice(lineStart, lineEnd).replace(ansi, "").trim();
    if (line) {
      return line;
    }
    if (lineStart === 0) {
      return null;
    }
    end = lineStart;
  }
  return null;
}

export function humanize(identifier: string): string {
  const spaced = identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-./]+/g, " ")
    .trim()
    .toLowerCase();
  const known = KNOWN_WORDS[spaced];
  const words = known ?? spaced;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function parseArgs(args: string | undefined): Record<string, unknown> | null {
  if (!args) {
    return null;
  }
  try {
    const parsed = JSON.parse(args) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function pickString(args: Record<string, unknown> | null, keys: string[]): string | null {
  if (!args) {
    return null;
  }
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

export type ToolKind =
  | "shell"
  | "read"
  | "edit"
  | "write"
  | "search"
  | "list"
  | "web"
  | "question"
  | "plan"
  | "agent"
  | "goal"
  | "generic";

const PATH_KEYS = ["path", "file_path", "filePath", "filename", "file", "target_file", "targetFile"];
const PATTERN_KEYS = ["pattern", "query", "regex", "search", "q"];

/** Classifica uma ferramenta pelas palavras em seu nome, para `frobnicate` nunca parecer `cat`. */
export function toolKind(tool: string | undefined, args: Record<string, unknown> | null): ToolKind {
  // As ferramentas de meta do Muse, verificadas primeiro para `create_goal` nunca parecer escrita de arquivo.
  if (tool && GOAL_TOOLS.has(tool)) {
    return "goal";
  }
  const words = new Set(
    (tool ?? "")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
  const has = (...candidates: string[]) => candidates.some((c) => words.has(c));
  if (has("ask", "question", "questions") || (has("user") && has("input"))) {
    return "question";
  }
  if (has("todo", "todos", "plan", "todowrite")) {
    return "plan";
  }
  if (has("web", "websearch", "webfetch", "fetch", "http", "browse", "browser", "url")) {
    return "web";
  }
  if (pickString(args, ["command", "cmd"]) || has("bash", "shell", "exec", "execute", "run", "terminal", "powershell", "sh", "cmd")) {
    return "shell";
  }
  if (has("grep", "search", "find", "glob", "rg", "ripgrep")) {
    return "search";
  }
  if (has("edit", "multiedit", "patch", "replace", "apply", "modify")) {
    return "edit";
  }
  if (has("write", "create", "save")) {
    return "write";
  }
  if (has("read", "view", "cat", "open")) {
    return "read";
  }
  if (has("list", "ls", "dir", "tree")) {
    return "list";
  }
  if (has("agent", "task", "subagent", "delegate", "spawn")) {
    return "agent";
  }
  return "generic";
}

export interface ToolDescription {
  kind: ToolKind;
  /** Verbo de início de frase para o estado atual: "Executou", "Executando", "Leu"... */
  verb: string;
  /** Em que a ferramenta agiu: um comando, caminho, padrão ou URL. */
  subject: string | null;
  /** Mostra o assunto na fonte de código. */
  mono: boolean;
  /** Explicação opcional escrita pelo modelo, ex. `description` do bash. */
  note: string | null;
}

const VERBS: Record<ToolKind, [string, string]> = {
  shell: ["Executou", "Executando"],
  read: ["Leu", "Lendo"],
  edit: ["Editou", "Editando"],
  write: ["Escreveu", "Escrevendo"],
  search: ["Buscou", "Buscando"],
  list: ["Listou", "Listando"],
  web: ["Buscou", "Buscando"],
  question: ["Perguntou", "Perguntando"],
  plan: ["Atualizou o plano", "Atualizando o plano"],
  agent: ["Delegou", "Delegando"],
  goal: ["Atualizou a meta", "Atualizando a meta"],
  generic: ["Usou", "Usando"],
};

export function describeTool(item: MspItem): ToolDescription {
  const args = parseArgs(item.args);
  const kind = toolKind(item.tool, args);
  const running = item.status === "inProgress";
  const verb = VERBS[kind][running ? 1 : 0];
  const note = pickString(args, ["description", "reason", "explanation"]);
  switch (kind) {
    case "shell":
      return { kind, verb, subject: pickString(args, ["command", "cmd"]) ?? item.args ?? null, mono: true, note };
    case "read":
    case "edit":
    case "write":
    case "list":
      return { kind, verb, subject: pickString(args, PATH_KEYS) ?? pickString(args, ["directory", "dir"]), mono: true, note };
    case "search": {
      const pattern = pickString(args, PATTERN_KEYS);
      return { kind, verb, subject: pattern, mono: true, note: pickString(args, PATH_KEYS) ?? note };
    }
    case "web": {
      const url = pickString(args, ["url", "uri"]);
      if (url) {
        return { kind, verb, subject: url, mono: true, note };
      }
      return {
        kind,
        verb: running ? "Buscando na web por" : "Buscou na web por",
        subject: pickString(args, PATTERN_KEYS),
        mono: false,
        note,
      };
    }
    case "question": {
      const questions = args && Array.isArray(args["questions"]) ? (args["questions"] as Record<string, unknown>[]) : [];
      const first = questions[0];
      return {
        kind,
        verb,
        subject: first && typeof first["question"] === "string" ? first["question"] : null,
        mono: false,
        note: null,
      };
    }
    case "plan":
      return { kind, verb, subject: null, mono: false, note };
    case "agent":
      return { kind, verb, subject: pickString(args, ["description", "prompt", "objective", "task"]), mono: false, note: null };
    case "goal": {
      if (item.tool === "create_goal") {
        return { kind, verb: running ? "Definindo uma meta" : "Definiu uma meta", subject: pickString(args, ["objective"]), mono: false, note: null };
      }
      if (item.tool === "report_progress") {
        const percent = args && typeof args["percent_complete"] === "number" ? `${Math.round(args["percent_complete"])}%` : null;
        return {
          kind,
          verb: running ? "Reportando progresso" : "Reportou progresso",
          subject: percent,
          mono: false,
          note: pickString(args, ["current_work", "next_work"]),
        };
      }
      if (item.tool === "update_goal") {
        const status = pickString(args, ["status"]);
        return {
          kind,
          verb: running ? "Atualizando a meta" : "Marcou a meta",
          subject: status === "complete" ? "concluída" : status,
          mono: false,
          note: null,
        };
      }
      return { kind, verb: running ? "Verificando a meta" : "Verificou a meta", subject: null, mono: false, note: null };
    }
    default: {
      const firstString = args ? Object.values(args).find((v): v is string => typeof v === "string" && v.length < 160) : null;
      return {
        kind,
        verb: running ? "Usando" : "Usou",
        subject: item.tool ? humanize(item.tool) : "uma ferramenta",
        mono: false,
        note: firstString ?? null,
      };
    }
  }
}

export interface DiffRow {
  kind: "same" | "del" | "add";
  text: string;
}

export interface DiffHunk {
  rows: DiffRow[];
}

export type DiffView = { path: string | null; hunks: DiffHunk[] } | { path: string | null; patch: string };

function lines(value: unknown): string[] {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").split("\n") : [];
}

/** Limite de pares de linhas antes de exibir dois blocos sem alinhamento. */
export const ALIGN_CELL_LIMIT = 250_000;

/**
 * Alinha as linhas antigas e novas de uma edição como um diff faz: linhas sem mudança aparecem como contexto em vez
 * de mostrar como removidas e readicionadas, que é o que as linhas de preenchimento do bloco find fariam.
 */
export function alignLines(removed: string[], added: string[]): DiffRow[] {
  if (removed.length === 0) {
    return added.map((text) => ({ kind: "add" as const, text }));
  }
  if (added.length === 0) {
    return removed.map((text) => ({ kind: "del" as const, text }));
  }
  // The table below costs a cell per old/new pair, and a running edit's diff is recomputed on every
  // flush: past this many cells a giant edit would eat the frame budget on its own, so it reads as
  // one removed block followed by one added block instead of an aligned diff. Nothing is dropped.
  if (removed.length * added.length > ALIGN_CELL_LIMIT) {
    return [
      ...removed.map((text) => ({ kind: "del" as const, text })),
      ...added.map((text) => ({ kind: "add" as const, text })),
    ];
  }
  const width = added.length + 1;
  const table = new Uint32Array((removed.length + 1) * width);
  for (let i = 1; i <= removed.length; i += 1) {
    for (let j = 1; j <= added.length; j += 1) {
      table[i * width + j] =
        removed[i - 1] === added[j - 1]
          ? (table[(i - 1) * width + (j - 1)] as number) + 1
          : Math.max(table[(i - 1) * width + j] as number, table[i * width + (j - 1)] as number);
    }
  }
  const rows: DiffRow[] = [];
  let i = removed.length;
  let j = added.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && removed[i - 1] === added[j - 1]) {
      rows.push({ kind: "same", text: removed[i - 1] as string });
      i -= 1;
      j -= 1;
      // Empates voltam pelas adições primeiro, para deleções aparecerem antes delas indo adiante.
    } else if (j > 0 && (i === 0 || (table[i * width + (j - 1)] as number) >= (table[(i - 1) * width + j] as number))) {
      rows.push({ kind: "add", text: added[j - 1] as string });
      j -= 1;
    } else {
      rows.push({ kind: "del", text: removed[i - 1] as string });
      i -= 1;
    }
  }
  return rows.reverse();
}

interface EchoBlock {
  removed: string[];
  added: string[];
}

/**
 * Separa o(s) eco(s) de edição do runtime da frente do resultado de uma ferramenta. Nulo quando a saída não é
 * um eco; uma linha em branco solta conta para ambos os lados, já que nenhum prefixo diz qual lado a soltou.
 */
function splitDiffEcho(output: string): { blocks: EchoBlock[]; rest: string } | null {
  const echoLines = output.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  const blocks: EchoBlock[] = [];
  for (;;) {
    const head = echoLines.slice(i, i + 5);
    if (
      head.length < 5 ||
      !/^edited\b/.test(head[0] as string) ||
      !(head[1] as string).startsWith("changed lines:") ||
      head[2] !== "--- original" ||
      head[3] !== "+++ updated" ||
      !(head[4] as string).startsWith("@@")
    ) {
      break;
    }
    i += 5;
    const block: EchoBlock = { removed: [], added: [] };
    while (i < echoLines.length) {
      const line = echoLines[i] as string;
      if (line.startsWith("+")) {
        block.added.push(line.slice(1));
      } else if (line.startsWith("-")) {
        block.removed.push(line.slice(1));
      } else if (line === "") {
        block.removed.push("");
        block.added.push("");
      } else if (!line.startsWith("\\ No newline")) {
        break;
      }
      i += 1;
    }
    blocks.push(block);
  }
  if (blocks.length === 0) {
    return null;
  }
  return { blocks, rest: echoLines.slice(i).join("\n") };
}

/**
 * Tira o eco de edição do runtime do resultado de uma ferramenta, deixando o resto que ele trouxe. Nulo
 * quando a saída não é um eco, para chamadores seguirem mostrando esses; "" quando é só o eco,
 * que o diff do próprio recibo já mostra melhor.
 */
export function withoutDiffEcho(output: string): string | null {
  return splitDiffEcho(output)?.rest ?? null;
}

/** Monta o diff do recibo a partir do eco do resultado, para quando os argumentos não trazem a mudança. */
export function diffFromEcho(output: string, path: string | null): DiffView | null {
  const echo = splitDiffEcho(output);
  if (!echo) {
    return null;
  }
  const hunks = echo.blocks.map((block) => ({ rows: alignLines(block.removed, block.added) }));
  if (!hunks.some((hunk) => hunk.rows.length > 0)) {
    return null;
  }
  return { path, hunks };
}

/** Puxa um diff revisável de uma chamada de ferramenta estilo edição, quando seus argumentos trazem um. */
export function extractDiff(item: MspItem): DiffView | null {
  const args = parseArgs(item.args);
  if (!args) {
    return null;
  }
  const path = pickString(args, PATH_KEYS);
  const oldKey = ["old_string", "oldString", "old_str", "find", "search", "old"].find((k) => typeof args[k] === "string");
  const newKey = ["new_string", "newString", "new_str", "replace", "new"].find((k) => typeof args[k] === "string");
  if (oldKey && newKey) {
    return { path, hunks: [{ rows: alignLines(lines(args[oldKey]), lines(args[newKey])) }] };
  }
  if (Array.isArray(args["edits"])) {
    const hunks: DiffHunk[] = [];
    for (const edit of args["edits"] as unknown[]) {
      const e = edit && typeof edit === "object" ? (edit as Record<string, unknown>) : null;
      if (!e) {
        continue;
      }
      const o = e["old_string"] ?? e["oldString"] ?? e["old_str"];
      const n = e["new_string"] ?? e["newString"] ?? e["new_str"];
      if (typeof o === "string" || typeof n === "string") {
        hunks.push({ rows: alignLines(lines(o), lines(n)) });
      }
    }
    if (hunks.length > 0) {
      return { path, hunks };
    }
  }
  const patch = pickString(args, ["patch", "diff", "input"]);
  if (patch && /^(\*\*\* |--- |\+\+\+ |@@|diff --git)/m.test(patch)) {
    return { path, patch };
  }
  const content = pickString(args, ["content", "contents", "text", "file_text"]);
  if (content && toolKind(item.tool, args) === "write") {
    return { path, hunks: [{ rows: alignLines([], lines(content)) }] };
  }
  // Último recurso: o resultado ecoa a mudança mesmo quando os argumentos não a nomeiam, então uma forma
  // de ferramenta desconhecida ainda renderiza um diff alinhado em vez do eco cru.
  if (item.visibleOutput && !item.truncated) {
    const kind = toolKind(item.tool, args);
    if (kind === "edit" || kind === "write") {
      return diffFromEcho(item.visibleOutput, path);
    }
  }
  return null;
}

export function diffStats(diff: DiffView): { added: number; removed: number } {
  if ("patch" in diff) {
    let added = 0;
    let removed = 0;
    for (const line of diff.patch.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        added += 1;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        removed += 1;
      }
    }
    return { added, removed };
  }
  let added = 0;
  let removed = 0;
  for (const hunk of diff.hunks) {
    for (const row of hunk.rows) {
      if (row.kind === "add") {
        added += 1;
      } else if (row.kind === "del") {
        removed += 1;
      }
    }
  }
  return { added, removed };
}

export interface DiffLine {
  kind: "add" | "del" | "ctx" | "meta";
  text: string;
}

/** Achata um diff em linhas renderizáveis, marcando os vãos entre seus hunks. */
export function diffLines(diff: DiffView): DiffLine[] {
  const lines: DiffLine[] = [];
  if ("patch" in diff) {
    for (const line of diff.patch.split("\n")) {
      if (/^(\+\+\+|---|\*\*\*|@@|diff )/.test(line)) {
        lines.push({ kind: "meta", text: line });
      } else if (line.startsWith("+")) {
        lines.push({ kind: "add", text: line.slice(1) });
      } else if (line.startsWith("-")) {
        lines.push({ kind: "del", text: line.slice(1) });
      } else {
        lines.push({ kind: "ctx", text: line.startsWith(" ") ? line.slice(1) : line });
      }
    }
    return lines;
  }
  diff.hunks.forEach((hunk, index) => {
    if (index > 0) {
      lines.push({ kind: "meta", text: "..." });
    }
    for (const row of hunk.rows) {
      lines.push({ kind: row.kind === "same" ? "ctx" : row.kind, text: row.text });
    }
  });
  return lines;
}

/** Junta os diffs de um arquivo num fluxo único contínuo de linhas, em ordem de mensagem. */
export function mergeDiffLines(diffs: DiffView[]): DiffLine[] {
  const lines: DiffLine[] = [];
  diffs.forEach((diff, index) => {
    if (index > 0) {
      lines.push({ kind: "meta", text: "..." });
    }
    lines.push(...diffLines(diff));
  });
  return lines;
}

export interface ApprovalDescription {
  title: string;
  detail: string | null;
  mono: boolean;
}

export function describeApproval(request: ApprovalRequest): ApprovalDescription {
  const subject = request.subject ?? { kind: "tool" };
  const stagesCommand = subject.stages?.map((s) => s.argv.join(" ")).join(" | ");
  switch (subject.kind) {
    case "shell":
      return { title: "Executar um comando shell", detail: subject.command ?? stagesCommand ?? request.rawArgs ?? null, mono: true };
    case "fileAccess": {
      const access = subject.access ? subject.access.toLowerCase() : "access";
      const verb = access.includes("write") ? "Escrever em" : access.includes("read") ? "Ler" : "Acessar";
      return { title: `${verb} um arquivo`, detail: subject.path ?? subject.target ?? null, mono: true };
    }
    case "network": {
      const target = subject.host
        ? `${subject.protocol ? `${subject.protocol}://` : ""}${subject.host}${subject.port ? `:${subject.port}` : ""}`
        : (subject.target ?? null);
      return { title: "Conectar à rede", detail: target, mono: true };
    }
    case "process":
      return { title: "Iniciar um processo", detail: subject.command ?? subject.target ?? stagesCommand ?? null, mono: true };
    case "tool":
      return {
        title: `Usar a ferramenta ${humanize(subject.toolName ?? request.toolName ?? "tool").toLowerCase()}`,
        detail: request.rawArgs ?? null,
        mono: true,
      };
    default:
      return {
        title: `Permitir ${humanize(subject.kind).toLowerCase()}`,
        detail: subject.command ?? subject.path ?? subject.target ?? request.rawArgs ?? null,
        mono: true,
      };
  }
}

/** Título para exibir: placeholder vira "Nova conversa"; manual "New thread" é preservado pela origem. */
export function displayTitle(session: Pick<SessionSummary, "title" | "titleSource">): string {
  return session.titleSource === "placeholder" ? "Nova conversa" : session.title;
}

/** Tira o sufixo de nível do provedor para exibição; o nível ganha seu próprio selo. */
export function modelDisplayName(modelId: string | null | undefined): string {
  if (!modelId) {
    return "Modelo padrão";
  }
  return modelId.replace(/-contributor$/i, "");
}

/**
 * Rótulo único do nível Contributor do catálogo. Não inventa política da Meta nem preço:
 * só o que `ModelOption.contributor` significa no tipo.
 */
export const CONTRIBUTOR_LABEL = "Contribuidor";
export const CONTRIBUTOR_NOTICE =
  "Pedidos e respostas podem ser usados para melhoria do produto.";

export function contributorChoiceLabel(modelId: string): string {
  return `${modelDisplayName(modelId)} · ${CONTRIBUTOR_LABEL}`;
}
