import { ArrowDownToLine, ArrowLeft, Minus, Plus, RefreshCw, RotateCw, ScrollText, SquareArrowOutUpRight } from "lucide-react";
import { Switch } from "radix-ui";
import { useEffect, useState, type ReactNode } from "react";
import { useApp, useController, useNow } from "../../app/context.js";
import { useOverlayDragProps } from "../../app/frame.js";
import { CONTRIBUTOR_NOTICE, contributorChoiceLabel, modelDisplayName } from "../../model/format.js";
import {
  channelDescription,
  identityHeading,
  identitySummary,
  manualUpdateHint,
  shortBuild,
} from "../../model/identity.js";
import type { NotifyPermission, NotifyTrace } from "../../model/notify.js";
import { CODE_THEMES, ZOOM_MAX, ZOOM_MIN, type CodeTheme, type GroupBy, type ThemePref } from "../../model/store.js";
import type { ApprovalMode, ReasoningEffort } from "../../types.js";
import { LEVELS, MODES } from "../composer/Composer.js";
import { CODE_THEME_LABELS, updateSummary } from "../sidebar/Sidebar.js";
import { NotasDaEdicao } from "../app/NotasDaEdicao.js";
import { Modal } from "../ui/overlays.js";
import { TopBar } from "../chrome.js";
import { Button, IconButton, MOD, cn } from "../ui/primitives.js";

/** O controle de uma linha: uma escolha entre poucas. Rola de lado quando a linha é estreita demais. */
function Pick<T extends string | null>(props: {
  value: T;
  options: readonly { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex max-w-full min-w-0 items-center gap-1 overflow-x-auto overscroll-x-contain rounded-lg bg-sunken p-0.5 [scrollbar-width:thin]">
      {props.options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          title={option.hint}
          aria-pressed={props.value === option.value}
          disabled={props.disabled}
          onClick={() => props.onChange(option.value)}
          className={cn(
            "h-7 shrink-0 rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-40",
            props.value === option.value ? "bg-raised text-fg shadow-btn" : "text-muted hover:text-fg",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Toggle(props: { checked: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <Switch.Root
      checked={props.checked}
      onCheckedChange={props.onChange}
      disabled={props.disabled}
      aria-label={props.label}
      className="relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full bg-line-strong outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-accent"
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

const TRACE_KIND_LABEL: Record<NotifyTrace["kind"], string> = {
  approval: "aprovação",
  question: "pergunta",
  finished: "fim de turno",
  goal: "meta",
};

/** Uma tentativa de aviso em texto legível, para o diagnóstico temporário das notificações. */
function formatNotifyTrace(trace: NotifyTrace): string {
  const hora = new Date(trace.at).toLocaleTimeString("pt-BR", { hour12: false });
  const turno = trace.turnId ? ` ${trace.turnId}` : "";
  const permissao =
    trace.permission === "não consultada" ? "permissão não consultada" : `permissão ${trace.permission} (${trace.permissionMs} ms)`;
  return (
    `${hora} ${TRACE_KIND_LABEL[trace.kind]} ${trace.sessionId}${turno} · ${trace.backend} · ` +
    `balão ${trace.enabled ? "on" : "off"} (1º plano ${trace.balloonForeground ? "on" : "off"}) · ` +
    `som ${trace.sound ? "on" : "off"} (1º plano ${trace.soundForeground ? "on" : "off"}) · foco ${trace.focused ? "sim" : "não"} · ` +
    `${permissao} · balão: ${trace.balloon} · bipe: ${trace.beep}`
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
  const sandboxSettings = useApp((s) => s.sandboxSettings);
  const yoloSettings = useApp((s) => s.yoloSettings);
  const env = useApp((s) => s.env);
  const identity = useApp((s) => s.identity);
  const updates = useApp((s) => s.updates);
  const bypassAll = useApp((s) => s.bypassAll);
  const armedThreads = useApp((s) => s.bypassThreads.length);
  const [confirmBypass, setConfirmBypass] = useState(false);
  const [confirmSandbox, setConfirmSandbox] = useState(false);
  const [confirmYolo, setConfirmYolo] = useState(false);
  const [notasOpen, setNotasOpen] = useState(false);
  const now = useNow(60_000);
  const busy = updates?.status === "checking" || updates?.status === "downloading" || updates?.status === "installing";
  const traces = controller.notificationTrace();
  const userAgent = typeof navigator === "undefined" ? "desconhecido" : navigator.userAgent;
  const [notifyPermission, setNotifyPermission] = useState<NotifyPermission | null>(null);
  useEffect(() => {
    let alive = true;
    void controller.notifyPermission().then((answer) => {
      if (alive) {
        setNotifyPermission(answer);
      }
    });
    return () => {
      alive = false;
    };
  }, [controller, prefs.notifications]);
  const authorizeNotify = async () => {
    await controller.askToNotify();
    setNotifyPermission(await controller.notifyPermission());
  };
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
          <p className="text-xs text-muted">Guardado neste aparelho. A maioria não mexe nas conversas em execução; os interruptores da sandbox e do YOLO reiniciam os servidores Muse na hora.</p>
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
          <Row
            label="Estatísticas da sessão"
            description="Pílulas acima do composer: turnos, velocidade e tokens da conversa aberta. Desligado por padrão."
          >
            <Toggle
              checked={prefs.showTelemetry}
              label="Estatísticas da sessão"
              onChange={(on) => controller.setPrefs({ showTelemetry: on })}
            />
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
                  label: model.contributor ? contributorChoiceLabel(model.modelId) : modelDisplayName(model.modelId),
                  hint: model.contributor ? CONTRIBUTOR_NOTICE : undefined,
                }))}
                onChange={(value) => void controller.setModel(value as string)}
              />
            )}
          </Row>
          <Row label="Permissões" description="O que o Muse pode fazer antes de perguntar.">
            <div className="flex min-w-0 w-full flex-col items-end gap-1 @min-[520px]:w-auto">
              <Pick
                value={prefs.defaultMode}
                options={MODES.map((mode) => ({ value: mode.value as ApprovalMode, label: mode.label, hint: mode.description }))}
                onChange={(value) => void controller.setMode(value as ApprovalMode)}
                disabled={yoloSettings?.enabled === true}
              />
              {yoloSettings?.enabled ? (
                <p className="text-xs text-subtle">O YOLO é dono do modo de cada conversa enquanto ligado. Desligue-o para escolher.</p>
              ) : null}
            </div>
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
            description="Faz no máximo uma tentativa de título por conversa criada com esta opção ligada. Consome seu plano do Muse Code. Se falhar, mantém o primeiro pedido como título e não tenta novamente, mesmo após reiniciar. Conversas antigas não são renomeadas automaticamente. Desligar cancela tentativas pendentes; uma chamada já enviada pode consumir cota."
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
                      label: model.contributor ? contributorChoiceLabel(model.modelId) : modelDisplayName(model.modelId),
                      hint: model.contributor ? CONTRIBUTOR_NOTICE : undefined,
                    })),
                  ]}
                  onChange={(value) => void controller.setTitleModel(value)}
                />
              )}
            </Row>
          ) : null}
        </Section>

        <Section title="Modo YOLO">
          <Row
            label="Modo YOLO"
            description="Como muse --yolo: nada pede aprovação em nenhuma conversa, novas conversas rodam sem confinamento da sandbox, e os workspaces são confiáveis. As conversas já abertas mantêm a proteção de sandbox com que começaram. Mudar isto reinicia os servidores Muse em execução, interrompendo seus turnos."
          >
            {yoloSettings ? (
              <Toggle
                checked={yoloSettings.enabled}
                label="Modo YOLO"
                onChange={(on) => (on ? setConfirmYolo(true) : void controller.setYoloEnabled(false))}
              />
            ) : (
              <p className="text-xs text-subtle">Carregando…</p>
            )}
          </Row>
        </Section>

        <Section title="Sandbox">
          <Row
            label="Desativar a sandbox"
            description={
              yoloSettings?.enabled
                ? "Desligada porque o modo YOLO está ligado: o YOLO já roda novas conversas sem confinamento da sandbox. Desligue o YOLO para controlar isto separadamente."
                : "Os shells do Muse rodam isolados: acesso a arquivos e rede é confinado. Desligar isto remove o confinamento das novas conversas; as abertas mantêm a proteção com que começaram. Mudar isto reinicia os servidores Muse em execução, interrompendo seus turnos."
            }
          >
            {sandboxSettings ? (
              <Toggle
                checked={sandboxSettings.disabled}
                label="Desativar a sandbox"
                disabled={yoloSettings?.enabled === true}
                onChange={(on) => (on ? setConfirmSandbox(true) : void controller.setSandboxDisabled(false))}
              />
            ) : (
              <p className="text-xs text-subtle">Carregando…</p>
            )}
          </Row>
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
            description="Uma notificação do sistema quando uma conversa pedir aprovação, fizer uma pergunta, terminar, falhar ou sua meta parar de andar."
          >
            <Toggle
              checked={prefs.notifications}
              label="Notificações"
              // Ligar precisa pedir, e um navegador só concede permissão a partir de um clique de verdade.
              onChange={(on) => (on ? void controller.askToNotify() : controller.setPrefs({ notifications: false }))}
            />
          </Row>
          {prefs.notifications && notifyPermission !== null && notifyPermission !== "granted" ? (
            <Row
              label="O sistema não autorizou os avisos"
              description="O interruptor acima está ligado, mas nenhum balão pode aparecer sem a autorização."
            >
              <Button size="sm" variant="secondary" onClick={() => void authorizeNotify()}>
                Pedir autorização
              </Button>
            </Row>
          ) : null}
          <Row
            label="Mostrar também com o Helicon em primeiro plano"
            description="Janela com foco não prova que você está olhando; quem se ausenta liga."
          >
            <Toggle
              checked={prefs.notificationsForeground}
              label="Balão em primeiro plano"
              disabled={!prefs.notifications}
              onChange={(on) => controller.setPrefs({ notificationsForeground: on })}
            />
          </Row>
          <Row
            label="Tocar som junto com o aviso"
            description="Um bipe suave a cada aviso, com ou sem o balão acima."
          >
            <Toggle
              checked={prefs.notificationSound}
              label="Som da notificação"
              onChange={(on) => controller.setPrefs({ notificationSound: on })}
            />
          </Row>
          <Row
            label="Tocar também com o Helicon em primeiro plano"
            description="Para o bipe vale o mesmo que vale para o balão acima."
          >
            <Toggle
              checked={prefs.notificationSoundForeground}
              label="Som em primeiro plano"
              disabled={!prefs.notificationSound}
              onChange={(on) => controller.setPrefs({ notificationSoundForeground: on })}
            />
          </Row>
          <Row
            label="Provar cada canal"
            description="Toca o bipe e mostra um balão de prova na hora, mesmo com esta janela aberta. O balão de prova precisa da autorização do sistema."
          >
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => void controller.testNotify("sound")}>
                Testar som
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void controller.testNotify("balloon")}>
                Testar balão
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void controller.testNotify("both")}>
                Testar ambos
              </Button>
            </div>
          </Row>
          <div className="border-t border-line px-4 py-3">
            <p className="text-sm text-fg">Diagnóstico temporário</p>
            <p className="mt-0.5 text-xs text-muted">
              Últimas tentativas de aviso nesta sessão, para investigar a falha após abrir o app. Temporário:
              será removido. Abra esta tela logo após reproduzir a falha.
            </p>
            <p className="mt-1 font-mono text-2xs break-all text-muted">Agente: {userAgent}</p>
            {traces.length === 0 ? (
              <p className="mt-1 text-xs text-muted">Nenhuma tentativa desde que o app abriu.</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {[...traces].reverse().map((trace, index) => (
                  <li key={`${trace.at}-${index}`} className="font-mono text-2xs break-all text-fg">
                    {formatNotifyTrace(trace)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>

        <Section title="Versão">
          <Row
            label={identity ? identityHeading(identity) : `Helicon ${env?.version ?? ""}`.trim() || "Helicon"}
            description={identity ? identitySummary(identity) : "Versão informada pelo servidor local."}
          />
          {identity ? <Row label="Canal" description={channelDescription(identity.channel)} /> : null}
          {identity?.identifier ? <Fact label="Identificador" value={identity.identifier} /> : null}
          {identity?.build ? <Fact label="Compilação" value={shortBuild(identity.build)} /> : null}
          <Row
            label="Atualização"
            description={identity ? manualUpdateHint(identity.channel) : "Este fork não atualiza sozinho. Use o instalador publicado no repositório GitHub deste fork."}
          >
            <a
              href={identity?.updateUrl ?? "https://github.com/nattanfx/helicon"}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md bg-raised px-2.5 text-sm font-medium text-fg shadow-btn hover:bg-hover"
            >
              <SquareArrowOutUpRight size={13} /> Abrir página de atualização
            </a>
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
          <Row
            label="Novidades desta edição"
            description="As notas desta edição do fork, guardadas no próprio aplicativo. Ler não envia nada nem muda nada."
          >
            <Button size="sm" variant="secondary" onClick={() => setNotasOpen(true)}>
              <ScrollText size={13} /> Ler
            </Button>
          </Row>
          <Fact label="Servidor" value={env?.version ?? "Desconhecido"} />
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

      <NotasDaEdicao open={notasOpen} onClose={() => setNotasOpen(false)} />
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

      <Modal
        open={confirmYolo}
        onOpenChange={setConfirmYolo}
        title="Ligar o modo YOLO?"
        description="Como muse --yolo: nada pede aprovação em nenhuma conversa, novas conversas rodam sem confinamento da sandbox, e os workspaces são confiáveis. Os servidores Muse em execução reiniciam, interrompendo seus turnos, e as conversas já abertas mantêm a proteção de sandbox com que começaram. Isto fica ligado até você desligar."
      >
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmYolo(false)}>
            Continuar perguntando
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmYolo(false);
              void controller.setYoloEnabled(true);
            }}
          >
            Ligar o YOLO
          </Button>
        </div>
      </Modal>

      <Modal
        open={confirmSandbox}
        onOpenChange={setConfirmSandbox}
        title="Desativar a sandbox do Muse?"
        description="Os shells das novas conversas vão rodar sem confinamento de arquivos ou rede, e os servidores Muse em execução reiniciam, interrompendo seus turnos. As conversas já abertas mantêm o confinamento atual. Só faça isto num ambiente descartável."
      >
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmSandbox(false)}>
            Manter a sandbox
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmSandbox(false);
              void controller.setSandboxDisabled(true);
            }}
          >
            Desativar a sandbox
          </Button>
        </div>
      </Modal>
      </div>
    </div>
  );
}
