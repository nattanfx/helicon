import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseModelList } from "../src/client.js";
import { applyEvents, emptyFold } from "../src/model/fold.js";
import { formatElapsed, formatSpeed } from "../src/model/format.js";
import { contextBreakdown, contextUsageOf, lastTurnSpeed, sessionUsage, streamingSpeed, turnSpeed, turnSpeeds } from "../src/model/usage.js";
import type { ModelOption, ViewEvent } from "../src/types.js";
import { historyEvents, liveEvents, modelList } from "./fixtures/probe.js";

function tokenUsage(cursor: string, params: Record<string, unknown>): ViewEvent {
  return { method: "session/tokenUsage", params: { sessionId: "s1", turnId: "t1", viewCursor: cursor, ...params } };
}

const PRICED: ModelOption = {
  modelId: "priced",
  displayLabel: "priced",
  description: null,
  isDefault: false,
  isActive: false,
  contextLimit: 1_000_000,
  outputLimit: null,
  cost: { input: 2, output: 8, cached: 0.5, currency: "USD" },
  contributor: false,
};

describe("contexto e uso da sessão", () => {
  it("divide o contexto informado sem inventar nem perder tokens", () => {
    const fold = applyEvents(emptyFold(), liveEvents);
    const breakdown = contextBreakdown(fold, []);
    assert.ok(breakdown);
    const total = breakdown.slices.reduce((sum, slice) => sum + slice.tokens, 0);
    assert.equal(total, breakdown.used);
    assert.equal(breakdown.free, (breakdown.window ?? 0) - breakdown.used);
    assert.ok(breakdown.slices.some((slice) => slice.key === "prompts"));
  });

  it("lê o contexto de uma conversa aberta do histórico de sua última chamada ao modelo", () => {
    const fold = applyEvents(emptyFold(), historyEvents);
    assert.equal(fold.meta.contextUsage, null);
    const usage = contextUsageOf(fold, parseModelList(modelList));
    const last = Object.values(fold.meta.calls).at(-1);
    assert.ok(usage && last);
    assert.equal(usage.usedTokens, last.promptTokens + last.outputTokens);
    assert.equal(usage.windowTokens, 1007997);
  });

  it("conta cada chamada ao modelo uma vez, mesmo quando o histórico é aplicado duas vezes", () => {
    const once = applyEvents(emptyFold(), historyEvents);
    const twice = applyEvents(once, historyEvents);
    const calls = historyEvents.filter((event) => event.method === "session/tokenUsage").length;
    assert.equal(sessionUsage(once, []).calls, calls);
    assert.equal(sessionUsage(twice, []).calls, calls);
    assert.equal(sessionUsage(once, []).totalTokens, once.meta.tokenTotals?.totalTokens);
  });

  it("usa as contagens do patch do Muse no resumo da sessão", () => {
    const fold = applyEvents(emptyFold(), [{
      method: "item/completed",
      params: {
        item: {
          itemId: "patch-1", kind: "toolCall", status: "completed", revision: 1, turnId: "t1",
          tool: "edit", args: JSON.stringify({ path: "a.ts", old_string: "x", new_string: "y" }),
          patchSummary: { files: 2, added: 9, removed: 4 },
          patchRef: { id: "ref-1", kind: "tool_patch", mediaType: "application/json" },
        },
      },
    }]);
    assert.deepEqual(sessionUsage(fold, []).lines, { files: 2, added: 9, removed: 4 });
  });

  it("precifica chamadas pelo catálogo e marca as que não conseguiu precificar", () => {
    const fold = applyEvents(emptyFold(), [
      tokenUsage("v:1", {
        modelId: "priced",
        promptTokens: 1_000_000,
        totalTokens: 1_100_000,
        usage: { inputTokens: 1_000_000, outputTokens: 100_000, cachedTokens: 400_000, reasoningTokens: 0 },
      }),
    ]);
    const priced = sessionUsage(fold, [PRICED]);
    // 600k novos a $2, 400k do cache a $0.50 e 100k de saída a $8, por milhão.
    assert.equal(priced.cost?.toFixed(2), "2.20");
    assert.equal(priced.costComplete, true);
    assert.equal(Math.round((priced.cacheHit ?? 0) * 100), 40);
    assert.equal(sessionUsage(fold, []).cost, null);

    const mixed = applyEvents(fold, [tokenUsage("v:2", { modelId: "free", promptTokens: 10, totalTokens: 12, usage: { outputTokens: 2 } })]);
    assert.equal(sessionUsage(mixed, [PRICED]).costComplete, false);
  });

  it("mede a velocidade de saída de uma mensagem sobre suas chamadas ao modelo, ignorando chamadas minúsculas", () => {
    const fold = applyEvents(emptyFold(), [
      tokenUsage("v:1", { turnId: "t1", promptTokens: 100, totalTokens: 400, durationMs: 3500, usage: { outputTokens: 300 } }),
      { method: "turn/completed", params: { turnId: "t1", terminal: "completed", timeToFirstTokenMs: 500 } },
      tokenUsage("v:2", { turnId: "t2", promptTokens: 100, totalTokens: 105, durationMs: 1000, usage: { outputTokens: 5 } }),
      tokenUsage("v:3", { turnId: "t2", promptTokens: 100, totalTokens: 300, durationMs: 4000, usage: { outputTokens: 200 } }),
      { method: "turn/completed", params: { turnId: "t2", terminal: "completed", timeToFirstTokenMs: 800 } },
    ]);
    // 300 tokens sobre os 3.5 s da chamada; o tempo de primeiro token da mensagem não é descontado.
    assert.equal(Math.round(turnSpeed(fold, "t1")?.tokensPerSecond ?? 0), 86);
    // A chamada de 5 tokens é pequena demais para contar, então só restam os 200 tokens sobre 4 s.
    assert.equal(Math.round(turnSpeed(fold, "t2")?.tokensPerSecond ?? 0), 50);
    assert.equal(Math.round(lastTurnSpeed(fold)?.tokensPerSecond ?? 0), 50);
    assert.deepEqual(Object.keys(turnSpeeds(fold)).sort(), ["t1", "t2"]);
    assert.equal(formatSpeed(42.4), "42 tok/s");
    assert.equal(formatSpeed(7.25), "7.3 tok/s");
    assert.deepEqual([formatElapsed(42_000), formatElapsed(7 * 60_000), formatElapsed(67 * 60_000)], ["42s", "7min", "1h 7min"]);
  });

  it("estima velocidade ao vivo por rajada de texto transmitido", () => {
    const delta = (at: number, text: string, field = "text"): ViewEvent => ({
      method: "item/delta",
      params: { itemId: "a1", turnId: "t1", field, delta: text },
      at,
    });
    let fold = applyEvents(emptyFold(), [{ method: "turn/started", params: { turnId: "t1" }, at: 0 }, delta(1000, "x".repeat(400)), delta(3000, "x".repeat(400))]);
    // 800 caracteres são uns 200 tokens, sobre dois segundos.
    assert.equal(Math.round(streamingSpeed(fold.turns["t1"]) ?? 0), 100);
    fold = applyEvents(fold, [delta(9000, "x".repeat(40)), delta(9500, "tool text", "output")]);
    assert.equal(fold.turns["t1"]?.stream?.chars, 40, "uma pausa longa começa uma rajada nova, e saída de ferramenta não é texto de modelo");
  });

  it("apaga a velocidade ao vivo quando a rajada esfria", () => {
    const delta = (at: number, text: string): ViewEvent => ({
      method: "item/delta",
      params: { itemId: "a1", turnId: "t1", field: "text", delta: text },
      at,
    });
    const fold = applyEvents(emptyFold(), [
      { method: "turn/started", params: { turnId: "t1" }, at: 0 },
      delta(1000, "x".repeat(400)),
      delta(3000, "x".repeat(400)),
    ]);
    const info = fold.turns["t1"];
    assert.ok(streamingSpeed(info, 3500) !== null, "rajada recente ainda mede");
    assert.equal(streamingSpeed(info, 5001), null, "2 s sem delta encerram a leitura em vez de congelá-la");
    assert.ok(streamingSpeed(info) !== null, "sem relógio, mantém o comportamento antigo");
  });

  it("só conta o que resta no contexto após uma compactação", () => {
    const events: ViewEvent[] = [
      { method: "item/completed", params: { item: { itemId: "u1", kind: "userMessage", status: "completed", revision: 1, text: "x".repeat(4000) } } },
      {
        method: "item/completed",
        params: { item: { itemId: "c1", kind: "compaction", status: "completed", revision: 1, outcome: "compacted", trigger: "manual", tokensBefore: 5000, tokensAfter: 300 } },
      },
      { method: "item/completed", params: { item: { itemId: "u2", kind: "userMessage", status: "completed", revision: 1, text: "y".repeat(400) } } },
      { method: "session/contextUsage", params: { usedTokens: 2000, windowTokens: 10_000, pressure: "normal" } },
    ];
    const fold = applyEvents(emptyFold(), events);
    const breakdown = contextBreakdown(fold, []);
    assert.equal(breakdown?.slices.find((slice) => slice.key === "prompts")?.tokens, 100);
    assert.equal(breakdown?.slices.find((slice) => slice.key === "summary")?.tokens, 300);
    assert.equal(breakdown?.slices.find((slice) => slice.key === "system")?.tokens, 1600);
    assert.deepEqual(sessionUsage(fold, []).compactions, [{ itemId: "c1", trigger: "manual", outcome: "compacted", before: 5000, after: 300 }]);
  });
});
