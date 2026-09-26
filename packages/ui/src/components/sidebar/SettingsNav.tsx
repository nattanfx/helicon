import {
  Archive,
  ArrowLeft,
  BellRing,
  Gauge,
  Info,
  Keyboard,
  MessageSquarePlus,
  Palette,
  Shield,
  type LucideIcon,
} from "lucide-react";
import { useApp, useController } from "../../app/context.js";
import { SETTINGS_GROUPS, SETTINGS_SECTIONS, defaultSettingsSection, type SettingsGroupId } from "../../model/settingsSections.js";
import { cn } from "../ui/primitives.js";

const ICONS: Readonly<Record<string, LucideIcon>> = {
  MessageSquarePlus,
  Archive,
  Shield,
  Palette,
  BellRing,
  Keyboard,
  Info,
};

/** No lugar da lista de conversas enquanto as Configurações estão abertas: voltar + seções agrupadas. */
export function SettingsNav() {
  const controller = useController();
  const stored = useApp((s) => s.settingsSection);
  const active = SETTINGS_SECTIONS.some((section) => section.id === stored) ? (stored as string) : defaultSettingsSection().id;
  const groups = (Object.keys(SETTINGS_GROUPS) as SettingsGroupId[]).map((group) => ({
    id: group,
    title: SETTINGS_GROUPS[group],
    sections: SETTINGS_SECTIONS.filter((section) => section.group === group),
  }));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-7 items-center justify-between pr-2 pl-3.5">
        <h2 className="text-xs font-medium text-subtle">Configurações</h2>
      </div>
      <nav aria-label="Seções das configurações" className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-6">
        <button
          type="button"
          onClick={() => controller.goBack()}
          className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-sm text-muted transition-colors duration-100 hover:bg-hover hover:text-fg"
        >
          <span className="flex size-4 shrink-0 items-center justify-center">
            <ArrowLeft size={14} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1 truncate text-left">Voltar ao app</span>
        </button>
        <button
          type="button"
          onClick={() => controller.navigate({ kind: "usage" })}
          className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-sm text-muted transition-colors duration-100 hover:bg-hover hover:text-fg"
        >
          <span className="flex size-4 shrink-0 items-center justify-center">
            <Gauge size={14} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1 truncate text-left">Uso</span>
        </button>
        {groups.map((group) => (
          <div key={group.id}>
            <p aria-hidden="true" className="px-2 pt-3 pb-1 text-2xs font-medium tracking-wide text-subtle uppercase">
              {group.title}
            </p>
            {group.sections.map((section) => {
              const Icon = ICONS[section.icon] ?? Info;
              return (
                <button
                  key={section.id}
                  type="button"
                  aria-current={active === section.id ? "page" : undefined}
                  onClick={() => controller.openSettingsSection(section.id)}
                  className={cn(
                    "flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-sm transition-colors duration-100 hover:bg-hover hover:text-fg",
                    active === section.id ? "bg-active font-medium text-fg" : "text-muted",
                  )}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    <Icon size={14} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-left">{section.title}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>
    </div>
  );
}
