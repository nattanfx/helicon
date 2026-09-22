import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyEvents, emptyFold, type ThreadFold } from "../src/model/fold.js";
import { formatCompactTokens, formatExactTokens, formatTokensPerSecond } from "../src/model/format.js";
import { sessionTelemetry, timePillLabel, usagePillLabel } from "../src/model/usage.js";
import type { ViewEvent } from "../src/types.js";
import { historyEvents } from "./fixtures/probe.js";

function calls(entries: Record<string, unknown>[]): ViewEvent[] {
  return entries.map((params, index) => ({
    method: "session/tokenUsage",
    params: { sessionId: "s1", viewCursor: `v:${index}`, ...params },
  }));
}

function started(turnId: string): ViewEvent {
  return { method: "turn/started", params: { turnId } };
}

function foldWith(events: ViewEvent[]): ThreadFold {
  return applyEvents(emptyFold(), events);
}

describe("telemetria da sessão", () => {
  it("usa o contador de leitura de cache do provedor sem contar duas vezes nem passar do prompt", () => {
    const fold = foldWith(calls([
      { promptTokens: 1000, usage: { outputTokens: 100, cacheReadTokens: 900, cachedTokens: 100 } },
      { promptTokens: 100, usage: { outputTokens: 10, cachedTokens: 500 } },
    ]));
    const t = sessionTelemetry(fold);
    assert.equal(t.cachedTokens, 1000);
    assert.equal(t.cacheHitPct, 91);
  });

  it("mantém os totais acumulados quando só o fim da conversa está carregado", () => {
    const fold = foldWith(calls([
      { promptTokens: 1000, usage: { outputTokens: 100 } },
      {
        promptTokens: 2000,
        usage: { outputTokens: 200 },
        cumulative: { promptTokens: 10000, outputTokens: 1000, totalTokens: 11000 },
      },
    ]));
    const t = sessionTelemetry(fold);
    assert.equal(t.partial, true);
    assert.equal(t.totalsComplete, true);
    assert.equal(t.totalTokens, 11000);
    assert.equal(t.promptTokens, 10000);
    assert.equal(t.outputTokens, 1000);
    assert.match(timePillLabel(t), /Parcial/);
    assert.doesNotMatch(usagePillLabel(t), /Cache/);
    const loadedPrompt = Object.values(fold.meta.calls).reduce((sum, call) => sum + call.promptTokens, 0);
    assert.equal(t.uncachedTokens + t.cachedTokens, loadedPrompt);
  });

  it("marca as contagens como limite inferior quando o histórico truncado não tem totais", () => {
    const t = sessionTelemetry(foldWith(calls([{ promptTokens: 1000, usage: { outputTokens: 100, cachedTokens: 900 } }])), true);
    assert.equal(t.partial, true);
    assert.equal(t.totalsComplete, false);
    assert.equal(usagePillLabel(t), "1.1k+ tokens");
    assert.match(timePillLabel(t), /Parcial/);
  });

  it("separa as contagens de cache carregadas dos totais oficiais da sessão", () => {
    const t = sessionTelemetry(foldWith(calls([{
      promptTokens: 1000,
      usage: { outputTokens: 100, cachedTokens: 900 },
      cumulative: { promptTokens: 10000, outputTokens: 1000, totalTokens: 11000 },
    }])));
    assert.equal(t.totalTokens, 11000);
    assert.equal(t.uncachedTokens, 100);
    assert.equal(t.cachedTokens, 900);
    assert.equal(t.cacheHitPct, 90);
    assert.equal(usagePillLabel(t), "11k tokens");
  });

  it("mantém o uso informado mesmo sem histórico de chamadas", () => {
    const fold = emptyFold();
    fold.meta.tokenTotals = { promptTokens: 900, outputTokens: 100, totalTokens: 1000 };
    const t = sessionTelemetry(fold);
    assert.equal(t.partial, true);
    assert.equal(t.totalsComplete, true);
    assert.equal(t.steps, 0);
    assert.equal(usagePillLabel(t), "1k tokens");
  });

  it("soma todas as chamadas, com velocidade e tempo só das cronometradas", () => {
    const fold = foldWith([
      started("t1"),
      started("t2"),
      started("t3"),
      ...calls([
        { turnId: "t1", durationMs: 1000, usage: { outputTokens: 100 } },
        { turnId: "t1", durationMs: 1000, usage: { outputTokens: 24 } },
        { turnId: "t2", usage: { outputTokens: 40 } },
        { turnId: "t2", usage: { outputTokens: 40 } },
        { turnId: "t2", usage: { outputTokens: 40 } },
        { turnId: "t3", usage: { outputTokens: 40 } },
        { turnId: "t3", usage: { outputTokens: 40 } },
        { turnId: "t3", usage: { outputTokens: 40 } },
      ]),
    ]);
    const t = sessionTelemetry(fold);
    assert.equal(t.turns, 3);
    assert.equal(t.steps, 8);
    assert.equal(t.timedCalls, 2);
    assert.equal(t.durationMs, 2000);
    // 124 tokens de saída nos 2s das chamadas cronometradas; as sem tempo não entram na velocidade.
    assert.equal(t.tokensPerSecond, 62);
    assert.equal(t.outputTokens, 364);
    assert.equal(t.cacheHitPct, null);
  });

  it("lê acerto e escrita de cache dos contadores brutos por chamada", () => {
    const fold = foldWith(
      calls([
        { promptTokens: 100_000, usage: { outputTokens: 10_000, cachedTokens: 87_000, reasoningTokens: 700 } },
        { usage: { outputTokens: 2_000, cacheWriteTokens: 5_000 } },
      ]),
    );
    const t = sessionTelemetry(fold);
    assert.equal(t.promptTokens, 100_000);
    assert.equal(t.cachedTokens, 87_000);
    assert.equal(t.cacheWriteTokens, 5_000);
    assert.equal(t.reasoningTokens, 700);
    assert.equal(t.outputTokens, 12_000);
    assert.equal(t.cacheHitPct, 87);
  });

  it("agrupa saída por modelo, tirando o sufixo de contribuidor na exibição", () => {
    const fold = foldWith(
      calls([
        { modelId: "muse-spark", usage: { outputTokens: 300 } },
        { modelId: "muse-spark", durationMs: 1000, usage: { outputTokens: 100 } },
        { modelId: "muse-spark-contributor", usage: { outputTokens: 50 } },
      ]),
    );
    const t = sessionTelemetry(fold);
    assert.deepEqual(
      t.models.map((model) => ({ name: model.name, calls: model.calls, outputTokens: model.outputTokens })),
      [
        { name: "muse-spark", calls: 2, outputTokens: 400 },
        { name: "muse-spark", calls: 1, outputTokens: 50 },
      ],
    );
  });

  it("conta um turno ao começar, e nada numa conversa vazia", () => {
    const live = sessionTelemetry(foldWith([started("t9")]));
    assert.equal(live.turns, 1);
    assert.equal(live.steps, 0);
    assert.equal(live.tokensPerSecond, null);
    assert.equal(live.cacheHitPct, null);
    const empty = sessionTelemetry(emptyFold());
    assert.equal(empty.turns, 0);
    assert.equal(empty.steps, 0);
    assert.deepEqual(empty.models, []);
  });

  it("acompanha os totais oficiais numa conversa longa do histórico", () => {
    const fold = applyEvents(emptyFold(), historyEvents);
    assert.ok(fold.meta.tokenTotals, "o fixture informa totais acumulados");
    const t = sessionTelemetry(fold);
    assert.equal(t.totalTokens, fold.meta.tokenTotals?.totalTokens);
    assert.equal(t.turns, Object.keys(fold.turns).length);
    assert.ok(t.steps > 0);
  });
});

describe("rótulos das pílulas de telemetria", () => {
  it("rotula a pílula de tempo com turnos, etapas e velocidade, sem velocidade quando nada cronometrou", () => {
    const timed = sessionTelemetry(
      foldWith([
        started("t1"),
        started("t2"),
        started("t3"),
        ...calls([
          { turnId: "t1", durationMs: 1000, usage: { outputTokens: 100 } },
          { turnId: "t1", durationMs: 1000, usage: { outputTokens: 24 } },
          { turnId: "t2", usage: { outputTokens: 40 } },
          { turnId: "t2", usage: { outputTokens: 40 } },
          { turnId: "t2", usage: { outputTokens: 40 } },
          { turnId: "t3", usage: { outputTokens: 40 } },
          { turnId: "t3", usage: { outputTokens: 40 } },
          { turnId: "t3", usage: { outputTokens: 40 } },
        ]),
      ]),
    );
    assert.equal(timePillLabel(timed), "3 turnos · 8 etapas · 62 tok/s");

    const untimed = sessionTelemetry(
      foldWith([
        started("t1"),
        ...calls([
          { turnId: "t1", usage: { outputTokens: 10 } },
          { turnId: "t1", usage: { outputTokens: 10 } },
          { turnId: "t1", usage: { outputTokens: 10 } },
          { turnId: "t1", usage: { outputTokens: 10 } },
        ]),
      ]),
    );
    assert.equal(timePillLabel(untimed), "1 turno · 4 etapas");

    const single = sessionTelemetry(
      foldWith([started("t1"), ...calls([{ turnId: "t1", usage: { outputTokens: 10 } }])]),
    );
    assert.equal(timePillLabel(single), "1 turno · 1 etapa");
  });

  it("rotula a pílula de uso com o total compacto e o cache, quando há dados de cache", () => {
    const cached = sessionTelemetry(
      foldWith(calls([{ promptTokens: 100_000, usage: { outputTokens: 152_000, cachedTokens: 87_000 } }])),
    );
    assert.equal(usagePillLabel(cached), "252k tokens · Cache 87%");

    const uncached = sessionTelemetry(foldWith(calls([{ usage: { outputTokens: 18_400 } }])));
    assert.equal(usagePillLabel(uncached), "18.4k tokens");

    const one = sessionTelemetry(foldWith(calls([{ usage: { outputTokens: 1 } }])));
    assert.equal(usagePillLabel(one), "1 token");
  });
});

describe("formatadores de telemetria", () => {
  it("formata tokens por segundo com uma casa abaixo de 100 e inteiro acima", () => {
    assert.equal(formatTokensPerSecond(62), "62 tok/s");
    assert.equal(formatTokensPerSecond(7.25), "7.3 tok/s");
    assert.equal(formatTokensPerSecond(125.4), "125 tok/s");
  });

  it("formata contagens exatas com separador de milhar", () => {
    assert.equal(formatExactTokens(999), "999");
    assert.equal(formatExactTokens(252_343), "252.343");
    assert.equal(formatExactTokens(1_234_567), "1.234.567");
  });

  it("mantém uma casa nos totais compactos até cem mil", () => {
    assert.equal(formatCompactTokens(364), "364");
    assert.equal(formatCompactTokens(18_400), "18.4k");
    assert.equal(formatCompactTokens(252_000), "252k");
  });
});

describe("padrão das estatísticas da sessão", () => {
  it("fica desligado até ser ligado, em prefs novas e recuperadas", async () => {
    const { defaultPrefs, revivePrefs } = await import("../src/model/store.js");
    assert.equal(defaultPrefs().showTelemetry, false);
    assert.equal(revivePrefs({}, defaultPrefs()).showTelemetry, false);
    assert.equal(revivePrefs({ showTelemetry: true }, defaultPrefs()).showTelemetry, true);
  });
});
