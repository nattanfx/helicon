import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { WindowFrame } from "@helicon/ui";

declare global {
  interface Window {
    /** Definido pelo shell do desktop antes da página carregar quando a janela não tem barra de título nativa. */
    __HELICON_FRAME__?: string;
    /** Definido pelo shell do desktop antes da página carregar quando os semáforos do macOS flutuam sobre a interface. */
    __HELICON_TITLEBAR__?: string;
  }
  interface WindowEventMap {
    "helicon-zoom": CustomEvent<number>;
    "helicon-zoom-step": CustomEvent<"in" | "out" | "reset">;
  }
}

/** Verdadeiro no macOS, onde o shell do desktop sobrepõe os semáforos à barra lateral. */
export function titlebarOverlay(): boolean {
  return window.__HELICON_TITLEBAR__ === "overlay";
}

/**
 * O zoom do desktop tem que passar pela webview, não pelo `zoom` do CSS no <html>: senão a WKWebView desloca
 * todo menu Radix com `position: fixed`. Não faz nada num navegador. Chamar uma vez na inicialização.
 */
export function bindDesktopZoom(): void {
  if (!("__TAURI_INTERNALS__" in window)) {
    return;
  }
  const apply = (zoom: number) => {
    getCurrentWebview()
      .setZoom(zoom)
      .catch((error: unknown) => console.error("Helicon: webview zoom failed", error));
  };
  window.addEventListener("helicon-zoom", (event) => apply(event.detail));
  void listen<"in" | "out" | "reset">("helicon://zoom", (event) => {
    window.dispatchEvent(new CustomEvent("helicon-zoom-step", { detail: event.payload }));
  }).catch((error: unknown) => console.error("Helicon: zoom menu listen failed", error));
}

/** Controles de janela para a janela sem moldura do shell do desktop; indefinido num navegador. */
export function desktopFrame(): WindowFrame | undefined {
  if (window.__HELICON_FRAME__ !== "custom") {
    return undefined;
  }
  const win = getCurrentWindow();
  const run = (action: Promise<unknown>) => {
    action.catch((error: unknown) => console.error("Helicon: window control failed", error));
  };
  return {
    minimize: () => run(win.minimize()),
    toggleMaximize: () => run(win.toggleMaximize()),
    close: () => run(win.close()),
    startDragging: () => run(win.startDragging()),
    isMaximized: () => win.isMaximized(),
    onResized: (callback) => {
      const pending = win.onResized(() => callback());
      return () => {
        pending.then(
          (unlisten) => unlisten(),
          () => undefined,
        );
      };
    },
  };
}
