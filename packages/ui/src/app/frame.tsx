import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { cn } from "../components/ui/primitives.js";

/** O chrome da janela que um shell de desktop entrega à UI quando a UI desenha a barra de título. */
export interface WindowFrame {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  startDragging(): void;
  isMaximized(): Promise<boolean>;
  /** Chama de volta após cada redimensionamento, e retorna um descadastramento. */
  onResized(callback: () => void): () => void;
}

const FrameContext = createContext<WindowFrame | null>(null);

/** Verdadeiro quando o shell sobrepõe os semáforos do macOS à UI em vez de uma barra de título. */
const OverlayContext = createContext(false);

// Cliques nestes nunca movem a janela, mesmo dentro de uma região de arrasto.
const INTERACTIVE =
  'button, a, input, textarea, select, label, [role="button"], [role="menuitem"], [role="option"], [role="tab"], [contenteditable="true"], [data-no-drag]';

export function FrameProvider(props: { frame: WindowFrame | undefined; overlay?: boolean; children: ReactNode }) {
  const frame = props.frame ?? null;
  useEffect(() => {
    if (!frame) {
      return;
    }
    // Qualquer superfície `data-drag-region` move a janela, e um duplo clique alterna maximizar, como uma barra de título nativa.
    const onDown = (event: MouseEvent) => {
      const target = event.target;
      if (event.button !== 0 || !(target instanceof Element)) {
        return;
      }
      if (!target.closest("[data-drag-region]") || target.closest(INTERACTIVE)) {
        return;
      }
      event.preventDefault();
      if (event.detail === 2) {
        frame.toggleMaximize();
      } else {
        frame.startDragging();
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [frame]);
  return (
    <FrameContext.Provider value={frame}>
      <OverlayContext.Provider value={props.overlay ?? false}>{props.children}</OverlayContext.Provider>
    </FrameContext.Provider>
  );
}

export function useFrame(): WindowFrame | null {
  return useContext(FrameContext);
}

export function useTitlebarOverlay(): boolean {
  return useContext(OverlayContext);
}

/**
 * Props nativas de região de arrasto em janelas de sobreposição do macOS, vazias nos outros lugares: o shell do Windows arrasta
 * pelo próprio manipulador, e disparar os dois alternaria maximizar duas vezes. `deep` arrasta de
 * qualquer lugar da subárvore exceto elementos clicáveis, `self` só do próprio elemento,
 * e `off` tira um elemento para que, p. ex., o duplo clique para renomear continue funcionando.
 */
export function useOverlayDragProps(mode: "deep" | "self" | "off" = "deep"): { "data-tauri-drag-region"?: string } {
  if (!useTitlebarOverlay()) {
    return {};
  }
  return { "data-tauri-drag-region": mode === "deep" ? "deep" : mode === "self" ? "true" : "false" };
}

/** Reserva a largura dos botões da barra de título no fim de um cabeçalho `px-3`, para suas próprias ações nunca ficarem sob eles. */
export function CaptionSpacer() {
  return useFrame() ? <span aria-hidden="true" className="-mr-3 ml-auto w-[138px] shrink-0 self-stretch" /> : null;
}

/** Uma faixa de arrasto para telas de janela cheia que não têm cabeçalho. */
export function FrameStrip() {
  const frame = useFrame();
  const overlay = useTitlebarOverlay();
  const drag = useOverlayDragProps("self");
  if (!frame && !overlay) {
    return null;
  }
  return (
    <div data-drag-region {...drag} aria-hidden="true" className="fixed inset-x-0 top-0 z-[var(--z-sticky)] h-12" />
  );
}

/** Minimizar, maximizar e fechar, desenhados para combinar com os botões da barra de título do Windows 11. */
export function WindowControls() {
  const frame = useFrame();
  const [maximized, setMaximized] = useState(false);
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    if (!frame) {
      return;
    }
    let alive = true;
    const sync = () => {
      frame.isMaximized().then(
        (value) => {
          if (alive) {
            setMaximized(value);
          }
        },
        () => undefined,
      );
    };
    sync();
    const unsubscribe = frame.onResized(sync);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [frame]);
  useEffect(() => {
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  if (!frame) {
    return null;
  }
  return (
    <div
      role="group"
      aria-label="Janela"
      // Continua clicável enquanto um diálogo desabilitou os eventos de ponteiro na página, como os botões nativos da barra de título.
      className={cn(
        "pointer-events-auto fixed top-0 right-0 z-[var(--z-titlebar)] flex h-12 transition-colors duration-100",
        focused ? "text-fg" : "text-subtle",
      )}
    >
      <CaptionButton label="Minimizar" glyph={"\uE921"} onClick={() => frame.minimize()} />
      <CaptionButton
        label={maximized ? "Restaurar" : "Maximizar"}
        glyph={maximized ? "\uE923" : "\uE922"}
        onClick={() => frame.toggleMaximize()}
      />
      <CaptionButton label="Fechar" glyph={"\uE8BB"} onClick={() => frame.close()} close />
    </div>
  );
}

function CaptionButton(props: { label: string; glyph: string; onClick: () => void; close?: boolean }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      className={cn(
        "flex h-full w-[46px] items-center justify-center font-caption text-[10px] leading-none transition-colors duration-100 select-none",
        props.close ? "hover:bg-caption-close hover:text-white active:bg-caption-close/90" : "hover:bg-hover active:bg-active",
      )}
    >
      <span aria-hidden="true">{props.glyph}</span>
    </button>
  );
}
