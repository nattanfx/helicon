import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeErrorDetail, stuckThread, turnErrorCopy } from "../src/model/errors.js";

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

describe("falha de cota", () => {
  it("explains a rateLimit kind in Portuguese and does not offer retry as a fix", () => {
    const copy = turnErrorCopy("rateLimit", "quota", true);
    assert.equal(copy.title, "A cota do plano acabou");
    assert.match(copy.explanation, /não restaura a cota/);
    assert.doesNotMatch(copy.explanation, /tente de novo agora/i);
    assert.equal(copy.offerRetry, false);
    assert.equal(copy.technical, "quota");
  });

  it("recognizes a 429 sentence when the host omitted the kind, and keeps other kinds faithful", () => {
    const legacy = turnErrorCopy(null, "API error 429: Subscription quota exhausted.", true);
    assert.equal(legacy.offerRetry, false);
    assert.equal(legacy.title, "A cota do plano acabou");
    const other = turnErrorCopy("fileChanged", "API error 429: Subscription quota exhausted.", true);
    assert.equal(other.offerRetry, true);
    assert.equal(other.title, "Esta mensagem falhou");
  });

  it("strips credentials from the technical detail", () => {
    const copy = turnErrorCopy(
      "rateLimit",
      "API error 429 [request_id=abc-secret] Bearer tok_live_123 quota exhausted api_key=sk-test",
      true,
    );
    assert.equal(copy.offerRetry, false);
    assert.match(copy.technical ?? "", /request_id=…/);
    assert.doesNotMatch(copy.technical ?? "", /tok_live_123|sk-test|abc-secret/);
    assert.equal(sanitizeErrorDetail("Bearer abc def"), "Bearer … def");
  });
});
