import { useEffect, useRef, useState } from "react";

/**
 * A huge text that keeps changing, sampled no faster than `intervalMs` while `active`, so a
 * stream that would cost a full re-parse per flush renders a few stills a second instead. When
 * the stream ends the live text shows at once; identical snapshots render nothing twice.
 */
export function useSampledText(text: string, active: boolean, intervalMs: number): string {
  const [snapshot, setSnapshot] = useState(text);
  const latest = useRef(text);
  latest.current = text;
  useEffect(() => {
    if (!active) {
      setSnapshot(latest.current);
      return;
    }
    setSnapshot(latest.current);
    const timer = setInterval(() => setSnapshot(latest.current), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  return active ? snapshot : text;
}

/**
 * Lê um número que muda rápido uma vez por segundo enquanto `enabled`, para uma leitura ao vivo (uma
 * velocidade de streaming, digamos) se fixar em valores estáveis em vez de piscar a cada pedaço.
 */
export function useSampled(read: () => number | null, enabled: boolean): number | null {
  const readRef = useRef(read);
  readRef.current = read;
  const [value, setValue] = useState<number | null>(() => (enabled ? read() : null));
  useEffect(() => {
    if (!enabled) {
      setValue(null);
      return;
    }
    setValue(readRef.current());
    const timer = setInterval(() => setValue(readRef.current()), 1000);
    return () => clearInterval(timer);
  }, [enabled]);
  return value;
}
