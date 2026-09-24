import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { playNotifySound } from "../src/model/notifySound.js";

/** Um parâmetro de áudio de mentira que anota cada chamada, sem tocar som de verdade. */
class FakeAudioParam {
  calls: string[] = [];
  value = 0;
  setValueAtTime(value: number, at: number): void {
    this.calls.push(`set:${value}@${at}`);
  }
  exponentialRampToValueAtTime(value: number, at: number): void {
    this.calls.push(`ramp:${value}@${at}`);
  }
}

/** Um oscilador de mentira que anota ligações, início e fim. */
class FakeOscillator {
  type = "";
  frequency = new FakeAudioParam();
  onended: (() => void) | null = null;
  connectedTo: unknown[] = [];
  started: number[] = [];
  stopped: number[] = [];
  connect(target: unknown): void {
    this.connectedTo.push(target);
  }
  start(at: number): void {
    this.started.push(at);
  }
  stop(at: number): void {
    this.stopped.push(at);
  }
}

/** Um ganho de mentira que anota para onde liga. */
class FakeGain {
  gain = new FakeAudioParam();
  connectedTo: unknown[] = [];
  connect(target: unknown): void {
    this.connectedTo.push(target);
  }
}

/** Um AudioContext de mentira: relógio fixo, saída falsa e contagem de fechamentos. */
class FakeAudioContext {
  currentTime = 10;
  destination = {};
  closed = 0;
  oscillators: FakeOscillator[] = [];
  gains: FakeGain[] = [];
  createOscillator(): FakeOscillator {
    const osc = new FakeOscillator();
    this.oscillators.push(osc);
    return osc;
  }
  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  async close(): Promise<void> {
    this.closed += 1;
  }
}

describe("bipe de notificação", () => {
  it("toca um bipe suave de 880 Hz e devolve true", () => {
    const ctx = new FakeAudioContext();

    assert.equal(playNotifySound(ctx), true);

    assert.equal(ctx.oscillators.length, 1);
    assert.equal(ctx.gains.length, 1);
    const osc = ctx.oscillators[0] as FakeOscillator;
    const gain = ctx.gains[0] as FakeGain;
    assert.equal(osc.type, "sine");
    assert.equal(osc.frequency.value, 880);
    assert.deepEqual(gain.gain.calls, ["set:0.0001@10", "ramp:0.25@10.012", "ramp:0.0001@10.12"]);
    assert.deepEqual(osc.connectedTo, [gain]);
    assert.deepEqual(gain.connectedTo, [ctx.destination]);
    assert.deepEqual(osc.started, [10]);
    assert.deepEqual(osc.stopped, [10 + 0.12 + 0.02]);
  });

  it("fecha o contexto quando o bipe termina", async () => {
    const ctx = new FakeAudioContext();
    playNotifySound(ctx);

    const osc = ctx.oscillators[0] as FakeOscillator;
    assert.equal(typeof osc.onended, "function");
    osc.onended?.();
    assert.equal(ctx.closed, 1);
  });

  it("devolve false sem áudio disponível, sem lançar", () => {
    assert.equal(playNotifySound(null), false);
  });

  it("nunca lança quando o contexto quebra no meio", () => {
    const ctx = new FakeAudioContext();
    ctx.createOscillator = () => {
      throw new Error("sem oscilador");
    };
    assert.equal(playNotifySound(ctx), false);

    const ctx2 = new FakeAudioContext();
    ctx2.close = () => {
      throw new Error("sem fechar");
    };
    assert.equal(playNotifySound(ctx2), true);
  });

  it("informa o estado do contexto à sonda de diagnóstico", () => {
    const ctx = new FakeAudioContext() as FakeAudioContext & { state: string };
    ctx.state = "suspended";
    let seen: string | null = null;

    assert.equal(
      playNotifySound(ctx, (info) => {
        seen = info.state;
      }),
      true,
    );
    assert.equal(seen, "suspended");
  });

  it("sonda recebe desconhecido quando o contexto não informa estado", () => {
    const ctx = new FakeAudioContext();
    let seen: string | null = null;

    assert.equal(
      playNotifySound(ctx, (info) => {
        seen = info.state;
      }),
      true,
    );
    assert.equal(seen, "desconhecido");
  });

  it("sonda que lança não quebra o bipe", () => {
    const ctx = new FakeAudioContext();

    assert.equal(
      playNotifySound(ctx, () => {
        throw new Error("sonda quebrada");
      }),
      true,
    );
  });
});
