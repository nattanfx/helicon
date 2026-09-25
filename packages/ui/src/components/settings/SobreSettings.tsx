import { ArrowDownToLine, RefreshCw, RotateCw, ScrollText, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp, useController, useNow } from "../../app/context.js";
import { formatFailureEntry } from "../../model/failures.js";
import {
  channelDescription,
  identityHeading,
  identitySummary,
  manualUpdateHint,
  shortBuild,
} from "../../model/identity.js";
import type { NotifyTrace } from "../../model/notify.js";
import type { FailureEntry } from "../../types.js";
import { updateSummary } from "../sidebar/Sidebar.js";
import { NotasDaEdicao } from "../app/NotasDaEdicao.js";
import { Button, cn } from "../ui/primitives.js";
import { Modal } from "../ui/overlays.js";
import { Card, Fact, Row, Subhead, Toggle } from "./rows.js";

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

function Versao() {
  const env = useApp((s) => s.env);
  const identity = useApp((s) => s.identity);
  return (
    <>
      <Subhead>Versão</Subhead>
      <Card>
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
      </Card>
    </>
  );
}

function AtualizacoesAutomaticas() {
  const controller = useController();
  const prefs = useApp((s) => s.prefs);
  const updates = useApp((s) => s.updates);
  const now = useNow(60_000);
  if (!updates) {
    return null;
  }
  const busy = updates.status === "checking" || updates.status === "downloading" || updates.status === "installing";
  return (
    <>
      <Subhead>Atualizações automáticas</Subhead>
      <Card>
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
      </Card>
    </>
  );
}

function Ambiente() {
  const env = useApp((s) => s.env);
  const [notasOpen, setNotasOpen] = useState(false);
  return (
    <>
      <Subhead>Ambiente</Subhead>
      <Card>
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
      </Card>
      <NotasDaEdicao open={notasOpen} onClose={() => setNotasOpen(false)} />
    </>
  );
}

type FailuresView = { status: "loading" } | { status: "error" } | { status: "ready"; count: number; recent: FailureEntry[] };

function Diagnostico() {
  const controller = useController();
  const traces = controller.notificationTrace();
  const userAgent = typeof navigator === "undefined" ? "desconhecido" : navigator.userAgent;
  const [failures, setFailures] = useState<FailuresView>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  useEffect(() => {
    let alive = true;
    setFailures({ status: "loading" });
    controller
      .listFailures(50)
      .then((answer) => {
        if (alive) {
          setFailures({ status: "ready", count: answer.count, recent: answer.recent });
        }
      })
      .catch(() => {
        if (alive) {
          setFailures({ status: "error" });
        }
      });
    return () => {
      alive = false;
    };
  }, [controller, reload]);
  const clearDisabled = failures.status === "loading" || clearing || (failures.status === "ready" && failures.count === 0);
  const clear = () => {
    if (clearing) {
      return;
    }
    setClearing(true);
    controller
      .clearFailures()
      .then((answer) => {
        setFailures({ status: "ready", count: answer.count, recent: answer.recent });
        setConfirmClear(false);
        controller.toast("info", "Histórico de falhas apagado");
      })
      .catch((error: unknown) => {
        setConfirmClear(false);
        controller.toast("error", "Não foi possível apagar as falhas", error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        setClearing(false);
      });
  };
  return (
    <>
      <Subhead>Diagnóstico</Subhead>
      <Card>
        <Row
          label="Falhas do servidor"
          description="A caixa-preta do servidor: turnos que falharam e reinícios, com ids e detalhe técnico. Nunca traz texto das conversas."
        >
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" disabled={failures.status === "loading" || clearing} onClick={() => setReload((n) => n + 1)}>
              <RefreshCw size={13} className={cn(failures.status === "loading" && "animate-spin")} /> Recarregar
            </Button>
            <Button size="sm" variant="secondary" disabled={clearDisabled} onClick={() => setConfirmClear(true)}>
              <Trash2 size={13} /> Limpar
            </Button>
          </div>
        </Row>
        <div className="border-t border-line px-4 py-3">
          {failures.status === "loading" ? (
            <p className="text-xs text-muted">Carregando falhas…</p>
          ) : failures.status === "error" ? (
            <p className="text-xs text-muted">Não foi possível carregar as falhas. Tente recarregar.</p>
          ) : failures.recent.length === 0 ? (
            <p className="text-xs text-muted">Nenhuma falha registrada.</p>
          ) : (
            <>
              <p className="text-xs text-muted">
                {failures.count === 1 ? "1 falha guardada" : `${failures.count} falhas guardadas`}; as mais recentes primeiro.
              </p>
              <ul className="mt-1 space-y-1">
                {[...failures.recent].reverse().map((entry, index) => (
                  <li key={`${entry.at}-${index}`} className="font-mono text-2xs break-all text-fg">
                    {formatFailureEntry(entry)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
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
      </Card>
      <Modal
        open={confirmClear}
        onOpenChange={(open) => {
          if (!open && !clearing) {
            setConfirmClear(false);
          }
        }}
        title="Apagar o histórico de falhas?"
        description={
          failures.status === "ready" && failures.count > 0
            ? `${failures.count === 1 ? "A falha guardada some" : `As ${failures.count} falhas guardadas somem`} da caixa-preta e do arquivo, para sempre. Falhas novas continuam sendo registradas.`
            : "O histórico da caixa-preta é apagado, para sempre. Falhas novas continuam sendo registradas."
        }
      >
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" disabled={clearing} onClick={() => setConfirmClear(false)}>
            Cancelar
          </Button>
          <Button variant="danger" disabled={clearing} onClick={clear}>
            Apagar tudo
          </Button>
        </div>
      </Modal>
    </>
  );
}

/** Versão, atualizações automáticas quando o shell oferece, ambiente e diagnóstico. */
export function Sobre() {
  return (
    <>
      <Versao />
      <AtualizacoesAutomaticas />
      <Ambiente />
      <Diagnostico />
    </>
  );
}
