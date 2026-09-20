import { useState, type FormEvent } from "react";
import { authErrorCopy } from "@helicon/ui";
import { currentDaemon, setDaemon } from "./webClient.js";

/** Reduz um endereço digitado a algo acessível, ou null quando não é um endereço. */
function asOrigin(value: string): string | null {
  const text = value.trim().replace(/\/$/, "");
  if (!text) {
    return "";
  }
  try {
    const parsed = new URL(text);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

/**
 * Onde o navegador aponta para um servidor em outra máquina. O token é conferido aqui antes de ser
 * guardado, para que um token errado avise agora em vez de virar um app que falha a cada chamada.
 */
export function Connect(props: { onDone: () => void }) {
  const existing = currentDaemon();
  const [base, setBase] = useState(existing.base);
  const [token, setToken] = useState(existing.token ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const origin = asOrigin(base);
    if (origin === null) {
      setError("Isso não parece um endereço. Deveria ser algo como https://box.example:3127");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // A mesma apresentação que o app faz a cada carregamento: um servidor que recusar agora recusaria depois.
      const response = await fetch(`${origin}/api/auth`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token.trim() || null }),
        credentials: "include",
      });
      const body = (await response.json().catch(() => ({}))) as { error?: unknown; kind?: unknown };
      const kind = typeof body.kind === "string" ? body.kind : null;
      const raw = typeof body.error === "string" ? body.error : "";
      const auth = authErrorCopy(kind, response.status, raw);
      if (!response.ok) {
        setError(auth?.explanation ?? `O servidor respondeu com ${response.status}.`);
        return;
      }
      setDaemon({ base: origin, token: token.trim() || null });
      props.onDone();
    } catch {
      setError(
        origin && origin.startsWith("http://") && window.location.protocol === "https:"
          ? "Uma página servida via HTTPS não alcança um servidor via HTTP simples. Coloque o servidor atrás de TLS ou de um túnel."
          : "Não foi possível alcançar o servidor. Confira o endereço e se ele foi iniciado com --allow-origin para esta página.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-center px-6">
      <h1 className="text-lg font-semibold text-fg">Conectar a um servidor</h1>
      <p className="mt-1 text-xs text-pretty text-muted">
        Deixe o endereço vazio para usar o servidor que serviu esta página. Um servidor em outro lugar precisa ser iniciado com
        <code className="mx-1 rounded bg-sunken px-1 py-0.5 font-mono text-2xs">--allow-origin {window.location.origin}</code>
        e, salvo se estiver nesta máquina, acessado via HTTPS.
      </p>
      <form className="mt-5 flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-fg">Endereço</span>
          <input
            autoFocus
            value={base}
            onChange={(event) => setBase(event.target.value)}
            placeholder="https://box.example:3127"
            className="h-9 rounded-lg bg-sunken px-3 text-sm text-fg shadow-[0_0_0_1px_var(--border-strong)] outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-fg">Token</span>
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Somente se o servidor foi iniciado com --token"
            className="h-9 rounded-lg bg-sunken px-3 text-sm text-fg shadow-[0_0_0_1px_var(--border-strong)] outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]"
          />
        </label>
        {error ? <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-pretty text-danger-text">{error}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="mt-1 h-9 rounded-lg bg-accent text-sm font-medium text-white transition-opacity duration-100 disabled:opacity-60"
        >
          {busy ? "Verificando" : "Conectar"}
        </button>
      </form>
    </main>
  );
}
