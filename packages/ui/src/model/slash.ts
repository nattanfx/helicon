import type { ApprovalMode, ModelOption, ReasoningEffort, SkillEntry } from "../types.js";

/** O que um comando nativo faz; skills são o outro tipo de comando. */
export type SlashAction = "compact" | "model" | "effort" | "permissions" | "fork" | "new" | "resume" | "init" | "skill" | "goal";

export interface SlashCommand {
  /** Digitado depois da barra. */
  name: string;
  aliases: string[];
  /** Os argumentos que recebe, como `[level]`; nulo quando não recebe nenhum. */
  hint: string | null;
  description: string;
  kind: "action" | "skill";
  action: SlashAction | null;
  skill: SkillEntry | null;
  /** Só funciona dentro de uma conversa, como compactá-la ou ramificá-la. */
  needsThread: boolean;
  /** Escolhê-lo no menu o executa na hora; senão o menu preenche `/nome ` para os argumentos. */
  runsBare: boolean;
}

function builtin(
  name: string,
  action: SlashAction,
  description: string,
  options: { aliases?: string[]; hint?: string; needsThread?: boolean; runsBare?: boolean } = {},
): SlashCommand {
  return {
    name,
    aliases: options.aliases ?? [],
    hint: options.hint ?? null,
    description,
    kind: "action",
    action,
    skill: null,
    needsThread: options.needsThread ?? false,
    runsBare: options.runsBare ?? true,
  };
}

/** Os comandos de terminal do Muse que correspondem ao protocolo de sessão, com o texto dele quando ele tem um. */
export const BUILTIN_COMMANDS: readonly SlashCommand[] = [
  builtin("compact", "compact", "Resumir a conversa para liberar contexto", { needsThread: true }),
  builtin("model", "model", "Escolher o modelo", { aliases: ["models"], hint: "[model]" }),
  builtin("effort", "effort", "Definir quanto tempo o modelo pensa: off, low, medium, high, xhigh, max ou auto", { hint: "[level]" }),
  builtin("permissions", "permissions", "Escolher o que o Muse pode fazer sem perguntar: ask, unlisted, deny ou full", { hint: "[mode]" }),
  builtin("fork", "fork", "Ramificar esta conversa numa nova", { needsThread: true }),
  builtin("new", "new", "Começar uma nova conversa neste projeto", { aliases: ["clear"] }),
  builtin("resume", "resume", "Abrir uma conversa anterior"),
  builtin("init", "init", "Explorar a pasta do projeto e criar ou melhorar o AGENTS.md"),
  builtin("goal", "goal", "Definir uma meta que o Muse continua buscando a cada mensagem, ou pausar, continuar ou limpá-la", {
    hint: "<objective> | pause | resume | clear",
    runsBare: false,
  }),
  builtin("skill", "skill", "Executar uma skill pelo nome", { hint: "<skill> [request]", runsBare: false }),
];

/** Enviado para `/init`; o prompt próprio do terminal não é publicado, então este pede o mesmo resultado. */
export const INIT_PROMPT =
  "Explore this workspace and create or improve its AGENTS.md: what the project is, how to build, run and test it, how the code is organized, and the conventions a coding agent should follow here.";

/** O preâmbulo do terminal para uma skill que o usuário invocou à mão, seguido do corpo da skill. */
export const SKILL_PREAMBLE =
  "Muse Code loaded the full instructions for an explicitly invoked skill. Apply these instructions only to the current user turn.";

/** O `/nome` ao qual uma skill responde: skills de plug-in se chamam `plugin:<plugin>:<skill>`, então a última parte. */
export function shortName(skill: SkillEntry): string {
  return (skill.name.split(":").pop() || skill.name).toLowerCase();
}

/** Uma linha para menus: descrições de skill são escritas para o modelo e são longas. */
export function skillSummary(skill: SkillEntry): string {
  if (skill.shortDescription) {
    return skill.shortDescription;
  }
  const text = skill.description.trim();
  const end = text.search(/[.!?](\s|$)/);
  return end > 0 ? text.slice(0, end + 1) : text;
}

/** Nativos primeiro; cada skill também ganha um atalho `/nome`, a menos que um nativo ou skill anterior tenha esse nome. */
export function slashCommands(skills: readonly SkillEntry[], options: { inThread: boolean }): SlashCommand[] {
  const taken = new Set<string>();
  const commands: SlashCommand[] = [];
  for (const command of BUILTIN_COMMANDS) {
    for (const name of [command.name, ...command.aliases]) {
      taken.add(name);
    }
    if (options.inThread || !command.needsThread) {
      commands.push(command);
    }
  }
  for (const skill of skills) {
    const name = shortName(skill);
    if (taken.has(name)) {
      continue;
    }
    taken.add(name);
    commands.push({
      name,
      aliases: [],
      hint: skill.argumentHint ? skill.argumentHint : "[request]",
      description: skillSummary(skill),
      kind: "skill",
      action: null,
      skill,
      needsThread: false,
      runsBare: false,
    });
  }
  return commands;
}

export interface ParsedSlash {
  name: string;
  args: string;
}

/** `/nome args` bem no início de uma mensagem. Um caminho como `/usr/bin` não é um comando. */
export function parseSlash(text: string): ParsedSlash | null {
  const match = /^\/([A-Za-z0-9][\w:.-]*)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) {
    return null;
  }
  return { name: (match[1] as string).toLowerCase(), args: (match[2] ?? "").trim() };
}

export type ResolvedSlash =
  | { kind: "action"; command: SlashCommand; args: string }
  | { kind: "skill"; skill: SkillEntry; args: string }
  | { kind: "unknown"; name: string };

/** Descobre o que um comando digitado significa. `/skill <nome> …` alcança toda skill, com atalho ou sem. */
export function resolveSlash(parsed: ParsedSlash, commands: readonly SlashCommand[], skills: readonly SkillEntry[]): ResolvedSlash {
  const command = commands.find((c) => c.name === parsed.name || c.aliases.includes(parsed.name));
  if (!command) {
    return { kind: "unknown", name: parsed.name };
  }
  if (command.kind === "skill" && command.skill) {
    return { kind: "skill", skill: command.skill, args: parsed.args };
  }
  if (command.action === "skill") {
    const [first = "", ...rest] = parsed.args.split(/\s+/);
    const wanted = first.replace(/^\//, "").toLowerCase();
    const skill = wanted
      ? (skills.find((s) => s.id.toLowerCase() === wanted) ??
        skills.find((s) => s.name.toLowerCase() === wanted) ??
        skills.find((s) => shortName(s) === wanted))
      : undefined;
    return skill ? { kind: "skill", skill, args: rest.join(" ").trim() } : { kind: "unknown", name: wanted ? `skill ${wanted}` : "skill" };
  }
  return { kind: "action", command, args: parsed.args };
}

/** Menor é melhor; nulo significa sem match. */
function rank(command: SlashCommand, query: string): number | null {
  if (!query) {
    return 0;
  }
  const names = [command.name, ...command.aliases];
  if (names.includes(query)) {
    return 0;
  }
  if (command.name.startsWith(query)) {
    return 1;
  }
  if (command.aliases.some((alias) => alias.startsWith(query))) {
    return 2;
  }
  if (command.name.includes(query)) {
    return 3;
  }
  let at = 0;
  for (const char of command.name) {
    if (char === query[at]) {
      at += 1;
      if (at === query.length) {
        return 4;
      }
    }
  }
  if (query.length >= 3 && command.description.toLowerCase().includes(query)) {
    return 5;
  }
  return null;
}

/**
 * Comandos que combinam com o que vem depois da barra, mantidos em duas sequências (nativos, skills) para o menu agrupá-los.
 * A sequência com o melhor match vem primeiro, então `/thr` põe uma skill chamada threejs acima de um nativo
 * que só combina pela descrição.
 */
export function matchSlash(commands: readonly SlashCommand[], query: string): SlashCommand[] {
  const wanted = query.toLowerCase();
  const runs: Record<SlashCommand["kind"], { command: SlashCommand; score: number; order: number }[]> = { action: [], skill: [] };
  commands.forEach((command, order) => {
    const score = rank(command, wanted);
    if (score !== null) {
      runs[command.kind].push({ command, score, order });
    }
  });
  for (const run of Object.values(runs)) {
    run.sort((a, b) => a.score - b.score || a.order - b.order);
  }
  const best = (kind: SlashCommand["kind"]) => runs[kind][0]?.score ?? Number.POSITIVE_INFINITY;
  const order: SlashCommand["kind"][] = best("skill") < best("action") ? ["skill", "action"] : ["action", "skill"];
  return order.flatMap((kind) => runs[kind].map((entry) => entry.command));
}

/** A mensagem que uma invocação de skill envia: o modelo recebe instruções, a transcrição mostra o que foi digitado. */
export function skillTurn(skill: SkillEntry, args: string, typed: string, body: string | null): { text: string; displayText: string } {
  const request = args.trim();
  if (body !== null) {
    const text = [SKILL_PREAMBLE, `<skill-body id="${skill.id}">\n${body.trim()}\n</skill-body>`, request || "Apply the skill to the conversation so far."].join("\n\n");
    return { text, displayText: typed };
  }
  return {
    text: `Use skill ${skill.id}: call read_skill with name "${skill.id}" first, then apply it to: ${request || "the conversation so far"}`,
    displayText: typed,
  };
}

const EFFORT_WORDS: Record<string, ReasoningEffort | null> = {
  auto: null,
  off: "none",
  none: "none",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  "extra high": "xhigh",
  "extra-high": "xhigh",
  max: "max",
  // O Muse envia "ultra" ao modelo como "max", então a palavra continua funcionando e significa o mesmo.
  ultra: "max",
};

/** `undefined` quando a palavra não é um nível de esforço; `null` significa Auto. */
export function parseEffort(word: string): ReasoningEffort | null | undefined {
  const key = word.trim().toLowerCase();
  return key in EFFORT_WORDS ? EFFORT_WORDS[key] : undefined;
}

const MODE_WORDS: Record<string, ApprovalMode> = {
  ask: "onRequest",
  "ask first": "onRequest",
  onrequest: "onRequest",
  unlisted: "promptUnmatched",
  "ask for unlisted": "promptUnmatched",
  promptunmatched: "promptUnmatched",
  deny: "denyUnmatched",
  "deny unlisted": "denyUnmatched",
  denyunmatched: "denyUnmatched",
  full: "allowAll",
  "full access": "allowAll",
  allowall: "allowAll",
};

export function parseMode(word: string): ApprovalMode | undefined {
  return MODE_WORDS[word.trim().toLowerCase()];
}

/** Um modelo por id ou rótulo de exibição, exato antes de prefixo. */
export function findModel(models: readonly ModelOption[], word: string, label: (id: string) => string): ModelOption | undefined {
  const wanted = word.trim().toLowerCase();
  if (!wanted) {
    return undefined;
  }
  const names = (m: ModelOption) => [m.modelId.toLowerCase(), m.displayLabel.toLowerCase(), label(m.modelId).toLowerCase()];
  return models.find((m) => names(m).includes(wanted)) ?? models.find((m) => names(m).some((n) => n.startsWith(wanted)));
}
