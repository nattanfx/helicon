import { invoke } from "@tauri-apps/api/core";
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
    async show({ title, body, tag, silent }) {
      // A `tag` substitui um aviso anterior sobre a mesma conversa em vez de empilhar mais um.
      new Notification(title, { body, tag, silent });
    },
  };
}

/** Toast nativo pelo shell: no Windows sai com o som do sistema, como no Grok. */
async function nativeToast(title: string, body: string, silent: boolean): Promise<unknown> {
  return invoke("helicon_notify_toast", { title, body, silent });
}

/** Som do sistema sem balão, pelo shell. */
async function nativeSound(): Promise<unknown> {
  return invoke("helicon_notify_sound");
}

/**
 * A do shell do desktop: tenta o toast nativo com som e cai para o `sendNotification` do
 * plug-in quando o nativo falha (outra plataforma, comando ausente). Uma webview não carrega a
 * API do navegador de forma confiável, então no desktop é uma destas que de fato alcança o SO.
 * O mostrador e o som recebem imitações nos testes.
 */
export function desktopNotifier(
  notify: (title: string, body: string, silent: boolean) => Promise<unknown> = nativeToast,
  system: () => Promise<unknown> = nativeSound,
): Notifier {
  let path = "plugin";
  return {
    label: "desktop",
    startupRequest: true,
    get lastShowPath() {
      return path;
    },
    systemSound: async () => {
      await system();
    },
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
    async show({ title, body, silent }) {
      // O plug-in não tem noção de substituir um aviso anterior, então a janela de repetição do próprio gerenciador
      // é a única coisa impedindo uma conversa de empilhar.
      try {
        await notify(title, body, silent === true);
        path = "nativo";
      } catch {
        path = "plugin";
        sendNotification({ title, body });
      }
    },
  };
}

/** Qualquer um dos dois que este shell de fato tenha. */
export function appNotifier(): Notifier | undefined {
  return "__TAURI_INTERNALS__" in window ? desktopNotifier() : browserNotifier();
}
