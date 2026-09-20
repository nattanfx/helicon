import { getCurrentWindow } from "@tauri-apps/api/window";
import { browserPlatform, type Platform } from "@helicon/ui";
import { prepareStableFileDrafts } from "./fileDraftsStore.js";

/**
 * Prefs e rascunhos de arquivo no armazenamento local; no desktop, o fechar da janela pode
 * perguntar sem gravar o arquivo original.
 *
 * `beforeDesktopClose` roda antes da decisão de fechar no desktop (que pode esperar); o
 * `beforeunload` do navegador continua síncrono e usa o `localStorage` da origem atual.
 */
export function appPlatform(hooks: { beforeDesktopClose?: () => Promise<void> } = {}): Platform {
  const base = browserPlatform();
  if (!("__TAURI_INTERNALS__" in window) || !base.onBeforeClose) {
    return base;
  }
  const inner = base.onBeforeClose.bind(base);
  return {
    ...base,
    onBeforeClose(handler) {
      const stopBrowser = inner(handler);
      const pending = getCurrentWindow().onCloseRequested(async (event) => {
        await hooks.beforeDesktopClose?.().catch(() => undefined);
        if (!handler({ dialog: true })) {
          event.preventDefault();
        }
      });
      return () => {
        stopBrowser();
        void pending.then(
          (stop) => stop(),
          () => undefined,
        );
      };
    },
  };
}

/**
 * Plataforma com cópia recuperável fora da origem web no desktop (REV5): o cofre estável é lido
 * antes de montar o app, e a fila de escrita é descarregada antes de liberar o fechamento.
 * No navegador puro, devolve a base intacta (`localStorage` da origem, que é estável no browser).
 */
export async function appPlatformWithStableDrafts(): Promise<Platform> {
  let flushStable: () => Promise<void> = () => Promise.resolve();
  const base = appPlatform({ beforeDesktopClose: () => flushStable() });
  const prepared = await prepareStableFileDrafts(base);
  flushStable = prepared.flushStable;
  return prepared.platform;
}
