import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import type { AppUpdater } from "@helicon/ui";

// O plug-in espera para sempre por padrão, e um download travado seguraria toda ação de atualização posterior.
const CHECK_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;

/** O atualizador do shell do desktop, pelo plug-in de atualização do Tauri; indefinido no navegador. */
export function desktopUpdater(): AppUpdater | undefined {
  if (!("__TAURI_INTERNALS__" in window)) {
    return undefined;
  }
  let pending: Update | null = null;
  return {
    currentVersion: () => getVersion(),
    async check() {
      const update = await check({ timeout: CHECK_TIMEOUT_MS });
      if (pending && pending !== update) {
        pending.close().catch(() => undefined);
      }
      pending = update;
      return update ? { version: update.version, notes: update.body?.trim() || null, date: update.date ?? null } : null;
    },
    async download(onProgress) {
      if (!pending) {
        throw new Error("Não há atualização para baixar.");
      }
      let total: number | null = null;
      let received = 0;
      await pending.download(
        (event) => {
          if (event.event === "Started") {
            total = event.data.contentLength ?? null;
            onProgress(total ? 0 : null);
          } else if (event.event === "Progress") {
            received += event.data.chunkLength;
            onProgress(total ? Math.min(1, received / total) : null);
          } else {
            onProgress(1);
          }
        },
        { timeout: DOWNLOAD_TIMEOUT_MS },
      );
    },
    async install({ restart }) {
      if (!pending) {
        throw new Error("Não há atualização baixada para instalar.");
      }
      await pending.install({ restartAfterInstall: restart });
    },
    relaunch: () => relaunch(),
    onClose(handler) {
      // A janela espera o manipulador e fecha; instalar no Windows sai do app primeiro.
      const unlisten = getCurrentWindow().onCloseRequested(async () => {
        await handler();
      });
      return () => {
        unlisten.then(
          (stop) => stop(),
          () => undefined,
        );
      };
    },
  };
}
