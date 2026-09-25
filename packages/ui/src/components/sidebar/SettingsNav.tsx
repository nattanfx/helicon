import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useApp, useController } from "../../app/context.js";
import { visibleSettingsSections } from "../../model/settingsSections.js";
import { cn } from "../ui/primitives.js";

/** Rola até a seção; sem animação para quem prefere movimento reduzido. */
function scrollToSection(id: string): void {
  const node = document.getElementById(`settings-${id}`);
  if (!node) {
    return;
  }
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  node.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

/** No lugar da lista de conversas enquanto as Configurações estão abertas: voltar + seções. */
export function SettingsNav() {
  const controller = useController();
  const updates = useApp((s) => s.updates);
  const sections = visibleSettingsSections(updates);
  const [active, setActive] = useState(sections[0]?.id ?? "");
  const go = (id: string) => {
    setActive(id);
    scrollToSection(id);
  };
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
        <div aria-hidden="true" className="mx-2.5 my-1.5 border-t border-line" />
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            aria-current={active === section.id ? "page" : undefined}
            onClick={() => go(section.id)}
            className={cn(
              "flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-sm transition-colors duration-100 hover:bg-hover hover:text-fg",
              active === section.id ? "bg-active font-medium text-fg" : "text-muted",
            )}
          >
            <span className="min-w-0 flex-1 truncate text-left">{section.title}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
