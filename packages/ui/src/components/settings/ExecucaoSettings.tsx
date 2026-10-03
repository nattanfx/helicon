import { useState } from "react";
import { useApp, useController } from "../../app/context.js";
import { basename } from "../../model/format.js";
import { sandboxOff, yoloOn } from "../../model/store.js";
import { yoloConfirmText } from "../composer/Composer.js";
import { Button } from "../ui/primitives.js";
import { Modal } from "../ui/overlays.js";
import { Card, Row, Subhead, Toggle } from "./rows.js";

/**
 * Modo YOLO, sandbox e aprovações respondidas por você, numa página só. YOLO e sandbox são de um projeto por vez:
 * a página abre no projeto de onde o usuário veio e diz qual é, e os outros projetos não mudam.
 */
export function Seguranca() {
  const controller = useController();
  const projects = useApp((s) => s.projects);
  const [chosen, setChosen] = useState<string | null>(() => controller.postureCwd());
  const cwd = chosen && projects.some((p) => p.cwd === chosen) ? chosen : (projects[0]?.cwd ?? null);
  return (
    <>
      <Subhead>Projeto</Subhead>
      <Card>
        <Row
          label="Projeto afetado"
          description="O modo YOLO e a sandbox valem só para este projeto. Os outros continuam com a própria configuração, e todo projeto novo começa protegido."
        >
          {projects.length === 0 ? (
            <p className="text-xs text-subtle">Nenhum projeto ainda</p>
          ) : (
            <select
              aria-label="Projeto afetado"
              value={cwd ?? ""}
              onChange={(event) => setChosen(event.target.value)}
              title={cwd ?? undefined}
              className="h-7 max-w-[260px] min-w-0 truncate rounded-md border border-line bg-sunken px-2 text-xs text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {projects.map((project) => (
                <option key={project.cwd} value={project.cwd}>
                  {project.displayName}
                </option>
              ))}
            </select>
          )}
        </Row>
      </Card>
      <Subhead>Modo YOLO</Subhead>
      <ModoYolo cwd={cwd} />
      <Subhead>Sandbox</Subhead>
      <Sandbox cwd={cwd} />
      <Subhead>Aprovações</Subhead>
      <Aprovacoes />
    </>
  );
}

/** Como muse --yolo, só no projeto escolhido: nada pede aprovação, sem confinamento nas novas conversas. Reinicia o servidor Muse dele. */
export function ModoYolo(props: { cwd: string | null }) {
  const controller = useController();
  const loaded = useApp((s) => s.yoloSettings !== null);
  const enabled = useApp((s) => yoloOn(s, props.cwd));
  const [confirmYolo, setConfirmYolo] = useState(false);
  const project = props.cwd ? basename(props.cwd) : null;
  return (
    <>
      <Card>
        <Row
          label={project ? `Modo YOLO em ${project}` : "Modo YOLO"}
          description="Como muse --yolo, só neste projeto: nada pede aprovação nas conversas dele, as novas conversas dele rodam sem confinamento da sandbox, e a pasta dele é confiável. As conversas já abertas mantêm a proteção de sandbox com que começaram. Mudar isto reinicia o servidor Muse do projeto, interrompendo seus turnos."
        >
          {!props.cwd ? (
            <p className="text-xs text-subtle">Adicione um projeto</p>
          ) : loaded ? (
            <Toggle
              checked={enabled}
              label={`Modo YOLO em ${project}`}
              onChange={(on) => (on ? setConfirmYolo(true) : void controller.setYoloEnabled(props.cwd as string, false))}
            />
          ) : (
            <p className="text-xs text-subtle">Carregando…</p>
          )}
        </Row>
      </Card>
      <Modal
        open={confirmYolo}
        onOpenChange={setConfirmYolo}
        title={project ? `Ligar o modo YOLO em ${project}?` : "Ligar o modo YOLO?"}
        description={yoloConfirmText(props.cwd)}
      >
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmYolo(false)}>
            Continuar perguntando
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmYolo(false);
              if (props.cwd) {
                void controller.setYoloEnabled(props.cwd, true);
              }
            }}
          >
            Ligar o YOLO
          </Button>
        </div>
      </Modal>
    </>
  );
}

/** Confinamento dos shells do Muse no projeto escolhido. Mudar reinicia o servidor Muse dele na hora. */
export function Sandbox(props: { cwd: string | null }) {
  const controller = useController();
  const loaded = useApp((s) => s.sandboxSettings !== null);
  const disabled = useApp((s) => sandboxOff(s, props.cwd));
  const yolo = useApp((s) => yoloOn(s, props.cwd));
  const [confirmSandbox, setConfirmSandbox] = useState(false);
  const project = props.cwd ? basename(props.cwd) : null;
  const where = props.cwd ? `do projeto ${project} (${props.cwd})` : "deste projeto";
  return (
    <>
      <Card>
        <Row
          label={project ? `Desativar a sandbox em ${project}` : "Desativar a sandbox"}
          description={
            yolo
              ? "Desligada porque o modo YOLO está ligado neste projeto: o YOLO já roda as novas conversas dele sem confinamento da sandbox. Desligue o YOLO do projeto para controlar isto separadamente."
              : "Os shells do Muse rodam isolados: acesso a arquivos e rede é confinado. Desligar isto remove o confinamento das novas conversas deste projeto, e só dele; as abertas mantêm a proteção com que começaram. Mudar isto reinicia o servidor Muse do projeto, interrompendo seus turnos."
          }
        >
          {!props.cwd ? (
            <p className="text-xs text-subtle">Adicione um projeto</p>
          ) : loaded ? (
            <Toggle
              checked={disabled}
              label={`Desativar a sandbox em ${project}`}
              disabled={yolo}
              onChange={(on) => (on ? setConfirmSandbox(true) : void controller.setSandboxDisabled(props.cwd as string, false))}
            />
          ) : (
            <p className="text-xs text-subtle">Carregando…</p>
          )}
        </Row>
      </Card>
      <Modal
        open={confirmSandbox}
        onOpenChange={setConfirmSandbox}
        title={project ? `Desativar a sandbox do Muse em ${project}?` : "Desativar a sandbox do Muse?"}
        description={`Os shells das novas conversas ${where} vão rodar sem confinamento de arquivos ou rede, e o servidor Muse dele reinicia, interrompendo seus turnos. Os outros projetos continuam protegidos, e as conversas já abertas mantêm o confinamento atual. Só faça isto num ambiente descartável.`}
      >
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmSandbox(false)}>
            Manter a sandbox
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmSandbox(false);
              if (props.cwd) {
                void controller.setSandboxDisabled(props.cwd, true);
              }
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
