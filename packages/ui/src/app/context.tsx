import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { HeliconController } from "../model/controller.js";
import type { AppState } from "../model/store.js";

const ControllerContext = createContext<HeliconController | null>(null);

export function ControllerProvider(props: { controller: HeliconController; children: ReactNode }) {
  return <ControllerContext.Provider value={props.controller}>{props.children}</ControllerContext.Provider>;
}

export function useController(): HeliconController {
  const controller = useContext(ControllerContext);
  if (!controller) {
    throw new Error("Helicon: useController fora de <ControllerProvider>.");
  }
  return controller;
}

export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) {
    return false;
  }
  for (const key of ka) {
    if (!Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false;
    }
  }
  return true;
}

/** Seleciona uma fatia do estado do app; renderiza de novo só quando a fatia muda sob `equal`. */
export function useApp<T>(selector: (state: AppState) => T, equal: (a: T, b: T) => boolean = Object.is): T {
  const store = useController().store;
  const selectorRef = useRef(selector);
  const equalRef = useRef(equal);
  selectorRef.current = selector;
  equalRef.current = equal;
  const cache = useRef<{ state: AppState; selector: (state: AppState) => T; value: T } | null>(null);
  const getSnapshot = (): T => {
    const state = store.get();
    const current = cache.current;
    if (current && current.state === state && current.selector === selectorRef.current) {
      return current.value;
    }
    const value = selectorRef.current(state);
    if (current && equalRef.current(current.value, value)) {
      cache.current = { state, selector: selectorRef.current, value: current.value };
      return current.value;
    }
    cache.current = { state, selector: selectorRef.current, value };
    return value;
  };
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/** Um relógio que renderiza quem chama de novo a cada `intervalMs` enquanto `active`. */
export function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      return;
    }
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, active]);
  return now;
}
