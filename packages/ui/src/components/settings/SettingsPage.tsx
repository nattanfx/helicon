import { ArrowDownToLine, ArrowLeft, Minus, Plus, RefreshCw, RotateCw } from "lucide-react";
import { Switch } from "radix-ui";
import { useState, type ReactNode } from "react";
import { useApp, useController, useNow } from "../../app/context.js";
import { useOverlayDragProps } from "../../app/frame.js";
import { modelDisplayName } from "../../model/format.js";
import { CODE_THEMES, ZOOM_MAX, ZOOM_MIN, type CodeTheme, type GroupBy, type ThemePref } from "../../model/store.js";
import type { ApprovalMode, ReasoningEffort } from "../../types.js";
import { LEVELS, MODES } from "../composer/Composer.js";
import { CODE_THEME_LABELS, updateSummary } from "../sidebar/Sidebar.js";
import { Modal } from "../ui/overlays.js";
import { TopBar } from "../chrome.js";
import { Button, IconButton, MOD, cn } from "../ui/primitives.js";

/** O controle de uma linha: uma escolha entre poucas. Rola de lado quando a linha é estreita demais. */
function Pick<T extends string | null>(props: {
  value: T;
  options: readonly { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex max-w-full min-w-0 items-center gap-1 overflow-x-auto overscroll-x-contain rounded-lg bg-sunken p-0.5 [scrollbar-width:thin]">
      {props.options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          title={option.hint}
          aria-pressed={props.value === option.value}
          onClick={() => props.onChange(option.value)}
          className={cn(
            "h-7 shrink-0 rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors duration-100",
            props.value === option.value ? "bg-raised text-fg shadow-btn" : "text-muted hover:text-fg",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Toggle(props: { checked: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <Switch.Root
      checked={props.checked}
      onCheckedChange={props.onChange}
      aria-label={props.label}
      className="relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full bg-line-strong outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent data-[state=checked]:bg-accent"
    >
      <Switch.Thumb className="block size-3.5 translate-x-0.5 rounded-full bg-white shadow-[0_1px_2px_oklch(0_0_0/0.3)] transition-transform duration-150 ease-out data-[state=checked]:translate-x-4" />
    </Switch.Root>
  );
}

function Section(props: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-2xs font-semibold tracking-wide text-subtle uppercase">{props.title}</h2>
      <div className="overflow-hidden rounded-2xl bg-raised shadow-card">{props.children}</div>
    </section>
  );
}

function Row(props: { label: string; description?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-t border-line px-4 py-3 first:border-t-0">
      {/* Um piso no rótulo, ou uma fileira larga de opções o espreme a uma palavra por linha em vez de quebrar. */}
      <div className="min-w-[13rem] flex-1 basis-64">
        <p className="text-sm text-fg">{props.label}</p>
        {props.description ? <p className="mt-0.5 text-xs text-pretty text-muted">{props.description}</p> : null}
      </div>
      {props.children ? <div className="min-w-0 w-full @min-[520px]:w-auto">{props.children}</div> : null}
    </div>
  );
}

/** Um fato sobre a instalação, não uma configuração: mostrado para que a resposta esteja aqui, não num balão. */
function Fact(props: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 first:border-t-0">
      <p className="text-sm text-muted">{props.label}</p>
      <p className="min-w-0 font-mono text-xs break-all text-fg">{props.value}</p>
    </div>
  );
}

const THEMES: readonly { value: ThemePref; label: string }[] = [
  { value: "system", label: "Sistema" },
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
];

const GROUPS: readonly { value: GroupBy; label: string }[] = [
  { value: "project", label: "Projeto" },
  { value: "status", label: "Status" },
];

/** Tudo que o Helicon permite configurar, num lugar só: os menus do app são atalhos para cá. */
export function SettingsPage() {
  const controller = useController();
  const prefs = useApp((s) => s.prefs);
  const models = useApp((s) => s.models);
  const titleSettings = useApp((s) => s.titleSettings);
  const env = useApp((s) => s.env);
  const updates = useApp((s) => s.updates);
  const bypassAll = useApp((s) => s.bypassAll);
  const armedThreads = useApp((s) => s.bypassThreads.length);
  const [confirmBypass, setConfirmBypass] = useState(false);
  const now = useNow(60_000);
  const busy = updates?.status === "checking" || updates?.status === "downloading" || updates?.status === "installing";
  const collapsed = useApp((s) => s.prefs.sidebarCollapsed);
  const drag = useOverlayDragProps();

  return (
    <div className="@container flex h-full min-w-0 flex-col">
      {collapsed ? <TopBar /> : null}
      <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
      <header {...drag} className="mx-auto flex w-full max-w-[720px] shrink-0 items-center gap-3 px-4 pt-8 pb-1 @min-[520px]:px-6">
        <Button size="sm" variant="ghost" onClick={() => controller.goBack()}>
          <ArrowLeft size={14} /> Voltar
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-fg">Configurações</h1>
          <p className="text-xs text-muted">Guardado neste aparelho. Nada aqui muda uma conversa que já está rodando.</p>
        </div>
      </header>

      <div className="mx-auto w-full min-w-0 max-w-[720px] px-4 pb-16 @min-[520px]:px-6">
        <Section title="Aparência">
          <Row label="Tema" description="Claro, escuro ou o que este aparelho estiver usando.">
            <Pick value={prefs.theme} options={THEMES} onChange={(value) => controller.setTheme(value)} />
          </Row>
          <Row label="Código" description="Cores para código e diferenças, independentes do tema do app.">
            <Pick
              value={prefs.codeTheme}
              options={CODE_THEMES.map((name) => ({ value: name as CodeTheme, label: CODE_THEME_LABELS[name] }))}
              onChange={(value) => controller.setCodeTheme(value)}
            />
          </Row>
          <Row
            label="Zoom"
            description={`O tamanho da interface inteira. ${MOD} mais, ${MOD} menos e ${MOD} 0 ajustam em qualquer lugar; a porcentagem redefine.`}
          >
            <div className="flex items-center gap-1">
              <IconButton label="Reduzir" size="xs" onClick={() => controller.zoomOut()} disabled={prefs.zoom <= ZOOM_MIN}>
                <Minus size={14} />
              </IconButton>
              <button
                type="button"
                title="Redefinir zoom para 100%"
                onClick={() => controller.resetZoom()}
                className="h-6 min-w-11 rounded-md px-1.5 text-xs text-muted tabular-nums transition-colors duration-100 hover:bg-hover hover:text-fg"
              >
                {Math.round(prefs.zoom * 100)}%
              </button>
              <IconButton label="Ampliar" size="xs" onClick={() => controller.zoomIn()} disabled={prefs.zoom >= ZOOM_MAX}>
                <Plus size={14} />
              </IconButton>
            </div>
          </Row>
        </Section>

        <Section title="Novas conversas">
          <Row label="Modelo" description="Com o que uma nova conversa começa. Mudar aqui não afeta conversas em andamento.">
            {models.length === 0 ? (
              <p className="text-xs text-subtle">Nenhum modelo carregado</p>
            ) : (
              <Pick
                value={prefs.defaultModelId}
                options={models.map((model) => ({
                  value: model.modelId,
                  // As variantes de contribuidor compartilham um nome de exibição, então sem isto a lista
                  // ofereceria a mesma palavra duas vezes e não haveria como dizer qual botão é qual.
                  label: model.contributor ? `${modelDisplayName(model.modelId)} · Contribuidor` : modelDisplayName(model.modelId),
                  hint: model.contributor ? "Nível contribuidor: pedidos e respostas podem ser usados para melhoria do produto." : undefined,
                }))}
                onChange={(value) => void controller.setModel(value as string)}
              />
            )}
          </Row>
          <Row label="Permissões" description="O que o Muse pode fazer antes de perguntar.">
            <Pick
              value={prefs.defaultMode}
              options={MODES.map((mode) => ({ value: mode.value as ApprovalMode, label: mode.label, hint: mode.description }))}
              onChange={(value) => void controller.setMode(value as ApprovalMode)}
            />
          </Row>
          <Row label="Esforço de raciocínio" description="Quanto tempo o modelo pensa antes de responder. Automático deixa o Muse escolher por mensagem.">
            <Pick<ReasoningEffort | null>
              value={prefs.effort}
              options={[
                { value: null, label: "Automático", hint: "O Muse escolhe o esforço de cada mensagem" },
                ...LEVELS.map((level) => ({ value: level.value, label: level.label, hint: level.description })),
              ]}
              onChange={(value) => controller.setEffort(value)}
            />
          </Row>
        </Section>

        <Section title="Lista de conversas">
          <Row label="Agrupar por" description="Como a barra lateral organiza as conversas.">
            <Pick value={prefs.groupBy} options={GROUPS} onChange={(value) => controller.setGroupBy(value)} />
          </Row>
        </Section>

        <Section title="Títulos das conversas">
          <Row
            label="Gerar títulos"
            description="Gera nomes para novas conversas com uma chamada ao modelo, em vez de repetir o primeiro pedido, e renomeia até 30 conversas recentes que ainda repetem o pedido. As chamadas consomem seu plano do Muse Code. Desativado, mantém o primeiro pedido como título e não faz chamadas para gerar títulos."
          >
            {titleSettings ? (
              <Toggle
                checked={titleSettings.enabled}
                label="Gerar títulos"
                onChange={(on) => void controller.setTitleEnabled(on)}
              />
            ) : (
              <p className="text-xs text-subtle">Carregando…</p>
            )}
          </Row>
          {titleSettings?.enabled ? (
            <Row label="Modelo para os títulos" description="Qual modelo gera os títulos. Padrão do Muse deixa a escolha para a CLI.">
              {models.length === 0 ? (
                <p className="text-xs text-subtle">Nenhum modelo carregado</p>
              ) : (
                <Pick<string | null>
                  value={titleSettings.modelId}
                  options={[
                    { value: null, label: "Padrão do Muse" },
                    ...models.map((model) => ({
                      value: model.modelId as string | null,
                      label: model.contributor ? `${modelDisplayName(model.modelId)} · Colaborador` : modelDisplayName(model.modelId),
                      hint: model.contributor ? "Nível de colaborador: pedidos e respostas podem ser usados para melhoria do produto." : undefined,
                    })),
                  ]}
                  onChange={(value) => void controller.setTitleModel(value)}
                />
              )}
            </Row>
          ) : null}
        </Section>

        <Section title="Aprovações">
          <Row
            label="Responder aprovações por mim"
            description={
              bypassAll
                ? "Cada pedido é permitido uma vez, em todas as conversas, sem mostrar o comando. Desliga quando o Helicon fecha."
                : "O Muse pergunta sempre que não consegue resolver um comando, seja qual for o modo de permissão. Isto responde por você, até o Helicon fechar."
            }
          >
            <Toggle
              checked={bypassAll}
              label="Responder aprovações por mim"
              onChange={(on) => (on ? setConfirmBypass(true) : controller.setBypassAll(false))}
            />
          </Row>
          {armedThreads > 0 ? (
            <Row label={`${armedThreads} conversa${armedThreads === 1 ? "" : "s"} respondendo sozinha${armedThreads === 1 ? "" : "s"}`} description="Ativado a partir de um cartão de aprovação.">
              <Button size="sm" variant="secondary" onClick={() => controller.clearThreadBypass()}>
                Perguntar de novo em todas as conversas
              </Button>
            </Row>
          ) : null}
        </Section>

        <Section title="Notificações">
          <Row
            label="Me avisar quando uma conversa precisar de mim"
            description="Uma notificação do sistema quando uma conversa pedir aprovação, fizer uma pergunta, terminar, falhar ou sua meta parar de andar. Só enquanto esta janela estiver em segundo plano."
          >
            <Toggle
              checked={prefs.notifications}
              label="Notificações"
              // Ligar precisa pedir, e um navegador só concede permissão a partir de um clique de verdade.
              onChange={(on) => (on ? void controller.askToNotify() : controller.setPrefs({ notifications: false }))}
            />
          </Row>
        </Section>

        {updates ? (
          <Section title="Atualizações">
            <Row label={`Helicon ${updates.currentVersion ?? ""}`} description={updateSummary(updates, prefs.autoUpdate, prefs.updatesPaused, now)}>
              <div className="flex flex-wrap items-center gap-2">
                {updates.status === "ready" ? (
                  <Button size="sm" variant="primary" onClick={() => controller.restartToUpdate()}>
                    <RotateCw size={13} /> Reiniciar para atualizar
                  </Button>
                ) : null}
                {updates.status === "available" ? (
                  <Button size="sm" variant="secondary" onClick={() => controller.downloadUpdate()}>
                    <ArrowDownToLine size={13} /> Baixar
                  </Button>
                ) : null}
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => controller.checkForUpdates()}>
                  <RefreshCw size={13} className={cn(updates.status === "checking" && "animate-spin")} /> Verificar agora
                </Button>
              </div>
            </Row>
            {updates.error ? <Row label="Último erro" description={updates.error} /> : null}
            <Row label="Atualizações automáticas" description="Baixar novas versões em segundo plano e instalá-las quando o Helicon fechar.">
              <Toggle checked={prefs.autoUpdate} label="Atualizações automáticas" onChange={(on) => controller.setAutoUpdate(on)} />
            </Row>
            <Row label="Pausar atualizações" description="Sem verificar, baixar ou instalar até você retomar.">
              <Toggle checked={prefs.updatesPaused} label="Pausar atualizações" onChange={(on) => controller.setUpdatesPaused(on)} />
            </Row>
          </Section>
        ) : null}

        <Section title="Ambiente">
          <Fact label="Helicon" value={env?.version ?? "Desconhecido"} />
          <Fact label="Plataforma" value={env?.platform ?? "Desconhecido"} />
          {env?.platform === "win32" ? (
            <Fact
              label="O Muse roda"
              value={env.runtime === "native" ? "Nativo no Windows" : `No WSL${env.wslAvailable && env.defaultDistro ? ` (${env.defaultDistro})` : ""}`}
            />
          ) : null}
          <Fact label="Muse" value={env?.musePath ?? (env?.museFound ? "Encontrado" : "Não encontrado")} />
          <Fact label="Sessões" value={env?.persistent ? "Guardadas em disco" : "Só em memória"} />
        </Section>
      </div>

      <Modal
        open={confirmBypass}
        onOpenChange={setConfirmBypass}
        title="Responder aprovações por você?"
        description="Toda aprovação que o Muse pedir, em qualquer conversa, é permitida uma vez sem mostrar o comando antes. O Muse pergunta sobre os comandos que não conseguiu resolver, então são estes que nada mais conferiu. Isto dura até você fechar o Helicon."
      >
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmBypass(false)}>
            Continuar perguntando
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmBypass(false);
              controller.setBypassAll(true);
            }}
          >
            Responda por mim
          </Button>
        </div>
      </Modal>
      </div>
    </div>
  );
}
