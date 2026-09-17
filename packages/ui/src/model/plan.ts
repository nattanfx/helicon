import type { PlanUsage, PlanWindow } from "../types.js";
import { formatDuration, humanize } from "./format.js";
import type { ThreadFold } from "./fold.js";

export type PlanTone = "ok" | "warn" | "danger";

export interface PlanRow {
  key: "window" | "weekly";
  label: string;
  percent: number;
  tone: PlanTone;
  /** "Renova em 2h 14min", ou "Renovou" quando o horário passou e o Muse ainda não informou a nova janela. */
  resets: string;
}

export interface PlanView {
  /** O nome do plano quando o Muse dá um legível; o Muse 1.3.0 manda um id numérico opaco, que é omitido. */
  tier: string | null;
  rows: PlanRow[];
  /** Quando o Muse viu estes números pela última vez; eles só mudam quando uma chamada ao modelo os informa. */
  observedAtMs: number;
  /** Verdadeiro quando a leitura está velha o bastante para o medidor real provavelmente já ter andado. */
  stale: boolean;
  /** Há quanto tempo o Muse informou isto, pronto para ler: "agora", "4min", "2h". */
  age: string;
}

/** Passado isto a leitura é apontada como velha, embora sua idade apareça desde o primeiro minuto de todo jeito. */
const STALE_MS = 30 * 60 * 1000;

const MINUTE_MS = 60 * 1000;

/** A idade da leitura, curta o bastante para ficar ao lado do próprio número. */
export function planAge(observedAtMs: number, now: number): string {
  const ms = Math.max(0, now - observedAtMs);
  if (ms < MINUTE_MS) {
    return "agora";
  }
  const minutes = Math.floor(ms / MINUTE_MS);
  if (minutes < 60) {
    return `${minutes}min`;
  }
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function tone(percent: number): PlanTone {
  return percent >= 90 ? "danger" : percent >= 70 ? "warn" : "ok";
}

function windowLabel(window: PlanWindow): string {
  const minutes = window.windowDurationMins;
  if (!minutes) {
    return "Janela atual";
  }
  return minutes % 60 === 0 ? `Janela de ${minutes / 60}h` : `Janela de ${minutes}min`;
}

const HOUR_MS = 60 * 60 * 1000;

/** Horas e minutos para a janela de hoje, dias e horas para o teto semanal: "77h" diz menos que "3d 5h". */
export function formatReset(ms: number): string {
  if (ms < 48 * HOUR_MS) {
    return formatDuration(ms);
  }
  const hours = Math.floor(ms / HOUR_MS);
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest === 0 ? `${days}d` : `${days}d ${rest}h`;
}

function row(key: PlanRow["key"], label: string, window: PlanWindow, now: number): PlanRow {
  const percent = Math.max(0, Math.min(100, Math.round(window.usedPercent)));
  const left = window.resetsAtMs - now;
  return { key, label, percent, tone: tone(percent), resets: left > 0 ? `Renova em ${formatReset(left)}` : "Renovou" };
}

/** O medidor de plano como a UI o mostra: a janela curta e o teto semanal, cada um com quanto falta para renovar. */
export function planView(usage: PlanUsage | null, now: number): PlanView | null {
  if (!usage) {
    return null;
  }
  return {
    tier: /^[a-z][a-z0-9_ -]{0,31}$/i.test(usage.tier) ? humanize(usage.tier) : null,
    rows: [row("window", windowLabel(usage.window), usage.window, now), row("weekly", "Semanal", usage.weekly, now)],
    observedAtMs: usage.observedAtMs,
    stale: now - usage.observedAtMs > STALE_MS,
    age: planAge(usage.observedAtMs, now),
  };
}

/** Chamadas de ferramenta numa conversa ainda executando em segundo plano, que `task/stopAll` pararia. */
export function backgroundTasks(fold: ThreadFold): string[] {
  const ids: string[] = [];
  for (const id of fold.order) {
    const item = fold.items[id];
    if (item?.kind === "toolCall" && item.background === true && item.status === "inProgress") {
      ids.push(id);
    }
  }
  return ids;
}
