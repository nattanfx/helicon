import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { desktopNotifier } from "../src/notifier.js";

describe("notificador do desktop", () => {
  it("usa o toast nativo e anota o caminho", async () => {
    const calls: [string, string][] = [];
    const api = desktopNotifier(async (title, body) => {
      calls.push([title, body]);
      return "winrt";
    });

    await api.show({ title: "oi", body: "teste", tag: "t" });

    assert.deepEqual(calls, [["oi", "teste"]]);
    assert.equal(api.lastShowPath, "nativo");
  });

  it("cai para o plug-in quando o nativo falha", async () => {
    const seen: unknown[] = [];
    const trash = (globalThis as { window?: unknown }).window;
    (globalThis as { window: unknown }).window = {
      Notification: class {
        constructor(title: string, options: unknown) {
          seen.push([title, options]);
        }
      },
    };
    try {
      const api = desktopNotifier(async () => {
        throw new Error("sem nativo");
      });

      await api.show({ title: "oi", body: "teste", tag: "t" });

      assert.equal(api.lastShowPath, "plugin");
      assert.equal(seen.length, 1);
    } finally {
      if (trash === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window: unknown }).window = trash;
      }
    }
  });
});
