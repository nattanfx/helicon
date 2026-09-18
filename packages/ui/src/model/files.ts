/** Uma linha ou intervalo que um agente apontou, como `app.ts:4` ou `app.ts:4-9`. */
export interface LineRange {
  start: number;
  end: number;
}

export interface FileTarget {
  /** Relativo ao projeto quando estava dentro dele; senão como escrito, e o servidor decide. */
  path: string;
  line: LineRange | null;
}

const LINE_SUFFIX = /:(\d+)(?:[-:](\d+))?$/;
const HASH_LINE = /#L(\d+)(?:-L?(\d+))?$/;

function lineOf(start: string | undefined, end: string | undefined): LineRange | null {
  const from = start ? Number(start) : Number.NaN;
  if (!Number.isInteger(from) || from < 1) {
    return null;
  }
  const to = end ? Number(end) : from;
  return { start: from, end: Number.isInteger(to) && to >= from ? to : from };
}

/** Barras normais, sem barra no fim, para um caminho Windows e seu gêmeo `/mnt` compararem igual. */
function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** `abs` relativo a `cwd` quando está dentro dele, senão nulo. Insensível a maiúsculas para caminhos com letra de drive. */
export function relativeToProject(cwd: string, abs: string): string | null {
  const root = normalize(cwd);
  const path = normalize(abs);
  const windows = /^[A-Za-z]:\//.test(root);
  const same = (a: string, b: string) => (windows ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (same(path, root)) {
    return "";
  }
  const prefix = `${root}/`;
  return same(path.slice(0, prefix.length), prefix) ? path.slice(prefix.length) : null;
}

/**
 * Para onde um link ou caminho numa resposta aponta no projeto, ou nulo quando não é arquivo: links web, e-mail,
 * âncoras na página. Caminhos relativos resolvem contra `baseDir`, a pasta do arquivo onde o link está, se houver.
 */
export function fileTarget(raw: string | null | undefined, cwd: string, baseDir = ""): FileTarget | null {
  if (!raw) {
    return null;
  }
  let value = raw.trim();
  if (!value || value.startsWith("#") || /^(?:https?|mailto|tel|data|javascript|vscode|cursor):/i.test(value)) {
    return null;
  }
  value = value.replace(/^file:\/\//i, "");
  try {
    value = decodeURIComponent(value);
  } catch {
    /* um % perdido fica como escrito */
  }
  let line: LineRange | null = null;
  const hash = HASH_LINE.exec(value);
  if (hash) {
    line = lineOf(hash[1], hash[2]);
    value = value.slice(0, hash.index);
  } else {
    const suffix = LINE_SUFFIX.exec(value);
    // `C:` sozinho é um drive, não uma linha: só remova um sufixo que segue algo parecido com caminho.
    if (suffix && suffix.index > 1) {
      line = lineOf(suffix[1], suffix[2]);
      value = value.slice(0, suffix.index);
    }
  }
  value = value.replace(/[?#].*$/, "");
  if (!value) {
    return null;
  }
  const absolute = value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
  if (absolute) {
    const inside = relativeToProject(cwd, value);
    return { path: inside ?? normalize(value), line };
  }
  const parts: string[] = normalize(baseDir) ? normalize(baseDir).split("/") : [];
  for (const part of value.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return { path: parts.join("/"), line };
}

/**
 * Código inline que nomeia um arquivo, como `src/app.ts`, `app.js:4-5` ou `README.md`. Deliberadamente estreito: uma palavra com
 * extensão curta, ou um caminho com barra e extensão. Comandos, identificadores e URLs ficam como código puro.
 */
export function looksLikeFilePath(text: string): boolean {
  const value = text.trim();
  if (value.length < 3 || value.length > 240 || /\s/.test(value) || /^[a-z]+:\/\//i.test(value)) {
    return false;
  }
  const bare = value.replace(LINE_SUFFIX, "");
  // Um dotfile como `.env` ou `.gitignore` é um arquivo não importa com que termine.
  if (/^\.[A-Za-z0-9_-]+$/.test(bare)) {
    return true;
  }
  // `a.b()` e `obj.prop` são código; uma extensão de arquivo é só letras e dígitos, e curta.
  if (!/\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(bare) || /[()<>{}=;,"'`$]/.test(bare)) {
    return false;
  }
  const ext = bare.slice(bare.lastIndexOf(".") + 1).toLowerCase();
  // Identificadores com ponto como `process.env` ou `this.state` terminam em palavras que nenhum projeto usa para nomear arquivo.
  return bare.includes("/") || KNOWN_EXTENSIONS.has(ext);
}

const KNOWN_EXTENSIONS = new Set(
  "md mdx markdown txt json jsonc yaml yml toml ini lock ts tsx js jsx mjs cjs py rb go rs java kt swift c h cc cpp hpp cs php sh bash zsh fish ps1 sql html htm css scss less vue svelte astro xml svg png jpg jpeg gif webp avif ico mp4 webm mov mp3 wav pdf csv tsv log liquid graphql gql proto dockerfile makefile gradle lua dart ex exs erl zig nim r jl scala clj tf hcl".split(" "),
);

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdx|mdown)$/i.test(path);
}

/** A pasta onde um caminho relativo ao projeto está; "" para a raiz. */
export function dirnameOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

export function basenameOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? path : path.slice(index + 1);
}

/** Onde uma edição não salva ou a versão de um arquivo é guardada: um projeto e um caminho. */
export function fileKey(cwd: string, path: string): string {
  return `${cwd}\n${path}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
