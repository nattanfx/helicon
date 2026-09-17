/*
 * Componentes adaptados de registros open-source. Cada um mantém uma nota nomeando sua fonte para
 * poder ser baixado de novo; as três fontes têm licença MIT.
 *
 *   Collapse, PixelLoader, RollingDigits  via Beautiful UI (beautifului.dev), MIT (c) 2026 Shane Levine
 *   SwapIcon                              via beUI ActionSwapIcon (beui.dev), MIT (c) 2026 Saurabh Chauhan
 */
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "./primitives.js";

const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

/**
 * Corpo expansível com altura animada usando o truque de grid-rows de 0fr para 1fr, sem medir
 * nada. Os filhos montam na primeira abertura e ficam montados para o fechamento poder animar.
 * via Beautiful UI ThinkingState / ToolChips expand grammar. Adaptado: montagem preguiçosa, inerte quando fechado.
 */
export function Collapse(props: { open: boolean; children: ReactNode; className?: string }) {
  const [mounted, setMounted] = useState(props.open);
  useEffect(() => {
    if (props.open) {
      setMounted(true);
    }
  }, [props.open]);
  const inert = props.open ? {} : ({ inert: "" } as Record<string, string>);
  return (
    <div
      className={cn("grid transition-[grid-template-rows,opacity] duration-[260ms] ease-out", props.className)}
      style={{ gridTemplateRows: props.open ? "1fr" : "0fr", opacity: props.open ? 1 : 0 }}
      aria-hidden={props.open ? undefined : true}
      {...inert}
    >
      <div className="min-h-0 overflow-hidden">{mounted ? props.children : null}</div>
    </div>
  );
}

const DRIVE_DELAYS = Array.from({ length: 9 }, (_, i) => {
  const row = Math.floor(i / 3);
  const col = i % 3;
  return (col + Math.abs(row - 1)) * 90;
});

/**
 * Uma grade de pixels 3x3 com uma frente de onda em chevron avançando para a direita: a marca viva de "Muse trabalhando".
 * via Beautiful UI LoadingState ("Drive"). Adaptado: currentColor, só CSS, movimento reduzido esmaece.
 */
export function PixelLoader(props: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("pixel-loader grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]", props.className)}>
      {DRIVE_DELAYS.map((delay, index) => (
        <span key={index} className="size-[4px] rounded-[1px] bg-current" style={{ animationDelay: `${delay}ms` }} />
      ))}
    </span>
  );
}

const ROLL_MS = 360;

/**
 * Dígitos de odômetro: cada caractere alterado rola para cima (ou para baixo quando o número cai).
 * via Beautiful UI ApprovalCard RollingDigits. Adaptado: tipado, tempos na escala de movimento.
 */
export function RollingDigits(props: { value: string; className?: string }) {
  const previous = useRef(props.value);
  const [from, setFrom] = useState(props.value);
  const [to, setTo] = useState(props.value);
  const [rolling, setRolling] = useState(false);
  const [shifted, setShifted] = useState(false);
  const [direction, setDirection] = useState<"up" | "down">("up");

  useEffect(() => {
    if (previous.current === props.value) {
      return;
    }
    const old = previous.current;
    previous.current = props.value;
    const a = Number.parseInt(old, 10);
    const b = Number.parseInt(props.value, 10);
    setDirection(Number.isFinite(a) && Number.isFinite(b) && b < a ? "down" : "up");
    setFrom(old);
    setTo(props.value);
    setRolling(true);
    setShifted(false);
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setShifted(true));
    });
    const done = window.setTimeout(() => {
      setRolling(false);
      setFrom(props.value);
      setShifted(false);
    }, ROLL_MS);
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      window.clearTimeout(done);
    };
  }, [props.value]);

  const chars = rolling ? to : from;
  return (
    <span className={cn("inline-flex tabular-nums", props.className)} aria-label={props.value}>
      {Array.from({ length: chars.length }, (_, i) => {
        const o = from[i] ?? "";
        const n = chars[i] ?? "";
        if (!rolling || o === n) {
          return (
            <span key={`${i}-${n}`} aria-hidden="true" className="whitespace-pre">
              {n}
            </span>
          );
        }
        const top = direction === "down" ? n : o;
        const bottom = direction === "down" ? o : n;
        const rest = direction === "down" ? "0" : "-1em";
        const start = direction === "down" ? "-1em" : "0";
        return (
          <span
            key={`${i}-${o}-${n}-${direction}`}
            aria-hidden="true"
            className="relative inline-block overflow-hidden whitespace-pre"
            style={{ height: "1em", lineHeight: "1em", verticalAlign: "-0.05em" }}
          >
            <span
              className="flex flex-col"
              style={{ transition: "transform 320ms cubic-bezier(0.4, 0, 0.2, 1)", transform: `translateY(${shifted ? rest : start})` }}
            >
              <span style={{ height: "1em", lineHeight: "1em" }}>{top}</span>
              <span style={{ height: "1em", lineHeight: "1em" }}>{bottom}</span>
            </span>
          </span>
        );
      })}
    </span>
  );
}

/**
 * Troca dois ícones com um desfoque curto para o olho ler um glifo se transformando, não dois.
 * via beUI ActionSwapIcon ("blur"). Adaptado: variante única, easing do projeto, 180ms.
 */
export function SwapIcon(props: { value: string; children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <span className={cn("relative inline-grid shrink-0 place-items-center", props.className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={props.value}
          aria-hidden="true"
          initial={reduce ? false : { opacity: 0, scale: 0.4, filter: "blur(6px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.4, filter: "blur(6px)" }}
          transition={{ duration: 0.18, ease: EASE_OUT }}
          className="col-start-1 row-start-1 inline-flex items-center justify-center"
        >
          {props.children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
