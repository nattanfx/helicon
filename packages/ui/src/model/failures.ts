import type { FailureEntry, FailureKind } from "../types.js";

const KNOWN_KINDS: readonly string[] = [
  "turn-failed",
  "turn-view-failed",
  "turn-view-recovered",
  "host-exited",
  "host-start-failed",
  "host-restarted",
];

export const FAILURE_KIND_LABEL: Readonly<Record<FailureKind, string>> = {
  "turn-failed": "turno falhou",
  "turn-view-failed": "falha ao ler o turno",
  "turn-view-recovered": "turno recuperado",
  "host-exited": "servidor Muse saiu",
  "host-start-failed": "servidor Muse não iniciou",
  "host-restarted": "servidores reiniciados",
};

/** Interpreta a resposta de `GET /api/failures`; linhas desconhecidas são ignoradas, nunca quebram a tela. */
export function parseFailures(value: unknown): { count: number; recent: FailureEntry[] } {
  const root = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const count = typeof root["count"] === "number" && Number.isFinite(root["count"]) ? Math.max(0, Math.floor(root["count"])) : 0;
  const list = Array.isArray(root["recent"]) ? root["recent"] : [];
  const recent: FailureEntry[] = [];
  for (const item of list) {
    const entry = parseFailureEntry(item);
    if (entry) {
      recent.push(entry);
    }
  }
  return { count, recent };
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseFailureEntry(value: unknown): FailureEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const r = value as Record<string, unknown>;
  const kind = asString(r["kind"]);
  if (!kind || !KNOWN_KINDS.includes(kind)) {
    return null;
  }
  return {
    at: asString(r["at"]) ?? "",
    kind: kind as FailureKind,
    sessionId: asString(r["sessionId"]),
    turnId: asString(r["turnId"]),
    hostKey: asString(r["hostKey"]),
    errorKind: asString(r["errorKind"]),
    message: asString(r["message"]),
  };
}

/** Uma linha de falha em texto legível, para o diagnóstico do Sobre. */
export function formatFailureEntry(entry: FailureEntry): string {
  const time = entry.at ? new Date(entry.at).toLocaleString("pt-BR", { hour12: false }) : "data desconhecida";
  const ids = [entry.sessionId ? `sessão ${entry.sessionId.slice(0, 8)}` : null, entry.turnId ? `turno ${entry.turnId.slice(0, 8)}` : null]
    .filter((part): part is string => part !== null)
    .join(" · ");
  const kind = entry.errorKind ? ` (${entry.errorKind})` : entry.kind === "turn-failed" ? " (kind=ausente)" : "";
  return `${time} ${FAILURE_KIND_LABEL[entry.kind]}${kind}${ids ? ` · ${ids}` : ""}${entry.message ? ` · ${entry.message}` : ""}`;
}
