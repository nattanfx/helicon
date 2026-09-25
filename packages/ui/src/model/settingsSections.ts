export type SettingsGroupId = "conversas" | "execucao" | "aplicativo";

export interface SettingsSectionDef {
  id: string;
  title: string;
  /** Uma linha para o cabeçalho da página da seção. */
  description: string;
  group: SettingsGroupId;
  /** Chave de ícone lucide, resolvida pela navegação; o modelo não importa React. */
  icon: string;
}

export const SETTINGS_GROUPS: Readonly<Record<SettingsGroupId, string>> = {
  conversas: "Conversas",
  execucao: "Execução",
  aplicativo: "Aplicativo",
};

/** As seções da página de Configurações, na ordem em que aparecem. Título mora aqui, e só aqui. */
export const SETTINGS_SECTIONS: readonly SettingsSectionDef[] = [
  { id: "conversas", title: "Conversas", description: "Modelo, permissões, lista e títulos das conversas.", group: "conversas", icon: "MessageSquarePlus" },
  { id: "chats-arquivados", title: "Chats arquivados", description: "Conversas guardadas, agrupadas por projeto.", group: "conversas", icon: "Archive" },
  { id: "seguranca", title: "Segurança", description: "Modo YOLO, sandbox e aprovações respondidas por você.", group: "execucao", icon: "Shield" },
  { id: "aparencia", title: "Aparência", description: "Tema, cores do código, zoom e estatísticas da sessão.", group: "aplicativo", icon: "Palette" },
  { id: "notificacoes", title: "Notificações", description: "Balão e som quando uma conversa precisar de você.", group: "aplicativo", icon: "BellRing" },
  { id: "atalhos", title: "Atalhos de teclado", description: "As teclas do app, para consulta.", group: "aplicativo", icon: "Keyboard" },
  { id: "sobre", title: "Sobre", description: "Versão, ambiente, novidades e diagnóstico.", group: "aplicativo", icon: "Info" },
];

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

export function settingsSectionTitle(id: string): string {
  const found = SETTINGS_SECTIONS.find((section) => section.id === id);
  if (!found) {
    throw new Error(`Unknown settings section: ${id}`);
  }
  return found.title;
}

export function isSettingsSectionId(id: string): id is SettingsSectionId {
  return SETTINGS_SECTIONS.some((section) => section.id === id);
}

/** Primeira seção da navegação: para onde as Configurações abrem e para onde um id inválido cai. */
export function defaultSettingsSection(): SettingsSectionDef {
  const first = SETTINGS_SECTIONS[0];
  if (!first) {
    throw new Error("No settings sections defined");
  }
  return first;
}
