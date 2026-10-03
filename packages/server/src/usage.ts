import { createHash } from "node:crypto";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** The raw record range survives view cursor regeneration. Token equality is never an identity. */
export function usageIdentity(sessionId: string, params: Record<string, unknown>): { key: string; sourceKey: string | null; legacyKey: string | null } | null {
  const cursor = typeof params["viewCursor"] === "string" && params["viewCursor"] ? params["viewCursor"] : null;
  const source = record(params["sourceRange"]);
  const stream = record(source?.["stream"]);
  const first = record(source?.["first"]);
  const last = record(source?.["last"]);
  const position = (value: Record<string, unknown> | null) => value && typeof value["id"] === "string" && value["id"] && Number.isSafeInteger(value["sequence"]);
  const sourceKey = stream && typeof stream["id"] === "string" && stream["id"] && typeof stream["kind"] === "string" && position(first) && position(last)
    ? createHash("sha256").update(JSON.stringify([stream["kind"], stream["id"], first!["id"], first!["sequence"], last!["id"], last!["sequence"]])).digest("hex")
    : null;
  if (!sourceKey && !cursor) return null;
  return { key: JSON.stringify([sessionId, sourceKey ? "source" : "cursor", sourceKey ?? cursor]), sourceKey, legacyKey: cursor };
}

export function usageSnapshot(payload: unknown): Record<string, unknown> | null {
  const history = record(record(payload)?.["history"]);
  return record(record(record(history?.["snapshot"])?.["state"])?.["tokenUsage"]);
}
