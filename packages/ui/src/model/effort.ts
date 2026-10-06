import type { ModelOption, ReasoningEffort } from "../types.js";

/** O vocabulário de esforço do Muse, do mais rápido ao mais esperto. */
export const EFFORT_ORDER: readonly ReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

const LABELS: Record<ReasoningEffort, string> = {
  none: "Desligado",
  minimal: "Mínimo",
  low: "Baixo",
  medium: "Médio",
  high: "Alto",
  xhigh: "Extra alto",
  max: "Max",
  // O Muse Code 1.3.0 envia "ultra" ao modelo como "max": o nome mostrado é o mesmo.
  ultra: "Max",
};

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && (EFFORT_ORDER as readonly string[]).includes(value);
}

/** O nome em português de um nível; `null` é o Automático. */
export function effortLabel(effort: ReasoningEffort | null): string {
  return effort === null ? "Automático" : LABELS[effort];
}

/**
 * Os níveis que o catálogo diz que o modelo aceita, ou `null` quando ele não declara (modelo fora do catálogo, host
 * antigo ou capacidade `"unknown"`): aí nada é filtrado e tudo segue como antes.
 */
export function supportedEfforts(model: ModelOption | undefined): readonly ReasoningEffort[] | null {
  return model?.efforts ?? null;
}

/** Se o modelo aceita o nível. O Automático sempre vale, e um catálogo que não declara aceita tudo. */
export function effortAccepted(model: ModelOption | undefined, effort: ReasoningEffort | null): boolean {
  const supported = supportedEfforts(model);
  return effort === null || supported === null || supported.includes(effort);
}

/**
 * O nível que substitui um que o modelo não aceita: o mais próximo abaixo dele que o modelo aceita, para nunca
 * pensar mais (e demorar mais) do que o usuário escolheu. Sem nenhum abaixo, o padrão do catálogo; sem ele, o Automático.
 */
export function fallbackEffort(model: ModelOption | undefined, effort: ReasoningEffort): ReasoningEffort | null {
  const supported = supportedEfforts(model);
  if (supported === null || supported.includes(effort)) {
    return effort;
  }
  const rank = EFFORT_ORDER.indexOf(effort);
  for (let i = rank - 1; i >= 0; i--) {
    const below = EFFORT_ORDER[i] as ReasoningEffort;
    if (supported.includes(below)) {
      return below;
    }
  }
  const fallback = model?.defaultEffort ?? null;
  return fallback !== null && supported.includes(fallback) ? fallback : null;
}

/**
 * O que o host disse ao recusar um esforço que o modelo não aceita, como
 * `reasoning_effort 'max' is not supported for model 'muse-spark-1.2'. Supported values: [minimal, low, ...]`.
 */
export interface UnsupportedEffort {
  effort: string;
  modelId: string | null;
  supported: ReasoningEffort[];
}

export function unsupportedEffortError(message: string | null | undefined): UnsupportedEffort | null {
  const text = message ?? "";
  const found = /reasoning[_ ]effort\s+'([^']+)'\s+is not supported(?:\s+for model\s+'([^']+)')?/i.exec(text);
  if (!found) {
    return null;
  }
  const listed = /supported values:\s*\[([^\]]*)\]/i.exec(text)?.[1] ?? "";
  const supported = listed
    .split(",")
    .map((word) => word.trim().replace(/^['"]|['"]$/g, ""))
    .filter(isReasoningEffort);
  return { effort: found[1] as string, modelId: found[2] ?? null, supported };
}
