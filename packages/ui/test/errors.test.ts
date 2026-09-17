import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stuckThread } from "../src/model/errors.js";

describe("conversas travadas", () => {
  it("sabe que uma imagem ilegível envenena todas as próximas mensagens", () => {
    const found = stuckThread(
      "API error 400 [request_id=f5e4]: invalid image data at input[59].content[1]: the `image/png` payload could not be decoded (it may be corrupt or truncated). (invalid_request_error)",
    );
    assert.equal(found?.kind, "image");
    assert.equal(found?.remedy, "compact");
    assert.match(found?.message ?? "", /Compactar/);
  });

  it("sabe que o raciocínio não pode ser reaproveitado após trocar de provedor", () => {
    const found = stuckThread(
      "provider-private history is incompatible with the active route: reasoning replay `rs_6aa475:rs_01a0926c` has no provider attribution after a provider switch; start a fresh turn without opaque reasoning history",
    );
    assert.equal(found?.kind, "reasoning");
    // "Compactar" mantém as mensagens recentes como estão, então o raciocínio inutilizável sobrevive: visto ao vivo.
    assert.equal(found?.remedy, "fresh");
    assert.match(found?.message ?? "", /nova conversa/i);
  });

  it("não culpa o histórico pela imagem recém-enviada", () => {
    const message = "API error 400: invalid image data at input[3].content[1]: the `image/png` payload could not be decoded.";
    const own = stuckThread(message, { ownImages: true });
    assert.equal(own?.kind, "image");
    assert.equal(own?.remedy, "none", "compactar descartaria o arquivo e tentaria o pedido sem ele");
    assert.match(own?.message ?? "", /nesta mensagem/);
    assert.match(own?.message ?? "", /mais antiga/, "uma mais antiga pode ser a real culpada, então diga isso");
    assert.equal(stuckThread(message, { ownImages: false })?.remedy, "compact");
    assert.equal(stuckThread(message)?.remedy, "compact", "uma mensagem só com PDF não pode ter causado isto");
  });

  it("deixa uma falha comum em paz", () => {
    assert.equal(stuckThread("API error 429: Subscription quota exhausted."), null);
    assert.equal(stuckThread("The turn failed."), null);
    assert.equal(stuckThread(""), null);
    assert.equal(stuckThread(null), null);
  });
});
