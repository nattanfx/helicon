import { Command } from "cmdk";
import { FolderPlus, Folder, Layers, Monitor, Moon, PanelLeft, RefreshCw, RotateCcw, RotateCw, Search, SquarePen, Sun, ZoomIn, ZoomOut } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { useApp, useController, useNow } from "../../app/context.js";
import { basename, displayTitle, relativeTime } from "../../model/format.js";
import { threadStatus } from "../../model/status.js";
import { Modal } from "../ui/overlays.js";
import { MOD, Shortcut } from "../ui/primitives.js";
import { StatusGlyph } from "../ui/StatusGlyph.js";

const GROUP =
  "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-subtle";
const ITEM =
  "flex h-9 cursor-default items-center gap-3 rounded-lg px-2.5 text-sm text-fg outline-none select-none data-[selected=true]:bg-hover";

function Item(props: { value: string; keywords?: string[]; onSelect: () => void; icon: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <Command.Item value={props.value} keywords={props.keywords} onSelect={props.onSelect} className={ITEM}>
      <span className="flex size-4 shrink-0 items-center justify-center text-muted">{props.icon}</span>
      <span className="flex min-w-0 flex-1 items-center gap-2">{props.children}</span>
      {props.hint ? <span className="shrink-0 text-xs text-subtle">{props.hint}</span> : null}
    </Command.Item>
  );
}

export function CommandPalette() {
  const controller = useController();
  const open = useApp((s) => s.paletteOpen);
  const sessions = useApp((s) => s.sessions);
  const projects = useApp((s) => s.projects);
  const threads = useApp((s) => s.threads);
  const baseline = useApp((s) => s.prefs.baseline);
  const lastSeen = useApp((s) => s.prefs.lastSeen);
  const groupBy = useApp((s) => s.prefs.groupBy);
  const updates = useApp((s) => s.updates);
  const now = useNow(60_000, open);

  const sorted = useMemo(
    () => Object.values(sessions).sort((a, b) => (a.activityAt < b.activityAt ? 1 : -1)),
    [sessions],
  );

  const run = (action: () => void) => {
    controller.setPaletteOpen(false);
    action();
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => controller.setPaletteOpen(next)}
      title="Buscar conversas, projetos e ações"
      hideTitle
      bare
      className="top-[12%] w-[min(620px,calc(100%-16px))] overflow-hidden"
    >
      <Command loop label="Buscar conversas, projetos e ações">
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search size={16} className="shrink-0 text-subtle" />
          <Command.Input
            placeholder="Buscar conversas, projetos e ações"
            className="h-12 min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-subtle"
          />
        </div>
        <Command.List className="max-h-[min(440px,62vh)] overflow-y-auto p-1.5">
          <Command.Empty className="px-3 py-10 text-center text-sm text-muted">Nada corresponde a essa busca.</Command.Empty>
          <Command.Group heading="Ações" className={GROUP}>
            <Item value="Nova conversa" icon={<SquarePen size={15} />} onSelect={() => run(() => controller.newThread())} hint={<Shortcut keys={[MOD, "Shift", "O"]} />}>
              Nova conversa
            </Item>
            <Item value="Adicionar pasta de projeto" icon={<FolderPlus size={15} />} onSelect={() => run(() => controller.setAddProjectOpen(true))}>
              Adicionar projeto
            </Item>
            <Item value="Atualizar conversas a partir do Muse" icon={<RefreshCw size={15} />} onSelect={() => run(() => void controller.discoverAll())}>
              Atualizar conversas a partir do Muse
            </Item>
            <Item
              value={groupBy === "project" ? "Agrupar barra lateral por status" : "Agrupar barra lateral por projeto"}
              icon={<Layers size={15} />}
              onSelect={() => run(() => controller.setGroupBy(groupBy === "project" ? "status" : "project"))}
            >
              {groupBy === "project" ? "Agrupar barra lateral por status" : "Agrupar barra lateral por projeto"}
            </Item>
            <Item value="Alternar barra lateral" icon={<PanelLeft size={15} />} onSelect={() => run(() => controller.toggleSidebar())} hint={<Shortcut keys={[MOD, "B"]} />}>
              Alternar barra lateral
            </Item>
            <Item value="Tema do sistema" keywords={["aparência"]} icon={<Monitor size={15} />} onSelect={() => run(() => controller.setTheme("system"))}>
              Usar tema do sistema
            </Item>
            <Item value="Tema claro" keywords={["aparência"]} icon={<Sun size={15} />} onSelect={() => run(() => controller.setTheme("light"))}>
              Usar tema claro
            </Item>
            <Item value="Tema escuro" keywords={["aparência"]} icon={<Moon size={15} />} onSelect={() => run(() => controller.setTheme("dark"))}>
              Usar tema escuro
            </Item>
            <Item value="Ampliar" keywords={["aparência", "maior", "tamanho da fonte"]} icon={<ZoomIn size={15} />} onSelect={() => run(() => controller.zoomIn())} hint={<Shortcut keys={[MOD, "+"]} />}>
              Ampliar
            </Item>
            <Item value="Reduzir" keywords={["aparência", "menor", "tamanho da fonte"]} icon={<ZoomOut size={15} />} onSelect={() => run(() => controller.zoomOut())} hint={<Shortcut keys={[MOD, "-"]} />}>
              Reduzir
            </Item>
            <Item value="Redefinir zoom" keywords={["aparência", "100%"]} icon={<RotateCcw size={15} />} onSelect={() => run(() => controller.resetZoom())} hint={<Shortcut keys={[MOD, "0"]} />}>
              Redefinir zoom
            </Item>
            {updates?.status === "ready" ? (
              <Item value="Reiniciar para atualizar" keywords={["atualização", "atualizar", "instalar", "versão"]} icon={<RotateCw size={15} />} onSelect={() => run(() => controller.restartToUpdate())}>
                Reiniciar para instalar o Helicon {updates.update?.version ?? ""}
              </Item>
            ) : null}
            {updates ? (
              <Item value="Verificar atualizações" keywords={["atualização", "atualizar", "versão"]} icon={<RefreshCw size={15} />} onSelect={() => run(() => controller.checkForUpdates())}>
                Verificar atualizações
              </Item>
            ) : null}
          </Command.Group>
          {sorted.length > 0 ? (
            <Command.Group heading="Conversas" className={GROUP}>
              {sorted.map((session) => {
                const status = threadStatus(session, {
                  fold: threads[session.sessionId]?.fold ?? null,
                  lastSeen: lastSeen[session.sessionId] ?? null,
                  baseline,
                  active: false,
                });
                return (
                  <Item
                    key={session.sessionId}
                    value={`${displayTitle(session)} ${session.sessionId}`}
                    keywords={[basename(session.cwd)]}
                    icon={status === "idle" ? <span className="size-[7px] rounded-full bg-line-strong" /> : <StatusGlyph status={status} />}
                    onSelect={() => run(() => controller.openThread(session.sessionId))}
                    hint={relativeTime(session.activityAt, now)}
                  >
                    <span className="truncate">{displayTitle(session)}</span>
                    <span className="shrink-0 truncate text-xs text-subtle">{basename(session.cwd)}</span>
                  </Item>
                );
              })}
            </Command.Group>
          ) : null}
          {projects.length > 0 ? (
            <Command.Group heading="Projetos" className={GROUP}>
              {projects.map((project) => (
                <Item
                  key={project.cwd}
                  value={`Nova conversa em ${project.displayName} ${project.cwd}`}
                  icon={<Folder size={15} />}
                  onSelect={() => run(() => controller.newThread(project.cwd))}
                >
                  <span className="truncate">Nova conversa em {project.displayName}</span>
                  <span className="truncate text-xs text-subtle">{project.cwd}</span>
                </Item>
              ))}
            </Command.Group>
          ) : null}
        </Command.List>
      </Command>
    </Modal>
  );
}
