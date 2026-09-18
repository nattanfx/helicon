import { invoke } from "@tauri-apps/api/core";

/** Um link web ou de e-mail que pertence fora do Helicon: não o servidor local de onde esta página veio. */
export function externalHref(href: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.protocol === "mailto:") {
    return url.href;
  }
  if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== origin) {
    return url.href;
  }
  return null;
}

/**
 * No app do desktop, um clique simples num link `target="_blank"` nunca chega ao manipulador de nova janela do shell no
 * macOS, então nada abre. Cliques em links externos vão direto para o navegador padrão.
 */
export function bindDesktopLinks(): void {
  if (!("__TAURI_INTERNALS__" in window)) {
    return;
  }
  document.addEventListener(
    "click",
    (event) => {
      if (event.button !== 0 || event.defaultPrevented) {
        return;
      }
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      const href = anchor?.getAttribute("href");
      const target = href ? externalHref(href, window.location.origin) : null;
      if (!target) {
        return;
      }
      event.preventDefault();
      void invoke("plugin:opener|open_url", { url: target }).catch(() => undefined);
    },
    true,
  );
}
