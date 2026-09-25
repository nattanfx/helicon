import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  abandonTurn,
  addEcho,
  applyEvent,
  applyEvents,
  buildTurns,
  emptyFold,
  foldFromLoad,
  gateFor,
  isTurnFinalizing,
  updateEcho,
} from "../src/model/fold.js";
import type { ViewEvent } from "../src/types.js";
import { historyEvents, liveEvents } from "./fixtures/probe.js";

function foldAll(events: ViewEvent[]) {
  return applyEvents(emptyFold(), events);
}

describe("thread fold against a real muse transcript", () => {
  it("drops a prompt's local copy once its turn ends, landed or not", () => {
    const sending = addEcho(emptyFold(), { localId: "e1", text: "hello", turnId: null, disposition: "sending", createdAt: 1 });
    const started = updateEcho(sending, "e1", { turnId: "t1", disposition: "started" });
    assert.equal(started.echoes.length, 1);

    // The turn died before Muse committed the prompt, so nothing in the transcript matches the echo.
    const failed = applyEvent(started, {
      method: "turn/completed",
      params: { sessionId: "s1", turnId: "t1", terminal: "failed", error: { kind: "rateLimit", message: "quota", retryable: true } },
      at: 2,
    });
    assert.equal(failed.echoes.length, 0, "a failed turn takes its pending bubble with it");

    const quiet = applyEvent(updateEcho(sending, "e1", { turnId: "t2", disposition: "started" }), {
      method: "turn/completed",
      params: { sessionId: "s1", turnId: "t2", terminal: "completed" },
      at: 3,
    });
    assert.equal(quiet.echoes.length, 0, "a turn that committed no prompt item leaves no ghost either");
  });


  it("folds the live stream into three finished turns", () => {
    const fold = liveEvents.reduce(applyEvent, emptyFold());
    const turns = buildTurns(fold);
    assert.equal(turns.length, 3);
    assert.equal(fold.activeTurnId, null);

    const [pong, shell, question] = turns;
    assert.equal(pong?.prompt?.text, "Reply with exactly one word: pong");
    assert.equal(pong?.final?.text, "pong");
    assert.equal(pong?.entries.length, 0, "reminder children stay hidden");
    assert.equal(pong?.info?.durationMs, 42316);

    assert.equal(shell?.entries.length, 1);
    assert.equal(shell?.entries[0]?.kind, "toolCall");
    assert.equal(shell?.entries[0]?.tool, "bash");
    assert.match(shell?.entries[0]?.visibleOutput ?? "", /README\.md/);
    assert.match(shell?.final?.text ?? "", /printed 4 entries/);

    assert.equal(question?.entries[0]?.tool, "request_user_input");
    assert.equal(question?.final?.text, "Blue");
    assert.deepEqual(Object.keys(fold.userInputs), []);
    const settled = Object.values(fold.settled)[0];
    assert.equal(settled?.outcome, "answered");
    assert.equal(settled?.answers[0]?.selectedLabel, "Blue");

    assert.equal(fold.meta.contextUsage?.windowTokens, 1007997);
    assert.equal(fold.meta.tokenTotals?.totalTokens, 108605);
    assert.equal(fold.meta.approvalMode, "onRequest");
    assert.equal(fold.meta.modelId, "muse-spark-1.3-contributor");
  });

  it("shows a turn as running with its streaming reply inline", () => {
    const firstDelta = liveEvents.findIndex((e) => e.method === "item/delta");
    const fold = foldAll(liveEvents.slice(0, firstDelta + 1));
    assert.notEqual(fold.activeTurnId, null);
    const [turn] = buildTurns(fold);
    assert.equal(turn?.running, true);
    assert.equal(turn?.final, null);
    const reply = turn?.entries.find((e) => e.kind === "agentMessage");
    assert.equal(reply?.text, "pong");
    assert.equal(reply?.status, "inProgress");
  });

  it("parks a pending question until it settles", () => {
    const requested = liveEvents.findIndex((e) => e.method === "userInput/requested");
    const fold = foldAll(liveEvents.slice(0, requested + 1));
    const [pending] = Object.values(fold.userInputs);
    assert.equal(pending?.questions[0]?.question, "Which color do you prefer?");
    const toolItem = Object.values(fold.items).find((i) => i.tool === "request_user_input");
    assert.equal(gateFor(fold, toolItem?.itemId ?? "")?.kind, "input");
  });

  it("renders paged history the same as the live stream", () => {
    const live = buildTurns(foldAll(liveEvents));
    const history = buildTurns(foldAll(historyEvents));
    assert.deepEqual(
      history.map((t) => [t.prompt?.text, t.final?.text, t.entries.map((e) => e.kind)]),
      live.map((t) => [t.prompt?.text, t.final?.text, t.entries.map((e) => e.kind)]),
    );
  });

  it("never duplicates items when history and live events overlap", () => {
    const fold = applyEvents(foldAll(historyEvents), liveEvents);
    const ids = fold.order;
    assert.equal(new Set(ids).size, ids.length);
    const live = foldAll(liveEvents);
    assert.equal(fold.order.length, live.order.length);
    const reply = Object.values(fold.items).find((i) => i.kind === "agentMessage" && i.text === "pong");
    assert.equal(reply?.revision, 2, "the higher live revision wins over the paged one");
  });

  it("keeps streamed text when the final arrives empty and ignores late deltas", () => {
    let fold = applyEvent(emptyFold(), {
      method: "item/started",
      params: { sessionId: "s", item: { itemId: "m1", kind: "agentMessage", status: "inProgress", revision: 1, turnId: "t1" } },
    });
    fold = applyEvent(fold, { method: "item/delta", params: { sessionId: "s", itemId: "m1", delta: "Hello world" } });
    fold = applyEvent(fold, {
      method: "item/completed",
      params: { sessionId: "s", item: { itemId: "m1", kind: "agentMessage", status: "completed", revision: 2, turnId: "t1", text: "" } },
    });
    assert.equal(fold.items["m1"]?.text, "Hello world");
    fold = applyEvent(fold, { method: "item/delta", params: { sessionId: "s", itemId: "m1", delta: " again" } });
    assert.equal(fold.items["m1"]?.text, "Hello world");
  });

  it("streams reasoning summaries and tool output by field path", () => {
    let fold = applyEvent(emptyFold(), {
      method: "item/started",
      params: { sessionId: "s", item: { itemId: "r1", kind: "reasoning", status: "inProgress", revision: 1, turnId: "t1" } },
    });
    fold = applyEvents(fold, [
      { method: "item/delta", params: { itemId: "r1", field: "summary.0", delta: "Checking " } },
      { method: "item/delta", params: { itemId: "r1", field: "summary.0", delta: "tests" } },
      { method: "item/delta", params: { itemId: "r1", field: "summary.1", delta: "Then build" } },
      { method: "item/delta", params: { itemId: "x9", field: "output", delta: "npm ok" } },
    ]);
    assert.deepEqual(fold.items["r1"]?.summary, ["Checking tests", "Then build"]);
    assert.equal(fold.items["x9"]?.kind, "toolCall");
    assert.equal(fold.items["x9"]?.visibleOutput, "npm ok");
  });

  it("tracks approvals from request to resolution", () => {
    const request = {
      sessionId: "s",
      approvalId: "a1",
      itemId: "tool1",
      currentRequirementId: { approvalId: "a1", sourceIndex: 0 },
      availableChoices: [{ choiceId: "yes", label: "Allow once", decision: "approved", scope: "once" }],
      subject: { kind: "shell", command: "rm -rf dist" },
    };
    let fold = applyEvent(emptyFold(), { method: "approval/requested", params: request });
    assert.equal(gateFor(fold, "tool1")?.kind, "approval");
    fold = applyEvent(fold, { method: "approval/resolved", params: { sessionId: "s", approvalId: "a1", decision: "approved", resolvedBy: "user" } });
    assert.deepEqual(fold.approvals, {});
    assert.equal(fold.resolved["a1"]?.decision, "approved");
    fold = applyEvent(fold, { method: "approval/requested", params: request });
    assert.deepEqual(fold.approvals, {}, "a redelivered request for a resolved approval stays resolved");
  });

  it("records failures, retries and cancellations per turn", () => {
    const fold = applyEvents(emptyFold(), [
      { method: "turn/started", params: { turnId: "t1" }, at: 1000 },
      { method: "turn/retryScheduled", params: { turnId: "t1", attempt: 1, maxAttempts: 3, nextAttempt: 2, reason: "rate limited", retryDelayMs: 2000 } },
      { method: "turn/completed", params: { turnId: "t1", terminal: "failed", error: { kind: "modelError", message: "Provider down", retryable: true } }, at: 5000 },
    ]);
    assert.equal(fold.activeTurnId, null);
    assert.equal(fold.turns["t1"]?.terminal, "failed");
    assert.equal(fold.turns["t1"]?.error?.message, "Provider down");
    assert.equal(fold.turns["t1"]?.retry, undefined);
    assert.equal(fold.turns["t1"]?.startedAt, 1000);
  });

  it("mostra um fallback em português quando o erro do turno vem sem mensagem", () => {
    const fold = applyEvents(emptyFold(), [
      { method: "turn/started", params: { turnId: "t1" }, at: 1000 },
      { method: "turn/completed", params: { turnId: "t1", terminal: "failed", error: { kind: "error" } }, at: 5000 },
    ]);
    assert.equal(fold.turns["t1"]?.error?.message, "A mensagem falhou.");
  });

  it("ignora falha vazia sobre resposta completa (artefato do F5)", () => {
    const fold = applyEvents(emptyFold(), [
      { method: "turn/started", params: { turnId: "t1" }, at: 1 },
      {
        method: "item/completed",
        params: { item: { itemId: "a1", kind: "agentMessage", status: "completed", revision: 1, turnId: "t1", text: "resposta inteira" } },
        at: 2,
      },
      // O retrato do recarregamento cortou o stream: falha sem detalhe algum.
      { method: "turn/completed", params: { turnId: "t1", terminal: "failed" }, at: 3 },
    ]);
    assert.equal(fold.turns["t1"]?.terminal, undefined, "falha vazia sobre conteúdo completo não marca o turno");
    assert.equal(fold.turns["t1"]?.error, undefined);
  });

  it("falha vazia sem conteúdo continua marcando o turno", () => {
    const fold = applyEvents(emptyFold(), [
      { method: "turn/started", params: { turnId: "t1" }, at: 1 },
      { method: "turn/completed", params: { turnId: "t1", terminal: "failed" }, at: 2 },
    ]);
    assert.equal(fold.turns["t1"]?.terminal, "failed");
  });

  it("só a pergunta não conta como conteúdo completo", () => {
    const fold = applyEvents(emptyFold(), [
      { method: "turn/started", params: { turnId: "t1" }, at: 1 },
      {
        method: "item/completed",
        params: { item: { itemId: "u1", kind: "userMessage", status: "completed", revision: 1, turnId: "t1", text: "oi?" } },
        at: 2,
      },
      { method: "turn/completed", params: { turnId: "t1", terminal: "failed" }, at: 3 },
    ]);
    assert.equal(fold.turns["t1"]?.terminal, "failed");
  });

  it("falha com detalhe continua mesmo com resposta completa", () => {
    const fold = applyEvents(emptyFold(), [
      { method: "turn/started", params: { turnId: "t1" }, at: 1 },
      {
        method: "item/completed",
        params: { item: { itemId: "a1", kind: "agentMessage", status: "completed", revision: 1, turnId: "t1", text: "resposta inteira" } },
        at: 2,
      },
      {
        method: "turn/completed",
        params: { turnId: "t1", terminal: "failed", error: { kind: "modelError", message: "Provider down", retryable: true } },
        at: 3,
      },
    ]);
    assert.equal(fold.turns["t1"]?.terminal, "failed");
    assert.equal(fold.turns["t1"]?.error?.message, "Provider down");
  });

  it("resposta completa que chega depois limpa a falha vazia", () => {
    let fold = applyEvents(emptyFold(), [
      { method: "turn/started", params: { turnId: "t1" }, at: 1 },
      { method: "turn/completed", params: { turnId: "t1", terminal: "failed" }, at: 2 },
    ]);
    assert.equal(fold.turns["t1"]?.terminal, "failed");
    fold = applyEvent(fold, {
      method: "item/completed",
      params: { item: { itemId: "a1", kind: "agentMessage", status: "completed", revision: 1, turnId: "t1", text: "resposta inteira" } },
      at: 3,
    });
    assert.equal(fold.turns["t1"]?.terminal, undefined);
    assert.equal(fold.turns["t1"]?.error, undefined);
  });

  it("atividade nova limpa a falha vazia (turno vivo, vídeo 20:17)", () => {
    let fold = applyEvents(emptyFold(), [
      { method: "turn/started", params: { turnId: "t1" }, at: 1 },
      { method: "turn/completed", params: { turnId: "t1", terminal: "failed" }, at: 2 },
    ]);
    assert.equal(fold.turns["t1"]?.terminal, "failed");
    // O host segue emitindo para o turno: ele está vivo, o fim com falha era retrato cortado.
    fold = applyEvent(fold, {
      method: "item/updated",
      params: { item: { itemId: "a1", kind: "agentMessage", status: "inProgress", revision: 1, turnId: "t1", text: "pela metade" } },
      at: 3,
    });
    assert.equal(fold.turns["t1"]?.terminal, undefined);
  });

  it("retrato parado com parcial mantém a falha vazia", () => {
    // Ordem do retrato: conteúdo parcial primeiro, falha depois, e mais nada chega.
    const fold = applyEvents(emptyFold(), [
      { method: "turn/started", params: { turnId: "t1" }, at: 1 },
      {
        method: "item/updated",
        params: { item: { itemId: "a1", kind: "agentMessage", status: "inProgress", revision: 1, turnId: "t1", text: "pela metade" } },
        at: 2,
      },
      { method: "turn/completed", params: { turnId: "t1", terminal: "failed" }, at: 3 },
    ]);
    assert.equal(fold.turns["t1"]?.terminal, "failed");
  });

  it("delta novo limpa a falha vazia", () => {
    let fold = applyEvents(emptyFold(), [
      { method: "turn/started", params: { turnId: "t1" }, at: 1 },
      { method: "turn/completed", params: { turnId: "t1", terminal: "failed" }, at: 2 },
    ]);
    fold = applyEvent(fold, {
      method: "item/delta",
      params: { itemId: "a1", turnId: "t1", field: "text", delta: "oi" },
      at: 3,
    });
    assert.equal(fold.turns["t1"]?.terminal, undefined);
    assert.equal(fold.items["a1"]?.text, "oi");
  });

  it("delta ignorado (item pronto) não limpa a falha vazia", () => {
    let fold = applyEvents(emptyFold(), [
      { method: "turn/started", params: { turnId: "t1" }, at: 1 },
      {
        method: "item/completed",
        params: { item: { itemId: "u1", kind: "userMessage", status: "completed", revision: 1, turnId: "t1", text: "oi?" } },
        at: 2,
      },
      { method: "turn/completed", params: { turnId: "t1", terminal: "failed" }, at: 3 },
    ]);
    assert.equal(fold.turns["t1"]?.terminal, "failed");
    fold = applyEvent(fold, {
      method: "item/delta",
      params: { itemId: "u1", turnId: "t1", field: "text", delta: "tardio" },
      at: 4,
    });
    assert.equal(fold.turns["t1"]?.terminal, "failed");
    assert.equal(fold.items["u1"]?.text, "oi?");
  });

  it("só a pergunta chegando depois não limpa a falha vazia", () => {
    let fold = applyEvents(emptyFold(), [
      { method: "turn/started", params: { turnId: "t1" }, at: 1 },
      { method: "turn/completed", params: { turnId: "t1", terminal: "failed" }, at: 2 },
    ]);
    fold = applyEvent(fold, {
      method: "item/completed",
      params: { item: { itemId: "u1", kind: "userMessage", status: "completed", revision: 1, turnId: "t1", text: "oi?" } },
      at: 3,
    });
    assert.equal(fold.turns["t1"]?.terminal, "failed");
  });

  it("conclusão ao vivo limpa a falha vazia (merge de revisão)", () => {
    let fold = applyEvents(emptyFold(), [
      { method: "turn/started", params: { turnId: "t1" }, at: 1 },
      {
        method: "item/started",
        params: { item: { itemId: "a1", kind: "agentMessage", status: "inProgress", revision: 0, turnId: "t1", text: "" } },
        at: 2,
      },
      { method: "turn/completed", params: { turnId: "t1", terminal: "failed" }, at: 3 },
    ]);
    assert.equal(fold.turns["t1"]?.terminal, "failed");
    fold = applyEvent(fold, {
      method: "item/completed",
      params: { item: { itemId: "a1", kind: "agentMessage", status: "completed", revision: 1, turnId: "t1", text: "resposta inteira" } },
      at: 4,
    });
    assert.equal(fold.turns["t1"]?.terminal, undefined);
  });

  it("drops the local echo once the prompt comes back from the stream", () => {
    let fold = addEcho(emptyFold(), { localId: "l1", text: "hello  there", turnId: null, disposition: "sending", createdAt: 1 });
    fold = updateEcho(fold, "l1", { turnId: "t1", disposition: "started" });
    assert.equal(fold.echoes[0]?.turnId, "t1");
    fold = applyEvent(fold, {
      method: "item/completed",
      params: { item: { itemId: "u1", kind: "userMessage", status: "completed", revision: 1, turnId: "t1", text: "hello there" } },
    });
    assert.equal(fold.echoes.length, 0);

    let raced = applyEvent(emptyFold(), {
      method: "item/completed",
      params: { item: { itemId: "u2", kind: "userMessage", status: "completed", revision: 1, turnId: "t2", text: "fast" } },
    });
    raced = addEcho(raced, { localId: "l2", text: "fast", turnId: null, disposition: "sending", createdAt: 1 });
    raced = updateEcho(raced, "l2", { turnId: "t2", disposition: "started" });
    assert.equal(raced.echoes.length, 0, "an echo whose prompt already landed is dropped on ack");
  });

  it("drops an image-only echo once its empty prompt lands", () => {
    const preview = { name: "print.png", mediaType: "image/png", kind: "image" as const, url: "blob:local/1" };
    let fold = addEcho(emptyFold(), { localId: "l1", text: "", turnId: null, disposition: "sending", createdAt: 1, attachments: [preview] });
    fold = updateEcho(fold, "l1", { turnId: "t1", disposition: "started" });
    assert.equal(fold.echoes.length, 1);
    fold = applyEvent(fold, {
      method: "item/completed",
      params: { item: { itemId: "u1", kind: "userMessage", status: "completed", revision: 1, turnId: "t1", text: "" } },
    });
    assert.equal(fold.echoes.length, 0, "no duplicate while the turn runs");

    let raced = applyEvent(emptyFold(), {
      method: "item/completed",
      params: { item: { itemId: "u2", kind: "userMessage", status: "completed", revision: 1, turnId: "t2" } },
    });
    raced = addEcho(raced, { localId: "l2", text: "", turnId: null, disposition: "sending", createdAt: 1, attachments: [preview] });
    raced = updateEcho(raced, "l2", { turnId: "t2", disposition: "started" });
    assert.equal(raced.echoes.length, 0, "an echo whose empty prompt already landed is dropped on ack");
  });

  it("matches a file echo whose prompt carries attachment mentions", () => {
    const preview = { name: "notes.txt", mediaType: "text/plain", kind: "file" as const, url: null };
    let fold = addEcho(emptyFold(), { localId: "l1", text: "look", turnId: null, disposition: "sending", createdAt: 1, attachments: [preview] });
    fold = updateEcho(fold, "l1", { turnId: "t1", disposition: "started" });
    fold = applyEvent(fold, {
      method: "item/completed",
      params: { item: { itemId: "u1", kind: "userMessage", status: "completed", revision: 1, turnId: "t1", text: "look\n\n@.helicon/attachments/notes.txt" } },
    });
    assert.equal(fold.echoes.length, 0);

    let stray = addEcho(emptyFold(), { localId: "l2", text: "", turnId: "t2", disposition: "started", createdAt: 1, attachments: [preview] });
    stray = applyEvent(stray, {
      method: "item/completed",
      params: { item: { itemId: "u2", kind: "userMessage", status: "completed", revision: 1, turnId: "t9", text: "" } },
    });
    assert.equal(stray.echoes.length, 1, "another turn's empty prompt is not this echo");
  });

  it("clears a slash turn's echo once a revision carries the shown text, or once its turn finishes", () => {
    let fold = addEcho(emptyFold(), { localId: "l1", text: "/plan tidy", turnId: null, disposition: "sending", createdAt: 1 });
    // The live start carries only the instructions the model got.
    fold = applyEvent(fold, {
      method: "item/started",
      params: { item: { itemId: "u1", kind: "userMessage", status: "inProgress", revision: 1, turnId: "t1", text: "Use skill bundled:plan first" } },
    });
    fold = updateEcho(fold, "l1", { turnId: "t1", disposition: "started" });
    assert.equal(fold.echoes.length, 1, "nothing matched the shown text yet");
    fold = applyEvent(fold, {
      method: "item/completed",
      params: {
        item: { itemId: "u1", kind: "userMessage", status: "completed", revision: 2, turnId: "t1", text: "Use skill bundled:plan first", displayText: "/plan tidy" },
      },
    });
    assert.equal(fold.echoes.length, 0, "the revision with the shown text clears it");

    let stray = addEcho(emptyFold(), { localId: "l2", text: "typed", turnId: "t2", disposition: "started", createdAt: 1 });
    stray = applyEvent(stray, {
      method: "item/completed",
      params: { item: { itemId: "u2", kind: "userMessage", status: "completed", revision: 1, turnId: "t2", text: "sent" } },
    });
    assert.equal(stray.echoes.length, 1);
    stray = applyEvent(stray, { method: "turn/completed", params: { turnId: "t2", terminal: "completed" } });
    assert.equal(stray.echoes.length, 0, "a finished turn whose prompt landed needs no local copy");
  });

  it("keeps queued prompts until their turn launches or is reclaimed", () => {
    let fold = addEcho(emptyFold(), { localId: "q1", text: "next", turnId: "t5", disposition: "queued", createdAt: 1 });
    fold = applyEvent(fold, { method: "turn/started", params: { turnId: "t5" } });
    assert.equal(fold.echoes[0]?.disposition, "started");
    fold = addEcho(fold, { localId: "q2", text: "later", turnId: "t6", disposition: "queued", createdAt: 2 });
    fold = applyEvent(fold, { method: "turn/unqueued", params: { turnId: "t6", commandId: "t6" } });
    assert.deepEqual(fold.echoes.map((e) => e.localId), ["q1"]);
  });

  it("clears every echo of a turn when it ends, not just the first", () => {
    let fold = addEcho(emptyFold(), { localId: "s1", text: "first steer", turnId: "t1", disposition: "steered", createdAt: 1 });
    fold = addEcho(fold, { localId: "s2", text: "second steer", turnId: "t1", disposition: "steered", createdAt: 2 });
    fold = applyEvent(fold, { method: "turn/completed", params: { turnId: "t1", terminal: "completed" }, at: 3 });
    assert.deepEqual(fold.echoes.map((e) => e.localId), [], "no steered bubble may outlive its turn");
  });

  it("clears every echo of a turn when it leaves the queue", () => {
    let fold = addEcho(emptyFold(), { localId: "q1", text: "next", turnId: "t5", disposition: "queued", createdAt: 1 });
    fold = addEcho(fold, { localId: "q2", text: "next again", turnId: "t5", disposition: "queued", createdAt: 2 });
    fold = applyEvent(fold, { method: "turn/unqueued", params: { turnId: "t5", commandId: "t5" } });
    assert.deepEqual(fold.echoes.map((e) => e.localId), []);
  });

  it("abandons a turn the host never closes, keeping other turns' queued prompts", () => {
    let fold = applyEvent(emptyFold(), { method: "turn/started", params: { turnId: "t1" }, at: 1 });
    fold = addEcho(fold, { localId: "s1", text: "steer", turnId: "t1", disposition: "steered", createdAt: 2 });
    fold = addEcho(fold, { localId: "q1", text: "next", turnId: "t2", disposition: "queued", createdAt: 3 });
    fold = abandonTurn(fold, "t1");
    assert.equal(fold.activeTurnId, null);
    assert.equal(fold.turns["t1"]?.terminal, "cancelled");
    assert.deepEqual(fold.echoes.map((e) => e.localId), ["q1"], "the queue behind the dead turn survives");
    assert.equal(buildTurns(fold).some((view) => view.running), false);
  });

  it("leaves alone a turn that is not active or already finished", () => {
    const started = applyEvent(emptyFold(), { method: "turn/started", params: { turnId: "t1" }, at: 1 });
    assert.equal(abandonTurn(started, "t2"), started);
    const finished = applyEvent(started, { method: "turn/completed", params: { turnId: "t1", terminal: "completed" }, at: 2 });
    assert.equal(abandonTurn(finished, "t1"), finished);
  });

  it("lets a late host ending overwrite an abandoned turn without reopening it", () => {
    let fold = applyEvent(emptyFold(), { method: "turn/started", params: { turnId: "t1" }, at: 1 });
    fold = abandonTurn(fold, "t1");
    fold = applyEvent(fold, { method: "turn/completed", params: { turnId: "t1", terminal: "failed", error: { kind: "error", message: "late", retryable: false } }, at: 2 });
    assert.equal(fold.turns["t1"]?.terminal, "failed");
    assert.equal(fold.activeTurnId, null);
    fold = applyEvent(fold, { method: "turn/started", params: { turnId: "t1" }, at: 3 });
    assert.equal(fold.activeTurnId, null, "a stale start for an abandoned turn reopens nothing");
  });

  it("marks a queued echo started when reload history shows its turn running (#55)", () => {
    const fold = foldFromLoad(
      {
        session: null,
        msp: { status: "running", activeTurnId: "t1", modelId: null, approvalMode: null, workspaceRoot: null, turnCount: 1 },
        events: [{ method: "turn/started", params: { turnId: "t1" }, at: 1 }],
        truncated: false,
        pending: { approvals: [], userInputs: [] },
        readOnly: false,
        readOnlyReason: null,
      },
      addEcho(
        addEcho(emptyFold(), { localId: "running", text: "go", turnId: "t1", disposition: "queued", createdAt: 1 }),
        { localId: "waiting", text: "later", turnId: "t9", disposition: "queued", createdAt: 1 },
      ),
    );
    assert.deepEqual(
      fold.echoes.map((e) => `${e.localId}:${e.disposition}`),
      ["running:started", "waiting:queued"],
    );
  });

  it("reloads without echoes whose turn finished or prompt already landed", () => {
    const events: ViewEvent[] = [
      { method: "turn/started", params: { turnId: "t1" }, at: 1 },
      { method: "turn/completed", params: { turnId: "t1", terminal: "completed" }, at: 2 },
      { method: "turn/started", params: { turnId: "t2" }, at: 3 },
      {
        method: "item/completed",
        params: { item: { itemId: "u2", kind: "userMessage", status: "completed", revision: 1, turnId: "t2", text: "queued thing" } },
        at: 4,
      },
      { method: "turn/completed", params: { turnId: "t2", terminal: "completed" }, at: 5 },
    ];
    const loaded = addEcho(
      addEcho(
        addEcho(
          addEcho(emptyFold(), { localId: "done", text: "old", turnId: "t1", disposition: "started", createdAt: 1 }),
          { localId: "ran", text: "queued thing", turnId: "t2", disposition: "queued", createdAt: 1 },
        ),
        { localId: "waiting", text: "later", turnId: "t9", disposition: "queued", createdAt: 1 },
      ),
      { localId: "flying", text: "typing", turnId: null, disposition: "sending", createdAt: 1 },
    );
    const fold = foldFromLoad({
      session: null,
      msp: { status: "idle", activeTurnId: null, modelId: null, approvalMode: null, workspaceRoot: null, turnCount: 2 },
      events,
      truncated: false,
      pending: { approvals: [], userInputs: [] },
      readOnly: false,
      readOnlyReason: null,
    }, loaded);
    assert.deepEqual(fold.echoes.map((e) => e.localId), ["waiting", "flying"]);
  });

  it("builds a fold from a resume load with the server's pending set", () => {
    const requested = liveEvents.findIndex((e) => e.method === "userInput/requested");
    const pendingInput = liveEvents[requested]?.params;
    const fold = foldFromLoad({
      session: null,
      msp: { status: "running", activeTurnId: "t-live", modelId: "m", approvalMode: "denyUnmatched", workspaceRoot: "/w", turnCount: 3 },
      events: historyEvents,
      truncated: false,
      pending: { approvals: [], userInputs: [pendingInput as never] },
      readOnly: false,
      readOnlyReason: null,
    });
    assert.equal(fold.activeTurnId, "t-live");
    assert.equal(Object.keys(fold.userInputs).length, 1);
    assert.equal(fold.meta.approvalMode, "onRequest", "events win over the resume snapshot");
  });

  it("does not let resume status reactivate a turn already terminal in history", () => {
    for (const terminal of ["completed", "failed", "cancelled"]) {
      const fold = foldFromLoad({
        session: null,
        msp: { status: "running", activeTurnId: "ended", modelId: null, approvalMode: null, workspaceRoot: null, turnCount: 1 },
        events: [
          { method: "turn/started", params: { turnId: "ended" }, at: 1 },
          { method: "turn/completed", params: { turnId: "ended", terminal }, at: 2 },
        ],
        truncated: false,
        pending: { approvals: [], userInputs: [] },
        readOnly: false,
        readOnlyReason: null,
      });
      assert.equal(fold.activeTurnId, null);
      assert.equal(fold.turns["ended"]?.terminal, terminal);
    }
  });

  it("returns the same fold for an empty batch", () => {
    const fold = emptyFold();
    assert.equal(applyEvents(fold, []), fold);
  });
});

describe("subagent children", () => {
  const child = (i: number): ViewEvent => ({
    at: 1,
    method: "item/completed",
    params: {
      sessionId: "s1",
      item: { itemId: `c${i}`, kind: "reminderChild", status: "completed", revision: 1, turnId: "t1", text: "x".repeat(500) },
    },
  });

  it("are left out of the fold, since nothing ever renders them", () => {
    const fold = foldAll([child(1), child(2), child(3)]);
    assert.deepEqual(Object.keys(fold.items), []);
    assert.deepEqual(fold.order, []);
  });

  it("cost a thread nothing as they pile up", () => {
    // A plan that runs subagents produced tens of thousands of these, and keeping them made every later event in the
    // thread slower until it stopped updating at all (#32).
    let fold = emptyFold();
    const started = Date.now();
    for (let i = 0; i < 20_000; i += 1) {
      fold = applyEvent(fold, child(i));
    }
    assert.deepEqual(fold.order, []);
    assert.ok(Date.now() - started < 2_000, `20k subagent children took ${Date.now() - started}ms`);
  });
});

describe("turno finalizando", () => {
  const started: ViewEvent = { method: "turn/started", params: { turnId: "t1" }, at: 0 };
  const doneText: ViewEvent = {
    method: "item/completed",
    params: { item: { itemId: "a1", kind: "agentMessage", status: "completed", revision: 1, turnId: "t1", text: "ok" } },
    at: 100,
  };

  it("aponta turno ativo sem item visível em andamento", () => {
    const fold = applyEvents(emptyFold(), [started, doneText]);
    assert.equal(fold.activeTurnId, "t1");
    assert.equal(isTurnFinalizing(fold, "t1"), true);
  });

  it("não aponta quando algo visível ainda roda, nem turno parado", () => {
    const running: ViewEvent = {
      method: "item/started",
      params: { item: { itemId: "x1", kind: "toolCall", status: "inProgress", revision: 1, turnId: "t1", tool: "bash" } },
      at: 50,
    };
    assert.equal(isTurnFinalizing(applyEvents(emptyFold(), [started, running]), "t1"), false);
    assert.equal(isTurnFinalizing(applyEvents(emptyFold(), [started, doneText]), null), false);
    const promptOnly: ViewEvent = {
      method: "item/completed",
      params: { item: { itemId: "u1", kind: "userMessage", status: "completed", revision: 1, turnId: "t1", text: "oi" } },
      at: 10,
    };
    assert.equal(isTurnFinalizing(applyEvents(emptyFold(), [started, promptOnly]), "t1"), false, "só o prompt, sem nada do agente, ainda é trabalho");
    const closed = applyEvents(applyEvents(emptyFold(), [started, doneText]), [
      { method: "turn/completed", params: { turnId: "t1", terminal: "completed" }, at: 200 },
    ]);
    assert.equal(isTurnFinalizing(closed, "t1"), false);
  });

  it("ignora filhos-lembrete, que a UI nunca mostra", () => {
    const reminder: ViewEvent = {
      method: "item/started",
      params: { item: { itemId: "r1", kind: "reminderChild", status: "inProgress", revision: 1, turnId: "t1" } },
      at: 50,
    };
    const fold = applyEvents(emptyFold(), [started, doneText, reminder]);
    assert.equal(fold.order.includes("r1"), false);
    assert.equal(isTurnFinalizing(fold, "t1"), true);
  });
});
