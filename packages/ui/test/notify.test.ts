import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NotificationManager, type NotifyPermission, type Notifier } from "../src/model/notify.js";

interface Shown {
  title: string;
  body: string;
  tag: string;
}

function notifier(permission: NotifyPermission = "granted") {
  const shown: Shown[] = [];
  let asked = 0;
  const fake: Notifier = {
    permission: async () => permission,
    request: async () => {
      asked += 1;
      return permission;
    },
    show: async (note) => {
      shown.push(note);
    },
  };
  return { fake, shown, asked: () => asked };
}

/** Um relógio que o teste move à mão, para atravessar a janela de repetição sem esperar por ela. */
function clock(start = 1_000) {
  let at = start;
  return { now: () => at, pass: (ms: number) => (at += ms) };
}

describe("notificações", () => {
  it("não diz nada para quem já está olhando a janela", async () => {
    const { fake, shown } = notifier();
    const manager = new NotificationManager(fake, () => ({ enabled: true, focused: true }));

    await manager.announce({ kind: "approval", sessionId: "s1", thread: "notes-app" });

    assert.deepEqual(shown, []);
  });

  it("não diz nada quando o interruptor está desligado", async () => {
    const { fake, shown } = notifier();
    const manager = new NotificationManager(fake, () => ({ enabled: false, focused: false }));

    await manager.announce({ kind: "approval", sessionId: "s1", thread: "notes-app" });

    assert.deepEqual(shown, []);
  });

  it("nunca mostra nada sem permissão, e nunca pergunta por conta própria", async () => {
    const asking = notifier("default");
    const manager = new NotificationManager(asking.fake, () => ({ enabled: true, focused: false }));

    await manager.announce({ kind: "approval", sessionId: "s1", thread: "notes-app" });

    assert.deepEqual(asking.shown, []);
    // Perguntar cabe a um botão que o usuário apertou; um navegador recusa em qualquer outro lugar mesmo.
    assert.equal(asking.asked(), 0);
  });

  it("conta ao usuário o que aconteceu, por tipo", async () => {
    const { fake, shown } = notifier();
    const manager = new NotificationManager(fake, () => ({ enabled: true, focused: false }));

    await manager.announce({ kind: "approval", sessionId: "s1", thread: "notes-app" });
    await manager.announce({ kind: "finished", sessionId: "s2", thread: "winmux", failed: false });
    await manager.announce({ kind: "finished", sessionId: "s3", thread: "winmux", failed: true });

    assert.match(shown[0]?.title ?? "", /esperando por você/);
    assert.match(shown[0]?.body ?? "", /notes-app/);
    assert.match(shown[1]?.title ?? "", /terminou/);
    assert.match(shown[2]?.title ?? "", /falhou/);
  });

  it("diz a mesma coisa sobre uma conversa uma vez, até passar tempo suficiente", async () => {
    const { fake, shown } = notifier();
    const time = clock();
    const manager = new NotificationManager(fake, () => ({ enabled: true, focused: false }), time.now);

    await manager.announce({ kind: "approval", sessionId: "s1", thread: "notes-app" });
    await manager.announce({ kind: "approval", sessionId: "s1", thread: "notes-app" });
    assert.equal(shown.length, 1, "uma conversa oscilando não deve apitar duas vezes");

    // Uma conversa diferente tem sua própria vez.
    await manager.announce({ kind: "approval", sessionId: "s2", thread: "winmux" });
    assert.equal(shown.length, 2);

    time.pass(20_001);
    await manager.announce({ kind: "approval", sessionId: "s1", thread: "notes-app" });
    assert.equal(shown.length, 3, "e pode falar de novo depois");
  });

  it("deixa uma conversa falar de novo quando seu pedido for resolvido", async () => {
    const { fake, shown } = notifier();
    const time = clock();
    const manager = new NotificationManager(fake, () => ({ enabled: true, focused: false }), time.now);

    await manager.announce({ kind: "approval", sessionId: "s1", thread: "notes-app" });
    manager.forget("s1");
    await manager.announce({ kind: "approval", sessionId: "s1", thread: "notes-app" });

    assert.equal(shown.length, 2);
  });
});
