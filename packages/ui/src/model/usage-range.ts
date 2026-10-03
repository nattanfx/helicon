import type { UsageReport } from "../types.js";

export const USAGE_RANGES = [
  { days: 1, label: "24h" },
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
] as const;

export function rangeLabel(days: number): string {
  return days === 1 ? "24 horas" : `${days} dias`;
}

/** O fuso do navegador, que o servidor usa para agrupar o uso por dia local. */
export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

function dayFormat(timeZone: string): Intl.DateTimeFormat {
  const options = { year: "numeric", month: "2-digit", day: "2-digit" } as const;
  try {
    return new Intl.DateTimeFormat("en-CA", { ...options, timeZone });
  } catch {
    return new Intl.DateTimeFormat("en-CA", { ...options, timeZone: "UTC" });
  }
}

/** O dia (AAAA-MM-DD) de um instante no fuso dado. */
export function calendarDay(date: Date, timeZone = "UTC"): string {
  const parts = dayFormat(timeZone).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * Dias corridos de `since` até hoje (inclusive), no mesmo fuso em que o servidor agrupou o uso,
 * acompanhando a janela móvel do servidor. Sem fuso informado (servidor antigo), UTC.
 */
export function calendarDays(sinceIso: string, until = new Date(), timeZone = "UTC"): string[] {
  const end = calendarDay(until, timeZone);
  const days: string[] = [];
  let cursor = calendarDay(new Date(sinceIso), timeZone);
  while (cursor <= end) {
    days.push(cursor);
    cursor = new Date(Date.parse(`${cursor}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
    if (days.length > 400) {
      break;
    }
  }
  return days;
}

export function fillUsageDays<T extends { day: string }>(
  rows: T[],
  report: Pick<UsageReport, "since" | "days" | "timeZone">,
  blank: (day: string) => T,
  until = new Date(),
): T[] {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  return calendarDays(report.since, until, report.timeZone).map((day) => byDay.get(day) ?? blank(day));
}

/** Rótulo curto de um dia do gráfico: "2026-10-03" vira "03/10". */
export function formatUsageDay(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return match ? `${match[3]}/${match[2]}` : day;
}
