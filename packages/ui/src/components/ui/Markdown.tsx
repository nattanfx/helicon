import { Check, Copy } from "lucide-react";
import { Children, createContext, isValidElement, memo, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { looksLikeFilePath, type FileTarget } from "../../model/files.js";
import { STREAM_SAMPLE_MS, streamRenderMode } from "../../model/streaming.js";
import { useSampledText } from "../../app/sampled.js";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlight } from "sugar-high";
import { cn } from "./primitives.js";
import { SwapIcon } from "./sourced.js";

export function useCopy(timeout = 1400): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
    }
  }, []);
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
      timer.current = window.setTimeout(() => setCopied(false), timeout);
    });
  };
  return [copied, copy];
}

export function CopyButton(props: { text: string; label?: string; className?: string }) {
  const [copied, copy] = useCopy();
  return (
    <button
      type="button"
      aria-label={copied ? "Copiado" : (props.label ?? "Copiar")}
      onClick={() => copy(props.text)}
      className={cn(
        "inline-flex size-6 items-center justify-center rounded-md text-subtle transition-colors hover:bg-hover hover:text-fg",
        props.className,
      )}
    >
      <SwapIcon value={copied ? "copied" : "copy"}>
        {copied ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
      </SwapIcon>
    </button>
  );
}

const HIGHLIGHTABLE = /^(js|jsx|ts|tsx|javascript|typescript|json|jsonc|css|scss|html|xml|java|c|cpp|cs|go|rust|rs|swift|kotlin|php|py|python|rb|ruby|sh|bash|zsh|shell|ps1|powershell|sql|yaml|yml|toml|lua|dart)$/i;

/** O que uma extensão de arquivo implica sobre sua linguagem, para colorir um diff do mesmo jeito que um bloco de código é colorido. */
const EXTENSION_LANGUAGE: Record<string, string> = {
  ts: "ts",
  tsx: "tsx",
  mts: "ts",
  cts: "ts",
  js: "js",
  jsx: "jsx",
  mjs: "js",
  cjs: "js",
  json: "json",
  jsonc: "jsonc",
  css: "css",
  scss: "scss",
  html: "html",
  xml: "xml",
  java: "java",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  cs: "cs",
  go: "go",
  rs: "rs",
  swift: "swift",
  kt: "kotlin",
  php: "php",
  py: "py",
  rb: "rb",
  sh: "sh",
  bash: "bash",
  zsh: "zsh",
  ps1: "ps1",
  sql: "sql",
  yaml: "yaml",
  yml: "yml",
  toml: "toml",
  lua: "lua",
  dart: "dart",
};

/** A linguagem que um caminho implica, ou nulo quando nada aqui pode colori-la. */
export function languageFromPath(path: string | null | undefined): string | null {
  const extension = /\.([A-Za-z0-9]+)$/.exec(path ?? "")?.[1]?.toLowerCase();
  const language = extension ? EXTENSION_LANGUAGE[extension] : undefined;
  return language && HIGHLIGHTABLE.test(language) ? language : null;
}

/** HTML destacado para uma linha ou um bloco, ou nulo quando não vale a pena colorir. */
export function highlightCode(code: string, language: string | null): string | null {
  if (!language || code.length === 0 || code.length > 2000) {
    return null;
  }
  try {
    return highlight(code);
  } catch {
    return null;
  }
}

export const CodeBlock = memo(function CodeBlock(props: { code: string; language: string | null; className?: string }) {
  const html = useMemo(() => {
    if (props.code.length > 60_000 || (props.language && !HIGHLIGHTABLE.test(props.language))) {
      return null;
    }
    try {
      return highlight(props.code);
    } catch {
      return null;
    }
  }, [props.code, props.language]);
  return (
    <div className={cn("code-surface group/code my-3 overflow-hidden rounded-xl bg-sunken shadow-[0_0_0_1px_var(--border)]", props.className)}>
      <div className="flex h-8 items-center justify-between pr-1 pl-3.5">
        <span className="font-mono text-2xs text-subtle">{props.language ?? "text"}</span>
        <CopyButton text={props.code} label="Copiar código" className="opacity-60 group-hover/code:opacity-100 focus-visible:opacity-100" />
      </div>
      <pre className="max-h-[480px] overflow-auto px-3.5 pb-3">
        {html !== null ? <code dangerouslySetInnerHTML={{ __html: html }} /> : <code>{props.code}</code>}
      </pre>
    </div>
  );
});

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textOf).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textOf(node.props.children);
  }
  return "";
}

/**
 * Para onde levam os caminhos no markdown renderizado. Numa conversa eles abrem no visualizador de arquivos; num arquivo pré-visualizado eles
 * resolvem a partir da pasta do arquivo, e imagens relativas carregam do projeto. Sem isso, o markdown renderiza como antes.
 */
export interface FileLinks {
  resolve(href: string): FileTarget | null;
  open(target: FileTarget): void;
  /** Uma URL para uma imagem do projeto que uma prévia embute; nulo mantém a fonte como escrita. */
  imageUrl?(src: string): string | null;
}

export const FileLinksContext = createContext<FileLinks | null>(null);

function MarkdownLink(props: { href?: string; children?: ReactNode }) {
  const links = useContext(FileLinksContext);
  const target = links && props.href ? links.resolve(props.href) : null;
  if (links && target) {
    return (
      <a
        href={props.href}
        title={`Abrir ${target.path}`}
        onClick={(event) => {
          event.preventDefault();
          links.open(target);
        }}
      >
        {props.children}
      </a>
    );
  }
  return (
    <a href={props.href} target="_blank" rel="noreferrer noopener">
      {props.children}
    </a>
  );
}

/** Código inline nomeando um arquivo, como `src/app.ts:12`, o abre; qualquer outro código inline é deixado em paz. */
function InlineCode(props: { className?: string; children?: ReactNode }) {
  const links = useContext(FileLinksContext);
  const text = typeof props.children === "string" ? props.children : null;
  const target = links && text && !props.className && looksLikeFilePath(text) ? links.resolve(text) : null;
  if (links && target) {
    return (
      <code
        role="link"
        tabIndex={0}
        title={`Abrir ${target.path}`}
        className="cursor-pointer decoration-[color-mix(in_oklch,var(--accent-text)_45%,transparent)] underline-offset-2 hover:text-accent-text hover:underline"
        onClick={() => links.open(target)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            links.open(target);
          }
        }}
      >
        {text}
      </code>
    );
  }
  return <code className={props.className}>{props.children}</code>;
}

function MarkdownImage(props: { src?: string | Blob; alt?: string }) {
  const links = useContext(FileLinksContext);
  const raw = typeof props.src === "string" ? props.src : undefined;
  const src = raw && links?.imageUrl ? (links.imageUrl(raw) ?? raw) : raw;
  return <img src={src} alt={props.alt ?? ""} loading="lazy" className="max-w-full rounded-lg" />;
}

const COMPONENTS: Components = {
  a: ({ href, children }) => <MarkdownLink href={href}>{children}</MarkdownLink>,
  code: ({ className, children }) => <InlineCode className={className}>{children}</InlineCode>,
  img: ({ src, alt }) => <MarkdownImage src={src} alt={alt} />,
  pre: ({ children }) => {
    const child = Children.toArray(children)[0];
    if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
      const language = /language-([\w+#-]+)/.exec(child.props.className ?? "")?.[1] ?? null;
      return <CodeBlock code={textOf(child.props.children).replace(/\n$/, "")} language={language} />;
    }
    return <pre>{children}</pre>;
  },
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
};

const PLUGINS = [remarkGfm];

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/**
 * Embrulha cada palavra da prosa num span enquanto o texto ainda está chegando, para uma palavra recém-chegada poder aparecer
 * sozinha. As posições das palavras nunca mudam conforme o texto cresce, então o React mantém os spans antigos e só os novos
 * montam e animam. Código mantém sua própria marcação.
 */
function rehypeWords() {
  const walk = (node: HastNode): void => {
    if (!node.children || node.tagName === "pre" || node.tagName === "code") {
      return;
    }
    const next: HastNode[] = [];
    for (const child of node.children) {
      if (child.type === "text" && child.value) {
        for (const part of child.value.split(/(\s+)/)) {
          if (!part) {
            continue;
          }
          next.push(
            /^\s+$/.test(part)
              ? { type: "text", value: part }
              : { type: "element", tagName: "span", properties: { className: ["tok"] }, children: [{ type: "text", value: part }] },
          );
        }
        continue;
      }
      walk(child);
      next.push(child);
    }
    node.children = next;
  };
  return (tree: HastNode) => walk(tree);
}

const STREAM_PLUGINS = [rehypeWords];

/** Prosa do agente; textos grandes em streaming atualizam em intervalos, sem animar cada palavra. */
export const Markdown = memo(function Markdown(props: { text: string; className?: string; stream?: boolean }) {
  const mode = streamRenderMode(props.text.length, props.stream ?? false);
  const shown = useSampledText(props.text, mode === "sampled", STREAM_SAMPLE_MS);
  const animateWords = mode === "words";
  // ReactMarkdown refaz o parse em cada render. Reutilizar o elemento também é necessário:
  // somente amostrar o texto ainda faria o parser trabalhar a cada alteração de props.text.
  const rendered = useMemo(() => (
    <ReactMarkdown remarkPlugins={PLUGINS} rehypePlugins={animateWords ? STREAM_PLUGINS : undefined} components={COMPONENTS}>
      {shown}
    </ReactMarkdown>
  ), [shown, animateWords]);
  return (
    <div className={cn("prose-helicon", props.className)}>
      {rendered}
    </div>
  );
});
