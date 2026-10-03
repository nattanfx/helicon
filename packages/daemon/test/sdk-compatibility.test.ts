import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EXPECTED_SCHEMA_FINGERPRINT } from "@muse-code/sdk";
import { HeliconMspHost } from "../src/mspHost.js";

// Run the installed SDK over real stdio. The fake host does not import the SDK,
// so an incompatible handshake, command envelope or decoder fails at the boundary.
const FAKE_HOST = String.raw`
const { createInterface } = require("node:readline");
const send = frame => process.stdout.write(JSON.stringify(frame) + "\n");
let initialized = false;
const lines = createInterface({ input: process.stdin });
lines.on("line", line => {
  const frame = JSON.parse(line);
  const reply = result => send({ jsonrpc: "2.0", id: frame.id, result });
  if (frame.method === "initialize") {
    reply({
      serverInfo: { name: "muse-fixture", version: process.env.TEST_HOST_VERSION },
      schema: { version: "1", fingerprint: process.env.TEST_HOST_FINGERPRINT },
      capabilities: { grantedCapabilities: frame.params.capabilities.requestedCapabilities },
      futureField: { preserved: true },
    });
  } else if (frame.method === "initialized") {
    initialized = true;
  } else if (!initialized) {
    process.exitCode = 2;
    lines.close();
  } else if (frame.method === "session/list") {
    reply({ sessions: [], nextCursor: null, receivedParams: frame.params });
  } else if (frame.method === "session/start") {
    reply({ commandId: frame.params.commandId, session: {
      sessionId: "fixture-session", workspaceRoot: frame.params.workspaceRoot,
    } });
    send({ jsonrpc: "2.0", method: "session/statusChanged", params: {
      sessionId: "fixture-session", status: "futureStatus", futureField: 42,
    } });
  } else {
    send({ jsonrpc: "2.0", id: frame.id, error: {
      code: -32601, message: "Fixture does not implement this method",
      data: { kind: "methodNotFound", retryable: false },
    } });
  }
});
`;

const HOSTS = [
  { version: "1.4.2", fingerprint: EXPECTED_SCHEMA_FINGERPRINT, warning: false },
  {
    version: "1.3.0",
    fingerprint: "sha256:7469c9e352e67def4a59df7e439984d7194fa351e1c8b7abb34060fd977ced81",
    warning: true,
  },
  {
    version: "1.4.0",
    fingerprint: "sha256:36466f634c8c78a812462ec941187fd4547b232ee06153e5feb2a1482f0d3d7f",
    warning: true,
  },
  { version: "future", fingerprint: "sha256:future-schema", warning: true },
];

describe("installed SDK compatibility over stdio", () => {
  for (const fixture of HOSTS) {
    it(`keeps raw commands, requests and events working with host ${fixture.version}`, { timeout: 10_000 }, async () => {
      const host = new HeliconMspHost({
        command: process.execPath,
        args: ["-e", FAKE_HOST],
        cwd: process.cwd(),
        env: {
          ...process.env,
          TEST_HOST_VERSION: fixture.version,
          TEST_HOST_FINGERPRINT: fixture.fingerprint,
        },
      });
      try {
        const started = await host.start("p7-test");
        const result = started.initializeResult as {
          capabilities: { grantedCapabilities: string[] };
          futureField: { preserved: boolean };
        };
        assert.deepEqual(result.capabilities.grantedCapabilities, ["userShell", "sessionListStream"]);
        assert.equal(result.futureField.preserved, true);
        if (fixture.warning) {
          const warning = started.fingerprintWarning as { kind: string; pinned: string; served: string };
          assert.equal(warning.kind, "schemaFingerprintMismatch");
          assert.equal(warning.pinned, EXPECTED_SCHEMA_FINGERPRINT);
          assert.equal(warning.served, fixture.fingerprint);
        } else {
          assert.equal(started.fingerprintWarning, null);
        }
        const listed = await host.connection.request!("session/list", { limit: 2 }) as {
          sessions: unknown[]; receivedParams: Record<string, unknown>;
        };
        assert.deepEqual(listed.sessions, []);
        assert.deepEqual(listed.receivedParams, { limit: 2 }, "read-only requests must not gain commandId");
        const notification = new Promise<unknown>(resolve => host.connection.onNotification(resolve));
        const created = await host.connection.command("session/start", { workspaceRoot: process.cwd() }) as {
          commandId: string; session: { sessionId: string };
        };
        assert.match(created.commandId, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        assert.equal(created.session.sessionId, "fixture-session");
        assert.deepEqual(await notification, {
          jsonrpc: "2.0", method: "session/statusChanged",
          params: { sessionId: "fixture-session", status: "futureStatus", futureField: 42 },
        });
        await assert.rejects(host.connection.request!("future/method"), (error: unknown) => {
          const typed = error as { code: number; kind: string; retryable: boolean };
          return typed.code === -32601 && typed.kind === "methodNotFound" && typed.retryable === false;
        });
      } finally {
        assert.deepEqual(await host.close(), { code: 0, signal: null });
      }
    });
  }
});
