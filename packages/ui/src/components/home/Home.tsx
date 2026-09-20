import { Check, ChevronDown, FolderPlus, RefreshCw } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { useApp, useController, useNow } from "../../app/context.js";
import { displayTitle, relativeTime, shortenPath } from "../../model/format.js";
import type { ProjectView } from "../../types.js";
import { TopBar } from "../chrome.js";
import { Composer, ComposerFooter } from "../composer/Composer.js";
import { CopyButton } from "../ui/Markdown.js";
import { Menu, MenuContent, MenuItem, MenuOption, MenuRadioGroup, MenuSeparator, MenuTrigger } from "../ui/overlays.js";
import { Button, Logo, Spinner, cn } from "../ui/primitives.js";
import { FolderArt } from "./FolderArt.js";

const DISPLAY = "font-display text-[2.125rem] leading-[1.15] font-normal tracking-[-0.015em] text-fg text-balance";

export function NewThread(props: { cwd: string | null }) {
  const controller = useController();
  const projects = useApp((s) => s.projects);
  const sessions = useApp((s) => s.sessions);
  const now = useNow(60_000);
  const project = projects.find((p) => p.cwd === props.cwd) ?? projects[0] ?? null;
  const recent = useMemo(
    () =>
      project
        ? Object.values(sessions)
            .filter((s) => s.cwd === project.cwd)
            .sort((a, b) => (a.activityAt < b.activityAt ? 1 : -1))
            .slice(0, 5)
        : [],
    [sessions, project],
  );
  if (!project) {
    return <Welcome />;
  }
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <TopBar />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col justify-center px-6 pt-6 pb-[12vh]">
          <h1 className={DISPLAY}>
            Começar uma conversa em <ProjectSwitcher project={project} projects={projects} />
          </h1>
          <div className="mt-7">
            <Composer sessionId={null} cwd={project.cwd} running={false} readOnly={false} variant="home" autoFocus />
          </div>
          <ComposerFooter cwd={project.cwd} branch={null} running={false} />
          {recent.length > 0 ? (
            <section className="mt-12" aria-label={`Conversas recentes em ${project.displayName}`}>
              <h2 className="px-2 text-xs font-medium text-subtle">Recentes em {project.displayName}</h2>
              <ul className="mt-1.5 flex flex-col">
                {recent.map((session) => (
                  <li key={session.sessionId}>
                    <button
                      type="button"
                      onClick={() => controller.openThread(session.sessionId)}
                      className="flex h-9 w-full items-center gap-3 rounded-lg px-2 text-left transition-colors hover:bg-hover"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-muted">{displayTitle(session)}</span>
                      <span className="shrink-0 text-xs text-subtle tabular-nums">{relativeTime(session.activityAt, now)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ProjectSwitcher(props: { project: ProjectView; projects: ProjectView[] }) {
  const controller = useController();
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-baseline gap-1 rounded-md text-accent-text underline decoration-dotted decoration-[1.5px] underline-offset-[7px] outline-offset-4 transition-colors hover:decoration-solid data-[state=open]:decoration-solid"
        >
          {props.project.displayName}
          <ChevronDown size={22} strokeWidth={1.75} className="translate-y-[3px] self-center" aria-hidden="true" />
        </button>
      </MenuTrigger>
      <MenuContent className="w-[320px]">
        <MenuRadioGroup value={props.project.cwd} onValueChange={(cwd) => controller.newThread(cwd)}>
          {props.projects.map((p) => (
            <MenuOption
              key={p.cwd}
              value={p.cwd}
              label={p.displayName}
              description={
                <span className="block truncate" title={p.cwd}>
                  {shortenPath(p.cwd, 44)}
                </span>
              }
            />
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem icon={<FolderPlus size={14} />} onSelect={() => controller.setAddProjectOpen(true)}>
          Adicionar projeto
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

export function Welcome() {
  const controller = useController();
  const discovering = useApp((s) => s.discovering);
  const busy = useApp((s) => Boolean(s.busy["addProject"]));
  const windows = useApp((s) => s.env?.platform === "win32");
  const [path, setPath] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void controller.addProject(path);
  };
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 pb-[10vh]">
        <div className="w-full max-w-[540px]">
          <FolderArt label="Adicione seu primeiro projeto" onActivate={() => input.current?.focus()} />
          <h1 className={cn(DISPLAY, "mt-8")}>Bem-vindo ao Helicon</h1>
          <p className="mt-3 text-md leading-relaxed text-pretty text-muted">
            Aponte o Muse para um projeto e comece uma conversa. As conversas moram na barra lateral, agrupadas por projeto, e avisam
            quando precisam de você.
          </p>
          <form className="mt-8 flex gap-2" onSubmit={submit}>
            <input
              ref={input}
              aria-label="Caminho da pasta do projeto"
              value={path}
              spellCheck={false}
              autoComplete="off"
              autoFocus
              placeholder={windows ? "D:\\Projects\\my-app" : "/home/you/code/my-app"}
              onChange={(event) => setPath(event.currentTarget.value)}
              className="h-10 min-w-0 flex-1 rounded-lg bg-raised px-3 font-mono text-base text-fg shadow-[0_0_0_1px_var(--border-strong)] outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)] focus-visible:outline-none sm:text-sm"
            />
            <Button variant="primary" type="submit" className="h-10 px-4" loading={busy} disabled={!path.trim()}>
              Adicionar projeto
            </Button>
          </form>
          <p className="mt-3 flex items-center gap-2 text-xs text-subtle">
            {discovering ? (
              <>
                <Spinner size={10} /> Procurando no Muse conversas que você começou no terminal
              </>
            ) : (
              "Conversas que você começa no terminal do Muse aparecem aqui sozinhas."
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

interface Step {
  ok: boolean | null;
  title: string;
  detail: string;
  command?: string;
}

export function Onboarding() {
  const controller = useController();
  const env = useApp((s) => s.env);
  const checking = useApp((s) => s.boot === "loading");
  if (!env) {
    return null;
  }
  const windows = env.platform === "win32";
  const install = "irm https://dev.meta.ai/install.ps1 | iex";
  const steps: Step[] = [];
  if (windows && (env.runtime === "native" || !env.wslAvailable)) {
    // O Muse roda nativo no Windows agora, então uma instalação nova não precisa de WSL.
    steps.push({
      ok: env.museFound,
      title: "Muse para Windows",
      detail: env.museFound
        ? `Encontrado em ${env.musePath}.`
        : "Instale o Muse pelo PowerShell. Sem WSL. Já usa o Muse dentro do WSL? Configure o WSL e o Helicon o usa lá.",
      command: env.museFound ? undefined : install,
    });
  } else if (windows) {
    steps.push({ ok: true, title: "WSL2 com uma distro Linux", detail: `Usando ${env.defaultDistro ?? "sua distro padrão"}.` });
    steps.push({
      ok: env.museFound,
      title: "O CLI do Muse",
      detail: env.museFound
        ? `Encontrado em ${env.musePath}.`
        : `Instale o Muse para Windows pelo PowerShell (sem WSL), ou instale dentro de ${env.defaultDistro ?? "sua distro WSL"}.`,
      command: env.museFound ? undefined : install,
    });
  } else {
    steps.push({
      ok: env.museFound,
      title: "O CLI do Muse",
      detail: env.museFound ? `Encontrado em ${env.musePath}.` : "Instale o Muse para que o comando muse esteja no PATH.",
    });
  }
  steps.push({
    ok: null,
    title: "Logado no Muse",
    detail: "Rode isto uma vez num terminal. O Helicon usa seu próprio login e nunca vê suas credenciais.",
    command: "muse login",
  });
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-bg px-6 py-10">
      <div className="w-full max-w-[560px]">
        <Logo size={40} />
        <h1 className={cn(DISPLAY, "mt-7")}>Configurar o Muse</h1>
        <p className="mt-3 text-md leading-relaxed text-muted">
          O Helicon dirige o CLI do Muse Code neste computador. Termine estas etapas e verifique de novo.
        </p>
        <ol className="mt-8 flex flex-col gap-2.5">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-3.5 rounded-xl bg-raised p-4 shadow-[0_0_0_1px_var(--border)]">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  step.ok === true ? "bg-ok text-[oklch(0.99_0_0)]" : step.ok === false ? "bg-warn-soft text-warn-text" : "bg-active text-muted",
                )}
                aria-label={step.ok === true ? "Feita" : step.ok === false ? "Precisa de atenção" : "Confira você mesmo"}
              >
                {step.ok === true ? <Check size={13} strokeWidth={3} /> : index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">{step.title}</p>
                <p className="mt-1 text-sm break-words text-muted">{step.detail}</p>
                {step.command ? (
                  <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-sunken py-1 pr-1 pl-3 font-mono text-xs text-fg shadow-[0_0_0_1px_var(--border)]">
                    <span className="min-w-0 flex-1 truncate">{step.command}</span>
                    <CopyButton text={step.command} label="Copiar comando" />
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-6">
          <Button variant="primary" onClick={() => controller.retryBoot()} loading={checking}>
            <RefreshCw size={14} /> Verificar de novo
          </Button>
        </div>
      </div>
    </div>
  );
}

export function BootScreen() {
  return (
    <div className="flex h-full items-center justify-center bg-bg">
      <div className="flex flex-col items-center gap-5">
        <Logo size={36} />
        <span className="flex items-center gap-2 text-sm text-subtle">
          <Spinner size={12} /> Iniciando o Helicon
        </span>
      </div>
    </div>
  );
}

export function BootError() {
  const controller = useController();
  const message = useApp((s) => s.bootError);
  return (
    <div className="flex h-full items-center justify-center bg-bg px-6">
      <div className="w-full max-w-[480px]">
        <Logo size={36} />
        <h1 className={cn(DISPLAY, "mt-6 text-3xl")}>O Helicon não alcançou seu servidor</h1>
        <p className="mt-3 text-sm break-words text-muted">{message ?? "O servidor local do Helicon não respondeu."}</p>
        <div className="mt-6">
          <Button variant="primary" onClick={() => controller.retryBoot()}>
            <RefreshCw size={14} /> Tentar de novo
          </Button>
        </div>
      </div>
    </div>
  );
}
