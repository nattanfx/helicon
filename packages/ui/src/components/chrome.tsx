import { PanelLeftOpen } from "lucide-react";
import type { ReactNode } from "react";
import { useApp, useController } from "../app/context.js";
import { CaptionSpacer, useOverlayDragProps, useTitlebarOverlay } from "../app/frame.js";
import { Tip } from "./ui/overlays.js";
import { IconButton, MOD, cn } from "./ui/primitives.js";

export function SidebarToggle() {
  const controller = useController();
  const collapsed = useApp((s) => s.prefs.sidebarCollapsed);
  if (!collapsed) {
    return null;
  }
  return (
    <Tip label="Mostrar barra lateral" shortcut={[MOD, "B"]}>
      <IconButton label="Mostrar barra lateral" onClick={() => controller.toggleSidebar()}>
        <PanelLeftOpen size={16} />
      </IconButton>
    </Tip>
  );
}

/** A barra de 48px com que toda visão principal começa, para trocar de visão nunca deslocar conteúdo. */
export function TopBar(props: { children?: ReactNode; className?: string }) {
  const drag = useOverlayDragProps();
  return (
    <header data-drag-region {...drag} className={cn("flex h-12 shrink-0 items-center gap-2 px-3", props.className)}>
      <TrafficLightSpacer />
      <SidebarToggle />
      {props.children}
      <CaptionSpacer />
    </header>
  );
}

/**
 * Limpa os semáforos do macOS quando a barra lateral some e eles ficam sobre a visão principal.
 * O shell os fixa a 20px da borda esquerda, três luzes de 12px com gaps de 8px, então 68px após
 * o padding de 12px do cabeçalho deixam um respiro de 8px.
 */
export function TrafficLightSpacer() {
  const overlay = useTitlebarOverlay();
  const collapsed = useApp((s) => s.prefs.sidebarCollapsed);
  if (!overlay || !collapsed) {
    return null;
  }
  return <span aria-hidden="true" className="w-[68px] shrink-0" />;
}
