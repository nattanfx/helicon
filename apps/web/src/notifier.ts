import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import type { Notifier, NotifyPermission } from "@helicon/ui";

function asPermission(value: string): NotifyPermission {
  return value === "granted" || value === "denied" ? value : "default";
}

/**
 * Notificações pela API do próprio navegador. Todo mecanismo relevante a suporta, e cada um é
 * particular a respeito: a permissão só é concedida a partir de um clique real, e o Safari ainda exige um
 * contexto seguro. Nada aqui jamais pergunta por conta própria por esse motivo.
 */
function browserNotifier(): Notifier | undefined {
  if (typeof Notification === "undefined") {
    return undefined;
  }
  const read = (): NotifyPermission => asPermission(Notification.permission);
  return {
    label: "navegador",
    permission: async () => read(),
    async request() {
      // Todo navegador recusa uma segunda pergunta, e a resposta já é conhecida nessa altura mesmo.
      if (read() !== "default") {
        return read();
      }
      try {
        return asPermission(await Notification.requestPermission());
      } catch {
        return "denied";
      }
    },
    async show({ title, body, tag }) {
      // A `tag` substitui um aviso anterior sobre a mesma conversa em vez de empilhar mais um.
      new Notification(title, { body, tag });
    },
  };
}

/**
 * A do shell do desktop, pelo plug-in de notificações do Tauri. Uma webview não carrega a
 * API do navegador de forma confiável, então no desktop é esta que de fato alcança o SO.
 */
function desktopNotifier(): Notifier {
  return {
    label: "desktop",
    startupRequest: true,
    async permission() {
      try {
        return (await isPermissionGranted()) ? "granted" : "default";
      } catch {
        return "denied";
      }
    },
    async request() {
      try {
        return asPermission(await requestPermission());
      } catch {
        return "denied";
      }
    },
    async show({ title, body }) {
      // O plug-in não tem noção de substituir um aviso anterior, então a janela de repetição do próprio gerenciador
      // é a única coisa impedindo uma conversa de empilhar.
      sendNotification({ title, body });
    },
  };
}

/** Qualquer um dos dois que este shell de fato tenha. */
export function appNotifier(): Notifier | undefined {
  return "__TAURI_INTERNALS__" in window ? desktopNotifier() : browserNotifier();
}
