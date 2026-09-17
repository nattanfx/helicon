import { ArrowLeft, CornerLeftUp, Folder, FolderPlus, Link } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useApp, useController } from "../../app/context.js";
import { errorMessage } from "../../client.js";
import { cloneUrl, isFullPath, parentFolder, repoName, sameFolder, splitBrowsePath, withTrailingSeparator } from "../../model/paths.js";
import type { DirectoryListing } from "../../types.js";
import { Modal } from "../ui/overlays.js";
import { Kbd, MOD, Spinner, cn } from "../ui/primitives.js";

type Provider = "git" | "github";

type View =
  | { kind: "sources" }
  | { kind: "browse"; initial?: string }
  | { kind: "remote"; provider: Provider }
  | { kind: "destination"; url: string; name: string };

const INPUT = "h-11 min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-subtle";

/**
 * Adicionar um projeto: escolha uma fonte, depois digite ou navegue até uma pasta.
 * via o seletor de adicionar projeto do T3 Code (github.com/pingdotgg/t3code), MIT (c) 2026 T3 Tools Inc.
 * Adaptado: a caixa sempre guarda um caminho completo e o texto após seu último separador filtra as
 * subpastas daquela pasta; Enter adiciona o caminho digitado a não ser que uma linha esteja destacada, e Enter a abre.
 */
export function AddProjectDialog() {
  const controller = useController();
  const open = useApp((s) => s.addProjectOpen);
  return (
    <Modal
      open={open}
      onOpenChange={(next) => controller.setAddProjectOpen(next)}
      title="Adicionar um projeto"
      hideTitle
      bare
      className="top-[12vh] w-[min(640px,calc(100vw-32px))] overflow-hidden"
    >
      {open ? <ProjectPicker /> : null}
    </Modal>
  );
}

function ProjectPicker() {
  const projects = useApp((s) => s.projects);
  const [view, setView] = useState<View>({ kind: "sources" });
  // A navegação começa ao lado do projeto mais recente; o primeiríssimo projeto começa em casa.
  const [base] = useState(() => (projects[0] ? parentFolder(projects[0].cwd) : null) ?? "~/");
  const clone = (url: string) => setView({ kind: "destination", url, name: repoName(url) });
  if (view.kind === "sources") {
    return (
      <Sources
        onPick={(id) => setView(id === "local" ? { kind: "browse" } : { kind: "remote", provider: id })}
        onPath={(path) => setView({ kind: "browse", initial: path })}
        onClone={clone}
      />
    );
  }
  if (view.kind === "remote") {
    return <RemoteInput provider={view.provider} onBack={() => setView({ kind: "sources" })} onContinue={clone} />;
  }
  if (view.kind === "destination") {
    return <FolderBrowser key="destination" initial={`${base}${view.name}`} clone={view.url} onBack={() => setView({ kind: "sources" })} />;
  }
  return <FolderBrowser key="browse" initial={view.initial ?? base} clone={null} onBack={() => setView({ kind: "sources" })} />;
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="currentColor">
      <path d="M12 .5C5.73.5.5 5.73.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.11 3.04.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
    </svg>
  );
}

const SOURCES: { id: "local" | Provider; label: string; description: string; icon: ReactNode }[] = [
  { id: "local", label: "Pasta local", description: "Navegar uma pasta no disco", icon: <FolderPlus size={17} /> },
  { id: "git", label: "URL Git", description: "Clonar de uma URL remota", icon: <Link size={17} /> },
  { id: "github", label: "Repositório GitHub", description: "Clonar owner/repo do GitHub", icon: <GitHubMark /> },
];

/**
 * O primeiro passo aceita um caminho de pasta ou uma URL Git direto: um caminho completo vai direto para a
 * navegação, uma URL ou `owner/repo` oferece clonar, e as linhas de fonte cobrem o resto.
 */
function Sources(props: { onPick: (id: "local" | Provider) => void; onPath: (path: string) => void; onClone: (url: string) => void }) {
  const windows = useApp((s) => s.env?.platform === "win32");
  const [value, setValue] = useState("");
  const [highlight, setHighlight] = useState(0);
  const listId = useId();
  const url = value.trim() ? cloneUrl(value) : null;
  const rows: { id: "local" | Provider | "clone"; label: string; description: string; icon: ReactNode }[] = url
    ? [{ id: "clone", label: `Clonar ${url}`, description: "Depois, escolha onde cloná-lo", icon: <Link size={17} /> }]
    : SOURCES;
  const active = Math.min(highlight, rows.length - 1);
  const pick = (id: (typeof rows)[number]["id"]) => {
    if (id === "clone") {
      if (url) {
        props.onClone(url);
      }
    } else {
      props.onPick(id);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight(Math.min(rows.length - 1, active + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight(Math.max(0, active - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = rows[active];
      if (row) {
        pick(row.id);
      }
    }
  };
  return (
    <>
      <Header icon={<FolderPlus size={17} />}>
        <input
          autoFocus
          value={value}
          spellCheck={false}
          autoComplete="off"
          placeholder={windows ? "Digite um caminho de pasta como D:\\Projects, ou cole uma URL Git" : "Digite um caminho de pasta como ~/code, ou cole uma URL Git"}
          aria-label="Caminho de pasta ou URL Git"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={rows[active] ? `${listId}-${rows[active]?.id}` : undefined}
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (isFullPath(next)) {
              props.onPath(next);
              return;
            }
            setValue(next);
            setHighlight(0);
          }}
          onKeyDown={onKeyDown}
          className={INPUT}
        />
      </Header>
      <div className="p-1.5">
        <p className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-subtle">{url ? "Repositório" : "Fontes"}</p>
        <ul id={listId} role="listbox" aria-label={url ? "Repositório" : "Fontes"}>
          {rows.map((row, index) => (
            <li
              key={row.id}
              id={`${listId}-${row.id}`}
              role="option"
              aria-selected={index === active}
              onMouseMove={() => setHighlight(index)}
              onClick={() => pick(row.id)}
              className={cn("flex cursor-default items-center gap-3 rounded-lg px-2.5 py-2", index === active && "bg-hover")}
            >
              <span className="flex size-5 shrink-0 items-center justify-center text-muted">{row.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-fg">{row.label}</span>
                <span className="block text-xs text-muted">{row.description}</span>
              </span>
            </li>
          ))}
        </ul>
        {value.trim() && !url ? (
          <p className="px-2.5 py-2 text-xs text-muted">
            {windows ? "Comece com um drive como D:\\ ou com ~/ para navegar pastas." : "Comece com / ou ~/ para navegar pastas."}
          </p>
        ) : null}
      </div>
      <Footer
        hints={[
          { keys: ["↑", "↓"], label: "Navegar" },
          { keys: ["Enter"], label: "Selecionar" },
          { keys: ["Esc"], label: "Fechar" },
        ]}
      />
    </>
  );
}

function RemoteInput(props: { provider: Provider; onBack: () => void; onContinue: (url: string) => void }) {
  const [value, setValue] = useState("");
  const [tried, setTried] = useState(false);
  const url = cloneUrl(value);
  const github = props.provider === "github";
  const submit = () => {
    setTried(true);
    if (url) {
      props.onContinue(url);
    }
  };
  return (
    <>
      <Header onBack={props.onBack} action={<ActionButton label="Continuar" keys={["Enter"]} disabled={!url} onClick={submit} />}>
        <input
          autoFocus
          value={value}
          spellCheck={false}
          autoComplete="off"
          aria-label={github ? "Repositório GitHub" : "URL Git"}
          placeholder={github ? "owner/repo" : "https://github.com/owner/repo.git"}
          onChange={(event) => setValue(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            } else if (event.key === "Backspace" && value === "") {
              event.preventDefault();
              props.onBack();
            }
          }}
          className={INPUT}
        />
      </Header>
      <div className="px-4 py-5 text-sm">
        {tried && !url ? (
          <p className="text-danger-text">{github ? "Digite o repositório como owner/repo." : "Isto não parece uma URL Git nem owner/repo."}</p>
        ) : (
          <p className="text-muted">
            {github
              ? "Digite o repositório como owner/repo. Repositórios privados usam suas credenciais Git."
              : "Cole uma URL HTTPS ou SSH, ou owner/repo do GitHub. Depois, escolha onde cloná-lo."}
          </p>
        )}
        {url ? <p className="mt-1.5 truncate font-mono text-xs text-subtle">{url}</p> : null}
      </div>
      <Footer
        hints={[
          { keys: ["Enter"], label: "Continuar" },
          { keys: ["Backspace"], label: "Voltar" },
          { keys: ["Esc"], label: "Fechar" },
        ]}
      />
    </>
  );
}

type Row = { kind: "up"; path: string } | { kind: "folder"; name: string };

/** Lista uma pasta, lembrando cada pasta já listada enquanto o seletor está aberto. */
function useListing(directory: string): { data: DirectoryListing | null; error: string | null; loading: boolean } {
  const controller = useController();
  const cache = useRef(new Map<string, DirectoryListing>());
  const [state, setState] = useState<{ key: string; data: DirectoryListing | null; error: string | null }>({ key: "", data: null, error: null });
  useEffect(() => {
    if (!directory) {
      return;
    }
    const cached = cache.current.get(directory);
    if (cached) {
      setState({ key: directory, data: cached, error: null });
      return;
    }
    let live = true;
    controller.listDirectory(directory).then(
      (data) => {
        cache.current.set(directory, data);
        if (live) {
          setState({ key: directory, data, error: null });
        }
      },
      (error: unknown) => {
        if (live) {
          setState({ key: directory, data: null, error: errorMessage(error) });
        }
      },
    );
    return () => {
      live = false;
    };
  }, [directory, controller]);
  const current = state.key === directory;
  return { data: current ? state.data : null, error: current ? state.error : null, loading: Boolean(directory) && !current };
}

function FolderBrowser(props: { initial: string; clone: string | null; onBack: () => void }) {
  const controller = useController();
  const projects = useApp((s) => s.projects);
  const platform = useApp((s) => s.env?.platform ?? "");
  const busy = useApp((s) => Boolean(s.busy[props.clone ? "cloneProject" : "addProject"]));
  const [input, setInput] = useState(props.initial);
  const [highlight, setHighlight] = useState(-1);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const windows = platform === "win32";
  const { directory, leaf, separator } = splitBrowsePath(input);
  const browsing = isFullPath(input);
  const listing = useListing(browsing ? directory : "");
  const data = listing.data;

  const rows = useMemo<Row[]>(() => {
    if (!data) {
      return [];
    }
    const needle = leaf.toLowerCase();
    const folders = data.entries
      .filter((entry) => (leaf.startsWith(".") || !entry.name.startsWith(".")) && entry.name.toLowerCase().startsWith(needle))
      .map((entry): Row => ({ kind: "folder", name: entry.name }));
    return data.parent && !leaf ? [{ kind: "up", path: withTrailingSeparator(data.parent, data.separator) }, ...folders] : folders;
  }, [data, leaf]);

  // Em que o Enter age: a própria pasta listada, ou a filha que o filtro nomeia, exista ou não.
  const target = useMemo(() => {
    if (!data) {
      return null;
    }
    if (!leaf) {
      return { path: data.directory, exists: data.exists };
    }
    const match = data.entries.find((entry) => (windows ? entry.name.toLowerCase() === leaf.toLowerCase() : entry.name === leaf));
    return { path: withTrailingSeparator(data.directory, data.separator) + (match?.name ?? leaf), exists: Boolean(match) };
  }, [data, leaf, windows]);

  const existing = !props.clone && target ? (projects.find((p) => sameFolder(p.cwd, target.path)) ?? null) : null;

  // A digitação continua de onde parou quando o primeiro passo entrega um caminho.
  useEffect(() => {
    const element = inputRef.current;
    if (element) {
      element.setSelectionRange(element.value.length, element.value.length);
    }
  }, []);

  useEffect(() => {
    if (highlight >= rows.length) {
      setHighlight(rows.length - 1);
    }
  }, [rows.length, highlight]);

  useEffect(() => {
    if (highlight >= 0) {
      listRef.current?.querySelector(`[data-index="${highlight}"]`)?.scrollIntoView({ block: "nearest" });
    }
  }, [highlight]);

  const openRow = (row: Row) => {
    setInput(row.kind === "up" ? row.path : `${directory}${row.name}${separator}`);
    setHighlight(-1);
    inputRef.current?.focus();
  };

  const submit = () => {
    if (!target || busy) {
      return;
    }
    if (props.clone) {
      void controller.cloneProject(props.clone, target.path);
    } else if (existing) {
      controller.setAddProjectOpen(false);
      controller.newThread(existing.cwd);
    } else {
      void controller.addProject(target.path, { create: !target.exists });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((current) => Math.min(rows.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => Math.max(-1, current - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = highlight >= 0 ? rows[highlight] : undefined;
      if (row && !(event.metaKey || event.ctrlKey)) {
        openRow(row);
      } else {
        submit();
      }
    } else if (event.key === "Tab" && !event.shiftKey) {
      // Tab completa para dentro da pasta destacada, ou a primeira que o filtro casa.
      const row = highlight >= 0 ? rows[highlight] : leaf ? rows.find((r) => r.kind === "folder") : undefined;
      if (row) {
        event.preventDefault();
        openRow(row);
      }
    } else if (event.key === "Backspace" && input === "") {
      event.preventDefault();
      props.onBack();
    }
  };

  const action = props.clone ? "Clonar" : existing ? "Abrir" : target && !target.exists ? "Criar e adicionar" : "Adicionar";
  const highlighted = highlight >= 0;
  const reveal = windows ? "Abrir no Explorador de Arquivos" : platform === "darwin" ? "Abrir no Finder" : "Abrir em Arquivos";

  let note: ReactNode = null;
  if (!browsing) {
    note = windows ? "Digite um caminho completo, como D:\\Projects ou ~/code." : "Digite um caminho completo, como ~/code ou /srv/app.";
  } else if (listing.error) {
    note = <span className="text-danger-text">{listing.error}</span>;
  } else if (listing.loading) {
    note = (
      <span className="flex items-center gap-2">
        <Spinner size={12} /> Carregando pastas
      </span>
    );
  } else if (data && !data.exists) {
    note = props.clone ? "Esta pasta ainda não existe. Clonar a cria." : "Esta pasta ainda não existe. Pressione Enter para criá-la e adicioná-la.";
  } else if (data && rows.length === 0) {
    note = leaf
      ? props.clone
        ? `Clonar cria ${leaf} aqui.`
        : `Nenhuma pasta começa com “${leaf}”. Pressione Enter para criá-la.`
      : "Sem pastas aqui.";
  }

  return (
    <>
      <Header
        onBack={props.onBack}
        action={<ActionButton label={action} keys={highlighted ? [MOD, "Enter"] : ["Enter"]} busy={busy} disabled={!target} onClick={submit} />}
      >
        <input
          ref={inputRef}
          autoFocus
          value={input}
          spellCheck={false}
          autoComplete="off"
          aria-label={props.clone ? "Pasta onde clonar" : "Caminho da pasta"}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={highlighted ? `${listId}-${highlight}` : undefined}
          placeholder={windows ? "D:\\Projects\\my-app" : "~/code/my-app"}
          onChange={(event) => {
            setInput(event.currentTarget.value);
            setHighlight(-1);
          }}
          onKeyDown={onKeyDown}
          className={INPUT}
        />
      </Header>
      <div className="h-[min(22rem,55vh)] overflow-y-auto p-1.5">
        <p className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-subtle">{props.clone ? "Clonar em" : "Pastas"}</p>
        <ul ref={listRef} id={listId} role="listbox" aria-label="Pastas">
          {rows.map((row, index) => (
            <li
              key={row.kind === "up" ? ".." : row.name}
              id={`${listId}-${index}`}
              data-index={index}
              role="option"
              aria-selected={index === highlight}
              onMouseMove={() => setHighlight(index)}
              onClick={() => openRow(row)}
              className={cn("flex h-9 cursor-default items-center gap-3 rounded-lg px-2.5 text-sm text-fg", index === highlight && "bg-hover")}
            >
              {row.kind === "up" ? (
                <>
                  <CornerLeftUp size={16} className="shrink-0 text-muted" />
                  <span className="text-muted">..</span>
                </>
              ) : (
                <>
                  <Folder size={16} className="shrink-0 text-muted" />
                  <span className="truncate">
                    <span className="font-semibold">{row.name.slice(0, leaf.length)}</span>
                    {row.name.slice(leaf.length)}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
        {note ? <p className="px-2.5 py-3 text-sm text-muted">{note}</p> : null}
      </div>
      <Footer
        hints={[
          { keys: ["↑", "↓"], label: "Navegar" },
          { keys: ["Enter"], label: highlighted ? "Abrir pasta" : action },
          { keys: ["Backspace"], label: "Voltar" },
          { keys: ["Esc"], label: "Fechar" },
        ]}
        right={
          data?.exists ? (
            <button
              type="button"
              onClick={() => void controller.revealPath(data.directory)}
              className="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-muted transition-colors hover:bg-hover hover:text-fg"
            >
              {reveal}
            </button>
          ) : null
        }
      />
    </>
  );
}

function Header(props: { onBack?: () => void; icon?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-14 items-center gap-2 border-b border-line pr-3 pl-2">
      {/* O espaço inicial tem a mesma largura em todo passo, então o campo nunca pula entre eles. */}
      {props.icon && !props.onBack ? (
        <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center text-subtle">
          {props.icon}
        </span>
      ) : props.onBack ? (
        <button
          type="button"
          aria-label="Voltar"
          onClick={props.onBack}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-fg"
        >
          <ArrowLeft size={17} />
        </button>
      ) : (
        <span className="w-2" />
      )}
      {props.children}
      {props.action}
    </div>
  );
}

function ActionButton(props: { label: string; keys: string[]; onClick: () => void; disabled?: boolean; busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled || props.busy}
      className="flex h-8 shrink-0 items-stretch overflow-hidden rounded-lg text-xs font-medium shadow-btn transition-opacity disabled:opacity-50"
    >
      <span className="flex items-center gap-1.5 bg-raised px-2.5 text-fg">
        {props.busy ? <Spinner size={11} /> : null}
        {props.label}
      </span>
      <span className="flex items-center border-l border-line bg-sunken px-2 text-muted">{props.keys.join(" ")}</span>
    </button>
  );
}

function Footer(props: { hints: { keys: string[]; label: string }[]; right?: ReactNode }) {
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-sunken px-4 py-2 text-xs text-muted">
      {props.hints.map((hint) => (
        <span key={hint.label} className="flex items-center gap-1.5">
          <span className="flex gap-0.5">
            {hint.keys.map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </span>
          {hint.label}
        </span>
      ))}
      <span className="flex-1" />
      {props.right}
    </div>
  );
}
