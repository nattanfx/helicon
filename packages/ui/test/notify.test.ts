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

  it("diagnóstico temporário: registra tentativas suprimidas pelo foco", async () => {
    const { fake } = notifier();
    const manager = new NotificationManager(fake, () => ({ enabled: true, focused: true, sound: true }));

    await manager.announce({ kind: "finished", sessionId: "s1", thread: "notes-app", failed: false, turnId: "t1" });

    const traces = manager.recent();
    assert.equal(traces.length, 1);
    assert.equal(traces[0]?.kind, "finished");
    assert.equal(traces[0]?.turnId, "t1");
    assert.equal(traces[0]?.focused, true);
    assert.equal(traces[0]?.balloon, "foco");
    assert.equal(traces[0]?.beep, "foco");
    assert.equal(traces[0]?.permission, "não consultada");
  });

  it("diagnóstico temporário: registra balão mostrado, transporte e resultado do bipe", async () => {
    const { fake, shown } = notifier();
    fake.label = "desktop";
    const manager = new NotificationManager(
      fake,
      () => ({ enabled: true, focused: false, sound: true }),
      undefined,
      () => ({ scheduled: true, audioState: "running" }),
    );

    await manager.announce({ kind: "finished", sessionId: "s1", thread: "notes-app", failed: false, turnId: "t7" });

    assert.equal(shown.length, 1);
    const traces = manager.recent();
    assert.equal(traces[0]?.backend, "desktop");
    assert.equal(traces[0]?.permission, "granted");
    assert.equal(typeof traces[0]?.permissionMs, "number");
    assert.equal(traces[0]?.balloon, "mostrado");
    assert.equal(traces[0]?.beep, "agendado (running)");
    assert.equal(traces[0]?.turnId, "t7");
  });

  it("diagnóstico temporário: registra repetição, falta de permissão e bipe quebrado", async () => {
    const { fake, shown } = notifier("denied");
    const time = clock();
    const manager = new NotificationManager(fake, () => ({ enabled: true, focused: false, sound: true }), time.now, () => {
      throw new Error("sem áudio");
    });

    await manager.announce({ kind: "approval", sessionId: "s1", thread: "notes-app" });
    await manager.announce({ kind: "approval", sessionId: "s1", thread: "notes-app" });

    assert.deepEqual(shown, []);
    const traces = manager.recent();
    assert.equal(traces.length, 2);
    assert.equal(traces[0]?.balloon, "sem permissão");
    assert.equal(traces[0]?.beep, "falha: sem áudio");
    assert.equal(traces[1]?.balloon, "repetição 20s");
    assert.equal(traces[1]?.beep, "repetição 20s");
  });

  it("diagnóstico temporário: registra mostrador quebrado e bipe sem retorno", async () => {
    const { fake } = notifier();
    const broken: Notifier = {
      ...fake,
      show: async () => {
        throw new Error("recusado");
      },
    };
    const manager = new NotificationManager(broken, () => ({ enabled: true, focused: false, sound: true }), undefined, () => {});

    await manager.announce({ kind: "question", sessionId: "s1", thread: "notes-app" });

    const traces = manager.recent();
    assert.equal(traces[0]?.balloon, "falha: recusado");
    assert.equal(traces[0]?.beep, "chamado");
  });

  it("diagnóstico temporário: guarda só as últimas 20 tentativas", async () => {
    const { fake } = notifier();
    const manager = new NotificationManager(fake, () => ({ enabled: true, focused: false }));

    for (let i = 0; i < 25; i += 1) {
      await manager.announce({ kind: "approval", sessionId: `s${i}`, thread: "notes-app" });
    }

    const traces = manager.recent();
    assert.equal(traces.length, 20);
    assert.equal(traces[0]?.sessionId, "s5");
    assert.equal(traces[19]?.sessionId, "s24");
  });

  it("mostra o balão em primeiro plano só com a política do balão", async () => {
    const { fake, shown } = notifier();
    const quiet = new NotificationManager(fake, () => ({ enabled: true, focused: true }));
    await quiet.announce({ kind: "finished", sessionId: "s1", thread: "notes-app", failed: false });
    assert.deepEqual(shown, [], "foco cala sem a política");

    const loud = new NotificationManager(fake, () => ({ enabled: true, focused: true, balloonForeground: true }));
    await loud.announce({ kind: "finished", sessionId: "s2", thread: "notes-app", failed: false });
    assert.equal(shown.length, 1);
  });

  it("toca o bipe em primeiro plano só com a política do som", async () => {
    const { fake, shown } = notifier();
    let beeps = 0;
    const sound = () => {
      beeps += 1;
    };
    const quiet = new NotificationManager(fake, () => ({ enabled: false, focused: true, sound: true }), undefined, sound);
    await quiet.announce({ kind: "finished", sessionId: "s1", thread: "notes-app", failed: false });
    assert.equal(beeps, 0, "foco cala sem a política");

    const loud = new NotificationManager(
      fake,
      () => ({ enabled: false, focused: true, sound: true, soundForeground: true }),
      undefined,
      sound,
    );
    await loud.announce({ kind: "finished", sessionId: "s2", thread: "notes-app", failed: false });
    assert.equal(beeps, 1);
    assert.deepEqual(shown, [], "a política do som não acende o balão");
  });

  it("não cala um turno novo por outro ter terminado há pouco", async () => {
    const { fake, shown } = notifier();
    const time = clock();
    const manager = new NotificationManager(fake, () => ({ enabled: true, focused: false }), time.now);

    await manager.announce({ kind: "finished", sessionId: "s1", thread: "notes-app", failed: false, turnId: "t1" });
    time.pass(5_000);
    await manager.announce({ kind: "finished", sessionId: "s1", thread: "notes-app", failed: false, turnId: "t2" });
    assert.equal(shown.length, 2, "turnos distintos têm cada um seu aviso");

    await manager.announce({ kind: "finished", sessionId: "s1", thread: "notes-app", failed: false, turnId: "t2" });
    assert.equal(shown.length, 2, "o mesmo turno repetido continua dito uma vez");
  });

  it("a prova ignora foco, interruptores e repetição, mas respeita a permissão", async () => {
    const { fake, shown } = notifier();
    let beeps = 0;
    const manager = new NotificationManager(
      fake,
      () => ({ enabled: false, focused: true, sound: false }),
      undefined,
      () => {
        beeps += 1;
      },
    );

    await manager.preview("both");
    await manager.preview("both");

    assert.equal(shown.length, 2);
    assert.equal(beeps, 2);
    assert.match(shown[0]?.title ?? "", /teste de aviso/);
    const traces = manager.recent();
    assert.equal(traces[0]?.sessionId, "teste");
    assert.equal(traces[0]?.balloon, "mostrado (teste)");
  });

  it("a prova de som não consulta permissão nem mostra balão", async () => {
    const asking = notifier("denied");
    let consulted = 0;
    const counting: Notifier = {
      ...asking.fake,
      permission: async () => {
        consulted += 1;
        return "denied";
      },
    };
    let beeps = 0;
    const manager = new NotificationManager(
      counting,
      () => ({ enabled: true, focused: true, sound: true }),
      undefined,
      () => {
        beeps += 1;
      },
    );

    await manager.preview("sound");

    assert.equal(beeps, 1);
    assert.deepEqual(asking.shown, []);
    assert.equal(consulted, 0, "som não depende de permissão");
    assert.equal(asking.asked(), 0);
    const traces = manager.recent();
    assert.equal(traces[0]?.balloon, "não testado");
    assert.equal(traces[0]?.permission, "não consultada");
  });

  it("anota o caminho do balão no diagnóstico quando o mostrador informa", async () => {
    const { fake, shown } = notifier();
    let path: string | undefined;
    const native: Notifier = {
      ...fake,
      get lastShowPath() {
        return path;
      },
      show: async (note) => {
        await fake.show(note);
        path = "nativo";
      },
    };
    const manager = new NotificationManager(native, () => ({ enabled: true, focused: false }));

    await manager.announce({ kind: "approval", sessionId: "s1", thread: "notes-app" });

    assert.equal(shown.length, 1);
    assert.equal(manager.recent()[0]?.balloon, "mostrado (nativo)");
  });

  it("a prova de balão sem permissão não mostra nada e anota", async () => {
    const asking = notifier("denied");
    let beeps = 0;
    const manager = new NotificationManager(
      asking.fake,
      () => ({ enabled: false, focused: true, sound: false }),
      undefined,
      () => {
        beeps += 1;
      },
    );

    await manager.preview("balloon");

    assert.deepEqual(asking.shown, []);
    assert.equal(beeps, 0);
    const traces = manager.recent();
    assert.equal(traces[0]?.balloon, "sem permissão");
    assert.equal(traces[0]?.beep, "não testado");
  });

  it("balão com som sai sonando e dispensa o som separado", async () => {
    const { fake, shown } = notifier();
    const silences: (boolean | undefined)[] = [];
    let path: string | undefined;
    let beeps = 0;
    const native: Notifier = {
      ...fake,
      get lastShowPath() {
        return path;
      },
      show: async (note) => {
        await fake.show(note);
        silences.push(note.silent);
        path = "nativo";
      },
    };
    const manager = new NotificationManager(
      native,
      () => ({ enabled: true, focused: false, sound: true }),
      undefined,
      () => {
        beeps += 1;
      },
    );

    await manager.announce({ kind: "finished", sessionId: "s1", thread: "notes-app", failed: false });

    assert.equal(shown.length, 1);
    assert.deepEqual(silences, [false]);
    assert.equal(beeps, 0, "o próprio balão já sonou");
    const traces = manager.recent();
    assert.equal(traces[0]?.balloon, "mostrado (nativo)");
    assert.equal(traces[0]?.beep, "no balão (nativo)");
  });

  it("balão sem som sai mudo", async () => {
    const { fake, shown } = notifier();
    const silences: (boolean | undefined)[] = [];
    let beeps = 0;
    const native: Notifier = {
      ...fake,
      show: async (note) => {
        await fake.show(note);
        silences.push(note.silent);
      },
    };
    const manager = new NotificationManager(
      native,
      () => ({ enabled: true, focused: false, sound: false }),
      undefined,
      () => {
        beeps += 1;
      },
    );

    await manager.announce({ kind: "finished", sessionId: "s1", thread: "notes-app", failed: false });

    assert.equal(shown.length, 1);
    assert.deepEqual(silences, [true]);
    assert.equal(beeps, 0);
  });

  it("som sem balão toca separado", async () => {
    const { fake, shown } = notifier();
    const manager = new NotificationManager(
      fake,
      () => ({ enabled: false, focused: false, sound: true }),
      undefined,
      async () => ({ scheduled: true, audioState: "sistema" }),
    );

    await manager.announce({ kind: "finished", sessionId: "s1", thread: "notes-app", failed: false });

    assert.deepEqual(shown, []);
    assert.equal(manager.recent()[0]?.beep, "agendado (sistema)");
  });

  it("queda para o plug-in toca o som separado", async () => {
    const { fake, shown } = notifier();
    let beeps = 0;
    const plugin: Notifier = {
      ...fake,
      lastShowPath: "plugin",
      show: async (note) => {
        await fake.show(note);
      },
    };
    const manager = new NotificationManager(
      plugin,
      () => ({ enabled: true, focused: false, sound: true }),
      undefined,
      async () => {
        beeps += 1;
        return { scheduled: true, audioState: "sistema" };
      },
    );

    await manager.announce({ kind: "finished", sessionId: "s1", thread: "notes-app", failed: false });

    assert.equal(shown.length, 1);
    assert.equal(beeps, 1, "o plug-in é mudo, então o som sai separado");
    const traces = manager.recent();
    assert.equal(traces[0]?.balloon, "mostrado (plugin)");
    assert.equal(traces[0]?.beep, "agendado (sistema)");
  });

  it("a prova dos dois sai no balão sonando sem som separado", async () => {
    const { fake, shown } = notifier();
    const silences: (boolean | undefined)[] = [];
    let path: string | undefined;
    let beeps = 0;
    const native: Notifier = {
      ...fake,
      get lastShowPath() {
        return path;
      },
      show: async (note) => {
        await fake.show(note);
        silences.push(note.silent);
        path = "nativo";
      },
    };
    const manager = new NotificationManager(
      native,
      () => ({ enabled: false, focused: true, sound: false }),
      undefined,
      () => {
        beeps += 1;
      },
    );

    await manager.preview("both");

    assert.equal(shown.length, 1);
    assert.deepEqual(silences, [false]);
    assert.equal(beeps, 0);
    const traces = manager.recent();
    assert.equal(traces[0]?.balloon, "mostrado (teste, nativo)");
    assert.equal(traces[0]?.beep, "no balão (nativo)");
  });

  it("a prova do balão sai muda", async () => {
    const { fake, shown } = notifier();
    const silences: (boolean | undefined)[] = [];
    const native: Notifier = {
      ...fake,
      show: async (note) => {
        await fake.show(note);
        silences.push(note.silent);
      },
    };
    const manager = new NotificationManager(native, () => ({ enabled: false, focused: true, sound: false }));

    await manager.preview("balloon");

    assert.equal(shown.length, 1);
    assert.deepEqual(silences, [true]);
  });
});
