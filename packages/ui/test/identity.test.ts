import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FORK_RELEASES_URL,
  FORK_REPO_URL,
  FORK_TEST_ACTIONS_URL,
  NORMAL_IDENTIFIER,
  TEST_IDENTIFIER,
  channelDescription,
  channelFromIdentifier,
  channelProductName,
  identityHeading,
  identitySummary,
  manualUpdateHint,
  manualUpdateUrl,
  sanitizeBuild,
  shortBuild,
  webIdentity,
} from "../src/model/identity.js";

describe("app identity", () => {
  it("derives the test and normal channels from the Tauri identifiers, not from a label", () => {
    assert.equal(channelFromIdentifier(TEST_IDENTIFIER), "teste");
    assert.equal(channelFromIdentifier(NORMAL_IDENTIFIER), "normal");
    assert.equal(channelFromIdentifier("app.helicon.desktop.test"), "teste");
    assert.equal(channelFromIdentifier(""), "web");
    assert.equal(channelFromIdentifier(null), "web");
    assert.equal(channelFromIdentifier("app.other.desktop"), "normal");
  });

  it("keeps product names aligned with the installed identifiers", () => {
    assert.equal(channelProductName("teste"), "Helicon Teste");
    assert.equal(channelProductName("normal"), "Helicon");
    assert.equal(channelProductName("web"), "Helicon (navegador)");
  });

  it("points manual updates at this fork, never at the original project", () => {
    assert.equal(manualUpdateUrl("teste"), FORK_TEST_ACTIONS_URL);
    assert.equal(manualUpdateUrl("normal"), FORK_RELEASES_URL);
    assert.equal(manualUpdateUrl("web"), FORK_REPO_URL);
    assert.match(FORK_REPO_URL, /nattanfx\/helicon$/);
    assert.doesNotMatch(manualUpdateHint("teste"), /HarjjotSinghh/i);
    assert.doesNotMatch(manualUpdateHint("normal"), /0\.14\./);
    assert.match(channelDescription("teste"), /não substitui a instalação normal/);
    assert.match(channelDescription("normal"), /Helicon Teste é um aplicativo separado/);
  });

  it("accepts only a git SHA for the build id and never a version number", () => {
    assert.equal(sanitizeBuild("7b983556954e883f6f80cafc67bd0b4c8ae4f0c8"), "7b983556954e883f6f80cafc67bd0b4c8ae4f0c8");
    assert.equal(sanitizeBuild("7B98355"), "7b98355");
    assert.equal(sanitizeBuild(""), null);
    assert.equal(sanitizeBuild("unknown"), null);
    assert.equal(sanitizeBuild("0.12.4"), null);
    assert.equal(sanitizeBuild("0.14.3"), null);
    assert.equal(sanitizeBuild("v0.12.4-pt4"), null);
    assert.equal(sanitizeBuild("latest"), null);
    assert.equal(shortBuild("7b983556954e883f6f80cafc67bd0b4c8ae4f0c8"), "7b98355");
  });

  it("renders heading and summary from metadata without inventing a version", () => {
    const teste = {
      version: "0.12.4",
      channel: "teste" as const,
      productName: "Helicon Teste",
      identifier: TEST_IDENTIFIER,
      build: "7b983556954e883f6f80cafc67bd0b4c8ae4f0c8",
      updateUrl: FORK_TEST_ACTIONS_URL,
    };
    assert.equal(identityHeading(teste), "Helicon Teste 0.12.4");
    assert.equal(identitySummary(teste), "Canal de teste, separado da instalação normal · Compilação 7b98355");
    const web = webIdentity();
    assert.equal(web.version, "");
    assert.equal(identityHeading(web), "Helicon (navegador)");
    assert.equal(identitySummary(web), "Aberto no navegador");
  });
});
