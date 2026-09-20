import { getCurrentWindow } from "@tauri-apps/api/window";
import { browserPlatform, type Platform } from "@helicon/ui";

/**
 * Prefs e rascunhos de arquivo no armazenamento local; no desktop, o fechar da janela pode
 * perguntar sem gravar o arquivo original.
 */
export function appPlatform(): Platform {
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
