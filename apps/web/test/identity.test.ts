import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveAppIdentity } from "../src/identity.js";
import { desktopUpdater } from "../src/updater.js";

describe("desktop identity resolver", () => {
  it("reads version, test channel and injected SHA from the bundle, without a feed check", async () => {
    let versionCalls = 0;
    const identity = await resolveAppIdentity({
      isDesktop: true,
      getVersion: async () => {
        versionCalls += 1;
        return "0.12.4";
      },
      getIdentifier: async () => "app.helicon.desktop.test",
      getName: async () => "Helicon Teste",
      build: "7b983556954e883f6f80cafc67bd0b4c8ae4f0c8",
    });
    assert.equal(versionCalls, 1);
    assert.equal(identity.version, "0.12.4");
    assert.equal(identity.channel, "teste");
    assert.equal(identity.productName, "Helicon Teste");
    assert.equal(identity.identifier, "app.helicon.desktop.test");
    assert.equal(identity.build, "7b983556954e883f6f80cafc67bd0b4c8ae4f0c8");
    assert.match(identity.updateUrl, /nattanfx\/helicon\/actions\/workflows\/test-windows\.yml$/);
  });

  it("treats the normal identifier as the stable channel and omits a missing build id", async () => {
    const identity = await resolveAppIdentity({
      isDesktop: true,
      getVersion: async () => "0.12.4",
      getIdentifier: async () => "app.helicon.desktop",
      getName: async () => "Helicon",
      build: "",
    });
    assert.equal(identity.channel, "normal");
    assert.equal(identity.build, null);
    assert.match(identity.updateUrl, /nattanfx\/helicon\/releases$/);
  });

  it("does not invent a desktop channel when Tauri is absent", async () => {
    const identity = await resolveAppIdentity({
      isDesktop: false,
      getVersion: async () => {
        throw new Error("getVersion should not run in the browser");
      },
      getIdentifier: async () => {
        throw new Error("getIdentifier should not run in the browser");
      },
      getName: async () => {
        throw new Error("getName should not run in the browser");
      },
      build: "not-a-sha",
    });
    assert.equal(identity.channel, "web");
    assert.equal(identity.version, "");
    assert.equal(identity.build, null);
  });

  it("does not expose a Tauri updater adapter", () => {
    assert.equal(desktopUpdater(), undefined);
  });

  it("falls back to the browser identity when the desktop APIs fail", async () => {
    const identity = await resolveAppIdentity({
      isDesktop: true,
      getVersion: async () => {
        throw new Error("plugin missing");
      },
      getIdentifier: async () => "app.helicon.desktop",
      getName: async () => "Helicon",
      build: "7b98355",
    });
    assert.equal(identity.channel, "web");
    assert.equal(identity.build, "7b98355");
  });
});
