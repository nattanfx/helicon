import type { AppUpdater } from "@helicon/ui";

/**
 * Este fork não configura endpoints nem artefatos do plug-in de atualização do Tauri.
 * A UI lê versão e canal por `resolveAppIdentity`; atualizar é baixar o instalador no GitHub.
 */
export function desktopUpdater(): AppUpdater | undefined {
  return undefined;
}
