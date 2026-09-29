import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HELICON_CLIENT_NAME,
  HeliconMspHost,
  classifyServeExit,
  serveExitMessage,
} from "../src/mspHost.js";

interface FakeConnection {
  commands: { method: string; params: unknown }[];
  handlers: ((n: { method: string }) => void)[];
  command(method: string, params?: Record<string, unknown>): Promise<unknown>;
  onNotification(handler: (n: { method: string }) => void): void;
}

function makeConnection(): FakeConnection {
  return {
    commands: [],
    handlers: [],
    async command(method: string, params?: Record<string, unknown>) {
      this.commands.push({ method, params });
      return { ok: true };
    },
    onNotification(handler) {
      this.handlers.push(handler);
    },
  };
}

function makeSpawn(connection: FakeConnection, opts?: { fingerprintWarning?: unknown }) {
  const calls: { clientName: string; clientVersion: string; capabilities: unknown }[] = [];
  const spawn = ((_spawnOpts: unknown) => ({
    initialize: async (initOpts: { clientInfo: { name: string; version: string }; capabilities?: unknown }) => {
      calls.push({
        clientName: initOpts.clientInfo.name,
        clientVersion: initOpts.clientInfo.version,
        capabilities: initOpts.capabilities,
      });
      return {
        initializeResult: { serverInfo: { name: "muse-test" } },
        fingerprintWarning: opts?.fingerprintWarning ?? null,
        connection,
        close: async () => ({ code: 0, signal: null }),
      };
    },
  }) as unknown) as ConstructorParameters<typeof HeliconMspHost>[1];
  return { spawn, calls };
}

describe("classifyServeExit", () => {
  it("maps exit codes to classes", () => {
    assert.equal(classifyServeExit(0), "clean");
    assert.equal(classifyServeExit(5), "sdk-tier-off");
    assert.equal(classifyServeExit(null), "signalled");
    assert.equal(classifyServeExit(1), "error");
    assert.equal(serveExitMessage("sdk-tier-off").length > 0, true);
  });
});

describe("HeliconMspHost", () => {
  it("identifies as helicon and surfaces the fingerprint warning", async () => {
    const connection = makeConnection();
    const { spawn, calls } = makeSpawn(connection, {
      fingerprintWarning: { mismatch: true },
    });
    const host = new HeliconMspHost(
      { command: "muse", args: ["serve"], cwd: "/tmp" },
      spawn,
    );
    const started = await host.start("0.1.0");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.clientName, HELICON_CLIENT_NAME);
    assert.equal(calls[0]?.clientVersion, "0.1.0");
    assert.deepEqual(started.fingerprintWarning, { mismatch: true });
  });

  it("requests the session list stream capability", async () => {
    const connection = makeConnection();
    const { spawn, calls } = makeSpawn(connection);
    const host = new HeliconMspHost(
      { command: "muse", args: ["serve"], cwd: "/tmp" },
      spawn,
    );
    await host.start("0.1.0");
    const requested = (calls[0]?.capabilities as { requestedCapabilities?: string[] } | undefined)
      ?.requestedCapabilities;
    assert.ok(requested?.includes("userShell"));
    assert.ok(requested?.includes("sessionListStream"));
  });

  it("refuses connection use before start and closes cleanly", async () => {
    const connection = makeConnection();
    const { spawn } = makeSpawn(connection);
    const host = new HeliconMspHost(
      { command: "muse", args: ["serve"], cwd: "/tmp" },
      spawn,
    );
    assert.throws(() => host.connection, /start\(\)/);
    await assert.rejects(() => host.close(), /start\(\)/);
    await host.start("0.1.0");
    assert.ok(host.connection);
    const exit = await host.close();
    assert.deepEqual(exit, { code: 0, signal: null });
  });
});
