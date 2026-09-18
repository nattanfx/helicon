import { useEffect, useState, type ReactElement } from "react";
import type { HeliconClient } from "../client.js";
import { AddProjectDialog } from "../components/sidebar/AddProjectDialog.js";
import { BootError, BootScreen, NewThread, Onboarding, Welcome } from "../components/home/Home.js";
import { CommandPalette } from "../components/palette/CommandPalette.js";
import { SettingsPage } from "../components/settings/SettingsPage.js";
import { Sidebar } from "../components/sidebar/Sidebar.js";
import { ThreadView } from "../components/thread/ThreadView.js";
import { UsagePage } from "../components/usage/UsagePage.js";
import { TooltipProvider } from "../components/ui/overlays.js";
import { cn, isMac } from "../components/ui/primitives.js";
import { Toasts } from "../components/ui/Toasts.js";
import { HeliconController, type Platform } from "../model/controller.js";
import type { Notifier } from "../model/notify.js";
import type { AppUpdater } from "../model/updates.js";
import { zoomStepFromKey, type ZoomStep } from "../model/zoom-shortcut.js";
import { ControllerProvider, useApp, useController } from "./context.js";
import { FrameProvider, FrameStrip, WindowControls, type WindowFrame } from "./frame.js";

declare global {
  interface WindowEventMap {
    "helicon-zoom-step": CustomEvent<ZoomStep>;
  }
}

export interface HeliconAppProps {
  client: HeliconClient;
  platform?: Platform;
  /** Presente quando um shell de desktop quer que a UI desenhe a barra de título da janela. */
  frame?: WindowFrame;
  /** Presente quando o shell sobrepõe os semáforos do macOS à UI em vez de uma barra de título. */
  titlebarOverlay?: boolean;
  /** Presente quando o shell pode se atualizar. */
  updater?: AppUpdater;
  /** Como este shell mostra uma notificação de sistema; ausente onde não pode. */
  notifier?: Notifier;
}

/** A interface inteira do Helicon. Os shells web e de desktop montam isso com seu transporte. */
export function HeliconApp(props: HeliconAppProps) {
  const [controller] = useState(() => {
    const created = new HeliconController(props.client, props.platform);
    if (props.updater) {
      created.attachUpdater(props.updater);
    }
    if (props.notifier) {
      created.attachNotifier(props.notifier);
    }
    return created;
  });
  useEffect(() => controller.start(), [controller]);
  return (
    <ControllerProvider controller={controller}>
      <FrameProvider frame={props.frame} overlay={props.titlebarOverlay}>
        <TooltipProvider>
          <ThemeSync />
          <ZoomSync />
          <GlobalShortcuts />
          <Shell />
          <CommandPalette />
          <AddProjectDialog />
          <Toasts />
          <WindowControls />
        </TooltipProvider>
      </FrameProvider>
    </ControllerProvider>
  );
}

function ThemeSync() {
  const theme = useApp((s) => s.prefs.theme);
  const codeTheme = useApp((s) => s.prefs.codeTheme);
  useEffect(() => {
    document.documentElement.dataset["codeTheme"] = codeTheme;
  }, [codeTheme]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset["theme"] = theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    if (theme !== "system") {
      return;
    }
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  return null;
}

function ZoomSync() {
  const zoom = useApp((s) => s.prefs.zoom);
  useEffect(() => {
    // O `zoom` do CSS no <html> quebra os menus `position: fixed` do Radix no WKWebView (o shell
    // de desktop). A página de desktop escuta `helicon-zoom` e usa o zoom da própria webview
    // em vez disso. Navegadores mantêm o zoom do CSS; mecanismos sem ele usam o tamanho da fonte raiz.
    // O script pré-pintura no index.html aplica a mesma divisão para um recarregamento nunca piscar 100%.
    const root = document.documentElement;
    const style = root.style as CSSStyleDeclaration & { zoom?: unknown };
    const desktop = "__TAURI_INTERNALS__" in window;
    if (desktop) {
      if ("zoom" in style) {
        style.zoom = "";
      }
      root.style.fontSize = "";
      window.dispatchEvent(new CustomEvent("helicon-zoom", { detail: zoom }));
      return;
    }
    if ("zoom" in style) {
      style.zoom = zoom === 1 ? "" : String(zoom);
      root.style.fontSize = "";
    } else {
      root.style.fontSize = zoom === 1 ? "" : `${Math.round(16 * zoom * 100) / 100}px`;
    }
  }, [zoom]);
  return null;
}

function applyZoomStep(controller: HeliconController, step: ZoomStep) {
  if (step === "in") {
    controller.zoomIn();
  } else if (step === "out") {
    controller.zoomOut();
  } else {
    controller.resetZoom();
  }
}

function GlobalShortcuts() {
  const controller = useController();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = isMac ? event.metaKey : event.ctrlKey;
      const key = event.key.toLowerCase();
      const zoom = zoomStepFromKey(event, isMac);
      if (zoom) {
        event.preventDefault();
        applyZoomStep(controller, zoom);
        return;
      }
      if (mod && !event.shiftKey && !event.altKey && key === "k") {
        event.preventDefault();
        controller.setPaletteOpen(!controller.store.get().paletteOpen);
      } else if (mod && event.shiftKey && key === "o") {
        event.preventDefault();
        controller.newThread();
      } else if (mod && !event.shiftKey && key === "b") {
        event.preventDefault();
        controller.toggleSidebar();
      } else if (mod && event.shiftKey && !event.altKey && key === "e") {
        event.preventDefault();
        controller.toggleFiles();
      } else if (event.altKey && !mod && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        const state = controller.store.get();
        const ordered = Object.values(state.sessions).sort((a, b) => (a.activityAt < b.activityAt ? 1 : -1));
        if (ordered.length === 0) {
          return;
        }
        event.preventDefault();
        const current = state.route.kind === "thread" ? ordered.findIndex((s) => s.sessionId === (state.route as { sessionId: string }).sessionId) : -1;
        const next = event.key === "ArrowDown" ? Math.min(ordered.length - 1, current + 1) : Math.max(0, current - 1);
        const target = ordered[next];
        if (target) {
          controller.openThread(target.sessionId);
        }
      }
    };
    const onMenuZoom = (event: Event) => {
      const step = (event as CustomEvent<ZoomStep>).detail;
      if (step === "in" || step === "out" || step === "reset") {
        applyZoomStep(controller, step);
      }
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("helicon-zoom-step", onMenuZoom);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("helicon-zoom-step", onMenuZoom);
    };
  }, [controller]);
  return null;
}

function Shell() {
  const boot = useApp((s) => s.boot);
  const env = useApp((s) => s.env);
  const collapsed = useApp((s) => s.prefs.sidebarCollapsed);
  // Telas de boot, configuração e erro enchem a janela sem cabeçalho, então ganham uma faixa de arrasto simples.
  let screen: ReactElement | null = null;
  if (!env) {
    screen = boot === "error" ? <BootError /> : <BootScreen />;
  } else if (!env.museFound) {
    screen = <Onboarding />;
  } else if (boot === "error") {
    screen = <BootError />;
  }
  if (screen) {
    return (
      <>
        {screen}
        <FrameStrip />
      </>
    );
  }
  return (
    <div className="flex h-full w-full bg-bg text-fg">
      {/* A lateral continua montada e abre/fecha pelo truque 0fr/1fr;
          a visibilidade vira no fim do fechamento para que o
          painel cortado saia da ordem de tab só quando sumir. */}
      <div
        className={cn(
          "grid h-full transition-[grid-template-columns,visibility] duration-200 ease-drawer motion-reduce:transition-none",
          collapsed ? "grid-cols-[0fr] invisible" : "grid-cols-[1fr] visible",
        )}
      >
        <div className="min-w-0 overflow-hidden">
          <Sidebar />
        </div>
      </div>
      <main className="flex min-w-0 flex-1 flex-col">
        <Main />
      </main>
    </div>
  );
}

function Main() {
  const route = useApp((s) => s.route);
  const loaded = useApp((s) => s.sessionsLoaded);
  const hasProjects = useApp((s) => s.projects.length > 0);
  const lastProject = useApp((s) => s.prefs.lastProject);
  if (!loaded) {
    return null;
  }
  if (route.kind === "usage") {
    return <UsagePage />;
  }
  if (route.kind === "settings") {
    return <SettingsPage />;
  }
  if (route.kind === "thread") {
    return <ThreadView key={route.sessionId} sessionId={route.sessionId} />;
  }
  if (!hasProjects) {
    return <Welcome />;
  }
  return <NewThread cwd={route.kind === "new" ? route.cwd : lastProject} />;
}
