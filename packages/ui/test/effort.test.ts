import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseModelList } from "../src/client.js";
import { effortAccepted, effortLabel, fallbackEffort, unsupportedEffortError } from "../src/model/effort.js";
import { turnErrorCopy } from "../src/model/errors.js";
import { applyEvents, emptyFold, foldFromLoad } from "../src/model/fold.js";
import type { ViewEvent } from "../src/types.js";

const fold = (events: ViewEvent[]) => applyEvents(emptyFold(), events);
const foldWithLoad = (reasoningEffort: string | null) =>
  foldFromLoad({
    session: null,
    msp: { status: "idle", activeTurnId: null, modelId: "muse-spark-1.2", approvalMode: null, workspaceRoot: null, turnCount: 0, reasoningEffort },
    events: [],
    truncated: false,
    pending: { approvals: [], userInputs: [] },
    readOnly: false,
    readOnlyReason: null,
  });

const HOST_ERROR =
  "API error 400 Bad Request: reasoning_effort 'max' is not supported for model 'muse-spark-1.2'. Supported values: [minimal, low, medium, high, xhigh] (invalid_request_error)";

describe("níveis de esforço do catálogo", () => {
  it("lê os níveis declarados e o padrão de cada modelo", () => {
    const [declared, unknown, old] = parseModelList({
      models: [
        { modelId: "muse-spark-1.2", variants: ["minimal", "low", "medium", "high", "xhigh", "bogus"], defaultReasoningEffort: "medium" },
        { modelId: "muse-x", variants: "unknown" },
        { modelId: "muse-old" },
      ],
    });
    assert.deepEqual(declared?.efforts, ["minimal", "low", "medium", "high", "xhigh"]);
    assert.equal(declared?.defaultEffort, "medium");
    assert.equal(unknown?.efforts, null, "\"unknown\" não declara nada");
    assert.equal(old?.efforts, null, "host antigo sem a lista");
    assert.equal(old?.defaultEffort, null);
  });

  it("aceita tudo quando o catálogo não declara, e sempre o Automático", () => {
    const [spark, legacy] = parseModelList({
      models: [{ modelId: "muse-spark-1.2", variants: ["minimal", "low", "medium", "high", "xhigh"] }, { modelId: "muse-old" }],
    });
    assert.equal(effortAccepted(spark, "max"), false);
    assert.equal(effortAccepted(spark, "xhigh"), true);
    assert.equal(effortAccepted(spark, null), true);
    assert.equal(effortAccepted(legacy, "max"), true);
    assert.equal(effortAccepted(undefined, "max"), true, "modelo fora do catálogo");
  });

  it("troca por o nível aceito mais próximo abaixo, depois pelo padrão, depois pelo Automático", () => {
    const [spark, fast, bare] = parseModelList({
      models: [
        { modelId: "muse-spark-1.2", variants: ["minimal", "low", "medium", "high", "xhigh"] },
        { modelId: "muse-fast", variants: ["high", "xhigh"], defaultReasoningEffort: "high" },
        { modelId: "muse-bare", variants: ["high"] },
      ],
    });
    assert.equal(fallbackEffort(spark, "max"), "xhigh");
    assert.equal(fallbackEffort(spark, "ultra"), "xhigh");
    assert.equal(fallbackEffort(spark, "none"), null);
    assert.equal(fallbackEffort(fast, "low"), "high");
    assert.equal(fallbackEffort(bare, "low"), null);
    assert.equal(fallbackEffort(spark, "medium"), "medium", "aceito fica como está");
  });

  it("dá nome em português a cada nível", () => {
    assert.equal(effortLabel("xhigh"), "Extra alto");
    assert.equal(effortLabel("max"), "Max");
    assert.equal(effortLabel(null), "Automático");
  });
});

describe("recusa de esforço pelo host", () => {
  it("lê o nível, o modelo e os níveis aceitos da mensagem do host", () => {
    assert.deepEqual(unsupportedEffortError(HOST_ERROR), {
      effort: "max",
      modelId: "muse-spark-1.2",
      supported: ["minimal", "low", "medium", "high", "xhigh"],
    });
    assert.equal(unsupportedEffortError("API error 400: something else"), null);
  });

  it("explica em português, oferece trocar o esforço e guarda o texto do host na linha técnica", () => {
    const copy = turnErrorCopy("providerError", HOST_ERROR, false);
    assert.equal(copy.title, "Este modelo não aceita o esforço escolhido");
    assert.match(copy.explanation, /O muse-spark-1\.2 não aceita o esforço Max/);
    assert.match(copy.explanation, /Ele aceita: Mínimo, Baixo, Médio, Alto, Extra alto\./);
    assert.equal(copy.action, "effort");
    assert.equal(copy.offerRetry, true);
    assert.match(copy.technical ?? "", /reasoning_effort 'max' is not supported/);
  });

  it("nomeia o modelo de contribuidor pelo nome de exibição", () => {
    const copy = turnErrorCopy(null, HOST_ERROR.replace("muse-spark-1.2", "muse-spark-1.2-contributor"), false);
    assert.match(copy.explanation, /O muse-spark-1\.2 não aceita/);
  });
});

describe("padrão permanente de esforço da conversa", () => {
  it("vem do retrato da sessão e dos eventos de mudança", () => {
    assert.equal(foldWithLoad("max").meta.effort, "max");
    assert.equal(foldWithLoad(null).meta.effort, null);
    assert.equal(fold([{ method: "session/reasoningEffortChanged", params: { reasoningEffort: "high", source: "user" } }]).meta.effort, "high");
    assert.equal(fold([{ method: "session/reasoningEffortChanged", params: { reasoningEffort: "nonsense" } }]).meta.effort, null);
  });
});
