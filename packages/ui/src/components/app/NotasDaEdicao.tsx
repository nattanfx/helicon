import { NOTAS } from "../../model/notas.js";
import { Markdown } from "../ui/Markdown.js";
import { Modal } from "../ui/overlays.js";
import { Button } from "../ui/primitives.js";

/**
 * As notas desta edição do fork, abertas pelo botão nas Configurações. O texto vem embutido no
 * aplicativo, então abrir não custa nenhuma consulta e diz o mesmo com ou sem rede; nada é
 * enviado a lugar algum e nenhuma preferência ou conversa muda por ler.
 */
export function NotasDaEdicao(props: { open: boolean; onClose: () => void }) {
  if (NOTAS.length === 0) {
    return null;
  }
  return (
    <Modal
      open={props.open}
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
      title="Novidades desta edição"
      className="top-[12vh] w-[min(560px,calc(100dvw-32px))]"
    >
      <div className="mt-4 flex max-h-[min(60dvh,520px)] flex-col gap-6 overflow-y-auto">
        {NOTAS.map((entry) => (
          <section key={entry.version} className="flex flex-col gap-2">
            {NOTAS.length > 1 ? <h3 className="text-[13px] font-semibold text-fg tabular-nums">{entry.version}</h3> : null}
            <Markdown text={entry.body} className="text-[14px] leading-relaxed text-muted" />
          </section>
        ))}
      </div>
      <div className="mt-5 flex justify-end">
        <Button onClick={props.onClose}>Entendi</Button>
      </div>
    </Modal>
  );
}
