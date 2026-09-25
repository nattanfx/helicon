import { Minus, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp, useController } from "../../app/context.js";
import type { NotifyPermission } from "../../model/notify.js";
import { formatShortcutKeys, SHORTCUTS } from "../../model/shortcuts.js";
import { CODE_THEMES, ZOOM_MAX, ZOOM_MIN, type CodeTheme, type ThemePref } from "../../model/store.js";
import { CODE_THEME_LABELS } from "../sidebar/Sidebar.js";
import { Button, IconButton, isMac, MOD, cn } from "../ui/primitives.js";
import { Card, Pick, Row, Subhead, Toggle } from "./rows.js";

const THEMES: readonly { value: ThemePref; label: string }[] = [
  { value: "system", label: "Sistema" },
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
];

/** Tema, cores do código, zoom e estatísticas da sessão. */
export function Aparencia() {
  const controller = useController();
  const prefs = useApp((s) => s.prefs);
  return (
    <Card>
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
    </Card>
  );
}

/** Balão e som quando uma conversa pedir aprovação, perguntar, terminar, falhar ou travar a meta. */
export function Notificacoes() {
  const controller = useController();
  const prefs = useApp((s) => s.prefs);
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
  return (
    <>
      <Subhead>Avisos</Subhead>
      <Card>
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
          description="O som do sistema a cada aviso — junto com o balão, ou sozinho quando o balão está desligado."
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
      </Card>
      <Subhead>Prova</Subhead>
      <Card>
        <Row
          label="Provar cada canal"
          description="Toca o som e mostra um balão de prova na hora, mesmo com esta janela aberta. O balão de prova precisa da autorização do sistema."
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
      </Card>
    </>
  );
}

/** As teclas do app, para consulta. Somente leitura: nada aqui muda um atalho. */
export function Atalhos() {
  const scopes = ["Geral", "Composer"] as const;
  return (
    <>
      {scopes.map((scope) => (
        <div key={scope}>
          <Subhead>{scope === "Geral" ? "Em qualquer lugar" : "No composer"}</Subhead>
          <Card>
            {SHORTCUTS.filter((shortcut) => shortcut.scope === scope).map((shortcut) => (
              <div
                key={shortcut.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 first:border-t-0"
              >
                <p className="text-sm text-fg">{shortcut.label}</p>
                <kbd
                  className={cn(
                    "rounded-md bg-sunken px-2 py-1 font-mono text-xs whitespace-nowrap text-fg",
                    isMac && "tracking-wide",
                  )}
                >
                  {formatShortcutKeys(shortcut.keys, isMac)}
                </kbd>
              </div>
            ))}
          </Card>
        </div>
      ))}
    </>
  );
}
