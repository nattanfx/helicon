import { ArrowLeft } from "lucide-react";
import { useApp, useController } from "../../app/context.js";
import { useOverlayDragProps } from "../../app/frame.js";
import { SETTINGS_SECTIONS, defaultSettingsSection, type SettingsSectionId } from "../../model/settingsSections.js";
import { TopBar } from "../chrome.js";
import { Button } from "../ui/primitives.js";
import { Aparencia, Atalhos, Notificacoes } from "./AplicativoSettings.js";
import { ArchivedChats } from "./ArchivedChats.js";
import { Conversas } from "./ConversasSettings.js";
import { Seguranca } from "./ExecucaoSettings.js";
import { Sobre } from "./SobreSettings.js";

function SectionBody(props: { id: SettingsSectionId }) {
  switch (props.id) {
    case "aparencia":
      return <Aparencia />;
    case "conversas":
      return <Conversas />;
    case "chats-arquivados":
      return <ArchivedChats />;
    case "seguranca":
      return <Seguranca />;
    case "notificacoes":
      return <Notificacoes />;
    case "atalhos":
      return <Atalhos />;
    case "sobre":
      return <Sobre />;
  }
}

/** Tudo que o Helicon permite configurar, uma seção por página: os menus do app são atalhos para cá. */
export function SettingsPage() {
  const controller = useController();
  const stored = useApp((s) => s.settingsSection);
  const section = SETTINGS_SECTIONS.find((candidate) => candidate.id === stored) ?? defaultSettingsSection();
  const collapsed = useApp((s) => s.prefs.sidebarCollapsed);
  const drag = useOverlayDragProps();

  return (
    <div className="@container flex h-full min-w-0 flex-col">
      {collapsed ? <TopBar /> : null}
      <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        <header {...drag} className="mx-auto flex w-full max-w-[720px] shrink-0 items-center gap-3 px-4 pt-8 pb-1 @min-[520px]:px-6">
          <Button size="sm" variant="ghost" onClick={() => controller.goBack()}>
            <ArrowLeft size={14} /> Voltar
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-fg">{section.title}</h1>
            <p className="text-xs text-muted">{section.description}</p>
          </div>
        </header>

        <div className="mx-auto w-full min-w-0 max-w-[720px] px-4 pb-16 @min-[520px]:px-6">
          <SectionBody id={section.id} />
        </div>
      </div>
    </div>
  );
}
