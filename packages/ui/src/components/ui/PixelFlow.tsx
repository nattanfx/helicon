import { useEffect, useRef } from "react";
import { cn } from "./primitives.js";

const PITCH = 4;
const SIZE = 2;

/** Um valor 0..1 estável por célula e tick, para cada pixel manter seu próprio ritmo. */
function hash(col: number, row: number, tick = 0): number {
  const s = Math.sin(col * 127.1 + row * 311.7 + tick * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Um campo de pixels na cor atual do texto que derivam para a borda direita e engrossam
 * no caminho, como o preenchimento de esforço "Ultracode" do Claude desktop. Desenha um quadro parado sob
 * movimento reduzido.
 */
export function PixelFlow(props: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let color = "";
    let frame = 0;
    const measure = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      color = getComputedStyle(canvas).color;
    };
    const draw = (time: number) => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = color;
      const cols = Math.floor(width / PITCH);
      const rows = Math.floor(height / PITCH);
      const top = Math.floor((height - rows * PITCH) / 2);
      const t = time / 1000;
      for (let c = 0; c < cols; c++) {
        const x = cols > 1 ? c / (cols - 1) : 1;
        // Esparso na ponta lenta, denso junto ao polegar.
        const ramp = 0.12 + 0.88 * x ** 1.5;
        // Uma faixa mais brilhante viajando para o polegar aumenta as chances de um pixel acender.
        const flow = 0.5 + 0.5 * Math.sin(x * 8 - t * 1.33);
        const chance = Math.min(1, 0.05 + ramp * (0.45 + 0.55 * flow));
        // Totalmente visível no polegar, sumido na ponta lenta.
        const fade = x * x * (3 - 2 * x);
        for (let r = 0; r < rows; r++) {
          const seed = hash(c, r);
          // Cada pixel sorteia de novo no seu próprio relógio, umas duas a quatro vezes por segundo: o tremeluzir.
          const tick = Math.floor(t * ((5 + seed * 7) / 3) + seed * 50);
          const lit = hash(c, r, tick) < chance;
          ctx.globalAlpha = fade * (lit ? 0.35 + 0.65 * ramp : 0.06 + 0.08 * ramp);
          ctx.fillRect(c * PITCH + 1, top + r * PITCH + 1, SIZE, SIZE);
        }
      }
      ctx.globalAlpha = 1;
      if (!reduce) {
        frame = requestAnimationFrame(draw);
      }
    };
    measure();
    const resize = new ResizeObserver(() => {
      measure();
      if (reduce) {
        draw(0);
      }
    });
    resize.observe(canvas);
    // Trocas de tema mudam a cor do texto com que os pixels são desenhados.
    const theme = new MutationObserver(() => {
      color = getComputedStyle(canvas).color;
      if (reduce) {
        draw(0);
      }
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      theme.disconnect();
    };
  }, []);
  return <canvas ref={ref} aria-hidden="true" className={cn("pointer-events-none block size-full", props.className)} />;
}
