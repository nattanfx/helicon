import { it } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ControllerProvider } from "../src/app/context.js";
import { UsageResults } from "../src/components/usage/UsagePage.js";
import { TooltipProvider } from "../src/components/ui/overlays.js";
import type { ModelOption, UsageBucket, UsageReport } from "../src/types.js";

const bucket: UsageBucket = { day: "2026-10-01", modelId: "priced", calls: 1, promptTokens: 1_000_000, outputTokens: 0, cachedTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, durationMs: 0 };
const report: UsageReport = { since: "2026-10-01T00:00:00Z", days: 1, buckets: [bucket], threads: [],
  undated: { buckets: [{ ...bucket, day: null, promptTokens: 2_000_000 }], threads: [{ sessionId: "deleted", title: "Gone", cwd: null, deleted: true, calls: 1, promptTokens: 2_000_000, outputTokens: 0, cachedTokens: 0, modelIds: ["priced"], lastAt: null }] },
  recovery: [{ sessionId: "snapshot", complete: false, reason: "Só o consumo acumulado está disponível.", promptTokens: 9_000_000, outputTokens: 0, recordedPromptTokens: 0, recordedOutputTokens: 0 }],
};
const models = [{ modelId: "priced", cost: { input: 1, output: 2, cached: 0.5, currency: "USD" } }] as ModelOption[];

function render(value: UsageReport) {
  return renderToStaticMarkup(<ControllerProvider controller={{ openThread: () => { throw new Error("deleted thread must not open"); } } as never}>
    <TooltipProvider><UsageResults report={value} models={models} /></TooltipProvider>
  </ControllerProvider>);
}

it("renders unknown dates separately from the period and never prices snapshot-only consumption", () => {
  const html = render(report);
  const datedEnd = html.indexOf("Consumo sem data conhecida");
  const partialStart = html.indexOf("Consumo com detalhamento incompleto");
  assert.match(html.slice(0, datedEnd), /US\$ 1,00/);
  assert.doesNotMatch(html.slice(0, datedEnd), />US\$ 2,00<|>US\$ 9,00</);
  assert.match(html.slice(datedEnd, partialStart), /US\$ 2,00/);
  assert.match(html.slice(datedEnd, partialStart), /data desconhecida/);
  assert.match(html.slice(datedEnd, partialStart), /Conversa excluída/);
  assert.doesNotMatch(html.slice(datedEnd, partialStart), /<button|Custo por dia/);
  assert.match(html.slice(partialStart), /9M tokens de entrada/);
  assert.doesNotMatch(html.slice(partialStart), /US\$ 9,00/);
});

it("names calls without a model in Portuguese and labels chart days as dia/mês", () => {
  const html = render({ ...report, buckets: [{ ...bucket, modelId: "unknown" }], undated: undefined, recovery: [] });
  assert.match(html, /Modelo desconhecido/);
  assert.doesNotMatch(html, />unknown</);
  assert.match(html, /<span>01\/10<\/span>/);
  assert.doesNotMatch(html, /2026-10-01/);
});

it("shows preserved undated usage and incomplete evidence even with an empty selected period", () => {
  const html = render({ ...report, buckets: [] });
  assert.match(html, /Nenhuma chamada com data conhecida neste período/);
  assert.match(html, /Consumo sem data conhecida/);
  assert.match(html, /Consumo com detalhamento incompleto/);
  assert.doesNotMatch(html, /Custo por dia/);
});
