import type { UpdateState } from "./updates.js";

export interface SettingsSectionDef {
  id: string;
  title: string;
}

/** As seções da página de Configurações, na ordem em que aparecem. Título mora aqui, e só aqui. */
export const SETTINGS_SECTIONS: readonly SettingsSectionDef[] = [
  { id: "aparencia", title: "Aparência" },
  { id: "novas-conversas", title: "Novas conversas" },
  { id: "lista-de-conversas", title: "Lista de conversas" },
  { id: "chats-arquivados", title: "Chats arquivados" },
  { id: "titulos-das-conversas", title: "Títulos das conversas" },
  { id: "modo-yolo", title: "Modo YOLO" },
  { id: "sandbox", title: "Sandbox" },
  { id: "aprovacoes", title: "Aprovações" },
  { id: "notificacoes", title: "Notificações" },
  { id: "versao", title: "Versão" },
  { id: "atualizacoes", title: "Atualizações" },
  { id: "ambiente", title: "Ambiente" },
];

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

export function settingsSectionTitle(id: string): string {
  const found = SETTINGS_SECTIONS.find((section) => section.id === id);
  if (!found) {
    throw new Error(`Unknown settings section: ${id}`);
  }
  return found.title;
}

/** Atualizações só existe quando o shell se atualiza sozinho; neste fork, nunca. */
export function visibleSettingsSections(updates: UpdateState | null): readonly SettingsSectionDef[] {
  return updates ? SETTINGS_SECTIONS : SETTINGS_SECTIONS.filter((section) => section.id !== "atualizacoes");
}
