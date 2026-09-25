import { useApp, useController } from "../../app/context.js";
import { CONTRIBUTOR_NOTICE, contributorChoiceLabel, modelDisplayName } from "../../model/format.js";
import { type GroupBy } from "../../model/store.js";
import type { ApprovalMode, ReasoningEffort } from "../../types.js";
import { LEVELS, MODES } from "../composer/Composer.js";
import { Card, Pick, Row, Toggle } from "./rows.js";

const GROUPS: readonly { value: GroupBy; label: string }[] = [
  { value: "project", label: "Projeto" },
  { value: "status", label: "Status" },
];

/** Com o que uma nova conversa começa. Mudar aqui não afeta conversas em andamento. */
export function NovasConversas() {
  const controller = useController();
  const prefs = useApp((s) => s.prefs);
  const models = useApp((s) => s.models);
  const yoloSettings = useApp((s) => s.yoloSettings);
  return (
    <Card>
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
    </Card>
  );
}

/** Como a barra lateral organiza as conversas. */
export function ListaDeConversas() {
  const controller = useController();
  const prefs = useApp((s) => s.prefs);
  return (
    <Card>
      <Row label="Agrupar por" description="Como a barra lateral organiza as conversas.">
        <Pick value={prefs.groupBy} options={GROUPS} onChange={(value) => controller.setGroupBy(value)} />
      </Row>
    </Card>
  );
}

/** Títulos automáticos: no máximo uma tentativa por conversa, sem renomear as antigas. */
export function TitulosDasConversas() {
  const controller = useController();
  const models = useApp((s) => s.models);
  const titleSettings = useApp((s) => s.titleSettings);
  return (
    <Card>
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
    </Card>
  );
}
