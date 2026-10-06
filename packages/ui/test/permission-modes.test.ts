import { it } from "node:test";
import assert from "node:assert/strict";
import { MODES } from "../src/components/composer/Composer.js";

it("não promete perguntar antes no modo em que a sandbox decide", () => {
  // Medido no Muse 1.4.2 (Windows): em `onRequest` o perfil "Ask me" deixa editar o projeto e rodar o que confere
  // sem aprovação, e a sandbox recusa rede e pastas de fora sem perguntar. O texto tem de dizer isso.
  const sandbox = MODES.find((mode) => mode.value === "onRequest");
  assert.ok(sandbox);
  assert.doesNotMatch(sandbox.label, /Perguntar antes/);
  assert.match(sandbox.description, /sandbox/);
  assert.match(sandbox.description, /sem perguntar/);
  assert.match(sandbox.description, /falha sem pedir/);
});
