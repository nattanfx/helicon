import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ControllerProvider } from "../src/app/context.js";
import { RowStatus } from "../src/components/sidebar/Sidebar.js";
import { ThreadHeader } from "../src/components/thread/ThreadView.js";
import { AnsweredWork, LiveStatus, TurnFooter } from "../src/components/thread/Transcript.js";
import { TooltipProvider } from "../src/components/ui/overlays.js";
import { emptyFold, type TurnView } from "../src/model/fold.js";
import type { ThreadState } from "../src/model/store.js";
import type { MspItem, SessionSummary } from "../src/types.js";

const session: SessionSummary = {
  sessionId: "s1",
  cwd: "C:/projetos/Helicon-Teste",
  title: "Conversa de teste",
  titleSource: "user",
  turnCount: 1,
  modelId: null,
  origin: "helicon",
  archived: false,
  createdAt: "2026-10-06T10:00:00Z",
  activityAt: "2026-10-06T10:00:00Z",
  settled: false,
  settledAt: null,
  unsettledAt: null,
  sandboxDisabled: false,
  live: null,
};

function wrap(node: ReactNode, state: unknown = {}): string {
  const store = { get: () => state, subscribe: () => () => {} };
  return renderToStaticMarkup(
    <ControllerProvider controller={{ store } as never}>
      <TooltipProvider>{node}</TooltipProvider>
    </ControllerProvider>,
  );
}

const final: MspItem = { itemId: "a1", kind: "agentMessage", status: "completed", revision: 1, turnId: "t1", text: "Pronto." };
const tool: MspItem = { itemId: "x1", kind: "toolCall", status: "completed", revision: 1, turnId: "t1", tool: "bash", args: '{"command":"ls"}' };

function finished(terminal = "completed"): TurnView {
  const completedAt = Date.parse("2026-10-06T23:57:00");
  return {
    key: "turn:t1",
    turnId: "t1",
    prompt: null,
    entries: [tool],
    final,
    info: { turnId: "t1", terminal, startedAt: completedAt - 11_400, completedAt, durationMs: 12_000 },
    running: false,
  };
}

describe("limpeza visual: uma duração por mensagem terminada", () => {
  it("o rodapé é o botão das etapas, com uma só duração e sem a linha Trabalhou por", () => {
    const html = wrap(<AnsweredWork turn={finished()} gates={{}} answers={{}} sessionId="s1" speed={{ tokensPerSecond: 62, outputTokens: 700, generationMs: 11_000 }} cost={null} />);
    assert.doesNotMatch(html, /Trabalhou por/);
    assert.match(html, /<button[^>]*aria-expanded="false"[^>]*aria-controls="[^"]+"/);
    assert.match(html, /Concluída 23:57/);
    assert.equal(html.match(/>12s</g)?.length, 1, "a duração de trabalho aparece uma vez");
    assert.doesNotMatch(html, />11s</, "nenhuma segunda duração divergente");
    assert.match(html, /62 tok\/s/);
    assert.match(html, /etapas: 1 comando/, "o resumo das etapas fica no nome acessível");
    // Fechado por padrão: as etapas não são montadas, só o que dobra fica no lugar.
    assert.doesNotMatch(html, /Pronto\.[\s\S]*Pronto\./);
  });

  it("uma mensagem que falhou abre com as etapas à mostra, como antes", () => {
    const html = wrap(<AnsweredWork turn={finished("failed")} gates={{}} answers={{}} sessionId="s1" speed={null} cost={null} />, {
      sessions: {},
      threads: {},
      prefs: {},
      busy: {},
    });
    assert.match(html, /aria-expanded="true"/);
    assert.match(html, /Falhou 23:57/);
  });

  it("sem etapas o rodapé continua uma linha simples, sem botão", () => {
    const turn = { ...finished(), entries: [] };
    const html = wrap(<TurnFooter turn={turn} speed={null} cost={null} />);
    assert.doesNotMatch(html, /aria-expanded/);
    assert.match(html, /Concluída 23:57/);
    assert.match(html, />12s</);
  });
});

describe("limpeza visual: estimativa ao vivo no indicador da transcrição", () => {
  it("mostra Trabalhando, o tempo e a velocidade estimada enquanto o texto flui", () => {
    const now = Date.now();
    const turn: TurnView = {
      key: "turn:t1",
      turnId: "t1",
      prompt: null,
      entries: [],
      final: null,
      info: { turnId: "t1", startedAt: now - 8_000, stream: { chars: 4_000, startAt: now - 3_000, lastAt: now } },
      running: true,
    };
    const html = wrap(<LiveStatus turn={turn} gates={{}} />);
    assert.match(html, /Trabalhando/);
    assert.match(html, />8s</);
    assert.match(html, /~\d+ tok\/s/);
    assert.match(html, /aria-label="Estimado a partir do texto fluindo agora: \d+ tok\/s"/);
  });

  it("sem estimativa não há velocidade", () => {
    const turn: TurnView = {
      key: "turn:t1",
      turnId: "t1",
      prompt: null,
      entries: [],
      final: null,
      info: { turnId: "t1", startedAt: Date.now() - 8_000 },
      running: true,
    };
    assert.doesNotMatch(wrap(<LiveStatus turn={turn} gates={{}} />), /tok\/s/);
  });
});

describe("limpeza visual: barra lateral e cabeçalho", () => {
  it("conversa rodando não escreve nada à direita da linha", () => {
    const now = Date.parse("2026-10-06T12:00:00Z");
    assert.equal(wrap(<RowStatus entry={{ session, status: "running" }} now={now} />), "");
    assert.match(wrap(<RowStatus entry={{ session, status: "approval" }} now={now} />), /Aprovação/);
    assert.match(wrap(<RowStatus entry={{ session, status: "unread" }} now={now} />), /Concluída/);
    assert.notEqual(wrap(<RowStatus entry={{ session, status: "idle" }} now={now} />), "");
  });

  it("o cabeçalho de uma conversa rodando não repete projeto, cronômetro nem botão de parar", () => {
    const fold = { ...emptyFold(), activeTurnId: "t1", turns: { t1: { turnId: "t1", startedAt: Date.now() - 4_000 } } };
    const thread: ThreadState = {
      load: "ready",
      error: null,
      readOnly: false,
      readOnlyReason: null,
      truncated: false,
      fold,
      attachments: [],
      shellRuns: [],
      stalled: false,
    };
    const live = { ...session, live: { status: "running" } } as unknown as SessionSummary;
    const state = { prefs: { filesOpen: false, sidebarCollapsed: false, hiddenCards: [] }, threads: { s1: thread }, sessions: { s1: live } };
    const html = wrap(<ThreadHeader session={live} thread={thread} running />, state);
    assert.match(html, /Conversa de teste/);
    assert.match(html, /Em execução/, "o estado da sessão continua no cabeçalho");
    assert.doesNotMatch(html, /Helicon-Teste/);
    assert.doesNotMatch(html, /Trabalhando|Finalizando/);
    assert.doesNotMatch(html, /Parar a mensagem/);
    assert.doesNotMatch(html, />4s</);
  });
});
