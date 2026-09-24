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

  it("mostra o estado da meta em português, sem cru em inglês", async () => {
    const { fake, shown } = notifier();
    const manager = new NotificationManager(fake, () => ({ enabled: true, focused: false }));

    await manager.announce({ kind: "goal", sessionId: "s1", thread: "notes-app", status: "complete" });
    await manager.announce({ kind: "goal", sessionId: "s2", thread: "winmux", status: "paused" });
    await manager.announce({ kind: "goal", sessionId: "s3", thread: "site", status: "blocked" });
    await manager.announce({ kind: "goal", sessionId: "s4", thread: "api", status: "budget_limited" });

    assert.match(shown[0]?.title ?? "", /Meta concluída/);
    assert.match(shown[0]?.body ?? "", /alcançou sua meta/);
    assert.match(shown[1]?.body ?? "", /está pausada\./);
    assert.match(shown[2]?.body ?? "", /está bloqueada\./);
    assert.match(shown[3]?.body ?? "", /está sem orçamento\./);
    for (const note of shown) {
      assert.doesNotMatch(note.body, /paused|blocked|budget_limited/);
    }
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

  it("toca o bipe junto com cada aviso mostrado", async () => {
    const { fake, shown } = notifier();
    let beeps = 0;
    const manager = new NotificationManager(
      fake,
      () => ({ enabled: true, focused: false, sound: true }),
      undefined,
      () => {
        beeps += 1;
      },
    );

    await manager.announce({ kind: "finished", sessionId: "s1", thread: "notes-app", failed: false });
    await manager.announce({ kind: "approval", sessionId: "s2", thread: "winmux" });

    assert.equal(shown.length, 2);
    assert.equal(beeps, 2);
  });

  it("não toca o bipe com o som desligado nem quando nada é mostrado", async () => {
    const { fake, shown } = notifier();
    let beeps = 0;
    const sound = () => {
      beeps += 1;
    };
    const off = new NotificationManager(fake, () => ({ enabled: true, focused: false, sound: false }), undefined, sound);
    await off.announce({ kind: "finished", sessionId: "s1", thread: "notes-app", failed: false });
    assert.equal(shown.length, 1);
    assert.equal(beeps, 0, "aviso sem som não apita");

    const watching = new NotificationManager(fake, () => ({ enabled: true, focused: true, sound: true }), undefined, sound);
    await watching.announce({ kind: "finished", sessionId: "s2", thread: "winmux", failed: false });
    assert.equal(beeps, 0, "nada mostrado, nada apitado");
  });

  it("um bipe quebrado nunca quebra o aviso", async () => {
    const { fake, shown } = notifier();
    const manager = new NotificationManager(fake, () => ({ enabled: true, focused: false, sound: true }), undefined, () => {
      throw new Error("sem áudio");
    });

    await manager.announce({ kind: "finished", sessionId: "s1", thread: "notes-app", failed: false });

    assert.equal(shown.length, 1);
  });

  it("toca o bipe mesmo com o balão desligado", async () => {
    const { fake, shown } = notifier();
    let beeps = 0;
    const manager = new NotificationManager(
      fake,
      () => ({ enabled: false, focused: false, sound: true }),
      undefined,
      () => {
        beeps += 1;
      },
    );

    await manager.announce({ kind: "finished", sessionId: "s1", thread: "notes-app", failed: false });

    assert.equal(shown.length, 0, "balão desligado não mostra nada");
    assert.equal(beeps, 1, "mas o bipe tem vida própria");
  });

  it("toca o bipe mesmo quando o sistema nega o balão", async () => {
    const { fake, shown } = notifier("denied");
    let beeps = 0;
    const manager = new NotificationManager(
      fake,
      () => ({ enabled: true, focused: false, sound: true }),
      undefined,
      () => {
        beeps += 1;
      },
    );

    await manager.announce({ kind: "finished", sessionId: "s1", thread: "notes-app", failed: false });

    assert.equal(shown.length, 0);
    assert.equal(beeps, 1, "permissão negada cala o balão, não o bipe");
  });
});
