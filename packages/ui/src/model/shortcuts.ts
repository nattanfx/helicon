/** Atalhos de teclado do app, para a seção de referência rápida. `mod` é Ctrl ou Cmd; espelha GlobalShortcuts e o composer. */
export interface ShortcutDef {
  id: string;
  label: string;
  /** Teclas na ordem de aperto; "mod" resolve para Ctrl/Cmd, "ArrowUp"/"ArrowDown" para setas. */
  keys: readonly string[];
  scope: "Geral" | "Composer";
}

export const SHORTCUTS: readonly ShortcutDef[] = [
  { id: "paleta", label: "Abrir a paleta de comandos", keys: ["mod", "K"], scope: "Geral" },
  { id: "nova-conversa", label: "Nova conversa", keys: ["mod", "Shift", "O"], scope: "Geral" },
  { id: "barra-lateral", label: "Mostrar ou ocultar a barra lateral", keys: ["mod", "B"], scope: "Geral" },
  { id: "arquivos", label: "Mostrar ou ocultar o painel de arquivos", keys: ["mod", "Shift", "E"], scope: "Geral" },
  { id: "conversa-anterior", label: "Conversa anterior", keys: ["Alt", "ArrowUp"], scope: "Geral" },
  { id: "conversa-seguinte", label: "Conversa seguinte", keys: ["Alt", "ArrowDown"], scope: "Geral" },
  { id: "zoom-ampliar", label: "Ampliar a interface", keys: ["mod", "+"], scope: "Geral" },
  { id: "zoom-reduzir", label: "Reduzir a interface", keys: ["mod", "−"], scope: "Geral" },
  { id: "zoom-redefinir", label: "Redefinir o zoom para 100%", keys: ["mod", "0"], scope: "Geral" },
  { id: "enviar", label: "Enviar a mensagem", keys: ["Enter"], scope: "Composer" },
  { id: "nova-linha", label: "Nova linha no composer", keys: ["Shift", "Enter"], scope: "Composer" },
  { id: "parar", label: "Parar o turno (composer vazio, conversa rodando)", keys: ["Esc"], scope: "Composer" },
];

const KEY_LABELS: Readonly<Record<string, string>> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  Escape: "Esc",
};

/** "mod+K" no Windows/Linux, "⌘K" no Mac; setas e Escape ganham forma curta. */
export function formatShortcutKeys(keys: readonly string[], mac: boolean): string {
  return keys
    .map((key) => {
      if (key === "mod") {
        return mac ? "⌘" : "Ctrl";
      }
      return KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key);
    })
    .join(mac ? "" : "+");
}
