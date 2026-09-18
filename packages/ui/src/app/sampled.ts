import { useEffect, useRef, useState } from "react";

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
