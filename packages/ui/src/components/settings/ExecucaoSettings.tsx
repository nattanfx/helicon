import { useState } from "react";
import { useApp, useController } from "../../app/context.js";
import { Button } from "../ui/primitives.js";
import { Modal } from "../ui/overlays.js";
import { Card, Row, Subhead, Toggle } from "./rows.js";

/** Modo YOLO, sandbox e aprovações respondidas por você, numa página só. */
export function Seguranca() {
  return (
    <>
      <Subhead>Modo YOLO</Subhead>
      <ModoYolo />
      <Subhead>Sandbox</Subhead>
      <Sandbox />
      <Subhead>Aprovações</Subhead>
      <Aprovacoes />
    </>
  );
}

/** Como muse --yolo: nada pede aprovação, sem confinamento nas novas conversas. Reinicia os servidores Muse na hora. */
export function ModoYolo() {
  const controller = useController();
  const yoloSettings = useApp((s) => s.yoloSettings);
  const [confirmYolo, setConfirmYolo] = useState(false);
  return (
    <>
      <Card>
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
      </Card>
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
    </>
  );
}

/** Confinamento dos shells do Muse. Mudar reinicia os servidores Muse na hora. */
export function Sandbox() {
  const controller = useController();
  const sandboxSettings = useApp((s) => s.sandboxSettings);
  const yoloSettings = useApp((s) => s.yoloSettings);
  const [confirmSandbox, setConfirmSandbox] = useState(false);
  return (
    <>
      <Card>
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
      </Card>
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
    </>
  );
}

/** Responder aprovações no lugar do usuário, até o Helicon fechar. */
export function Aprovacoes() {
  const controller = useController();
  const bypassAll = useApp((s) => s.bypassAll);
  const armedThreads = useApp((s) => s.bypassThreads.length);
  const [confirmBypass, setConfirmBypass] = useState(false);
  return (
    <>
      <Card>
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
      </Card>
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
    </>
  );
}
