import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HeliconError } from "../src/client.js";
import { authErrorCopy, sanitizeErrorDetail, sessionErrorCopy, stuckThread, turnErrorCopy, userFacingError } from "../src/model/errors.js";

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
  it("explains a rateLimit kind with quota evidence in Portuguese and does not offer retry as a fix", () => {
    const copy = turnErrorCopy("rateLimit", "API error 429: Subscription quota exhausted.", true);
    assert.equal(copy.title, "A cota do plano acabou");
    assert.match(copy.explanation, /não restaura a cota/);
    assert.doesNotMatch(copy.explanation, /tente de novo agora/i);
    assert.equal(copy.offerRetry, false);
    assert.match(copy.technical ?? "", /Subscription quota exhausted/);
  });

  it("recognizes a 429 quota sentence when the host omitted the kind, and keeps other kinds faithful", () => {
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

describe("limite temporário (REV4)", () => {
  it("does not treat a generic 429 as exhausted quota and respects retryable", () => {
    const limited = turnErrorCopy(null, "429 Too many requests. Retry after 5 seconds.", true);
    assert.equal(limited.title, "Limite temporário atingido");
    assert.doesNotMatch(limited.explanation, /cota do plano acabou/i);
    assert.match(limited.explanation, /temporário/);
    assert.match(limited.explanation, /Não houve nova tentativa automática/);
    assert.equal(limited.offerRetry, true);
    assert.match(limited.technical ?? "", /Retry after 5 seconds/);

    const waiting = turnErrorCopy(null, "429 Too many requests. Retry after 5 seconds.", false);
    assert.equal(waiting.title, "Limite temporário atingido");
    assert.equal(waiting.offerRetry, false);
  });

  it("treats rateLimit without quota evidence as a temporary limit, not quota", () => {
    const bare = turnErrorCopy("rateLimit", "quota", true);
    assert.equal(bare.title, "Limite temporário atingido");
    assert.equal(bare.offerRetry, true);

    const genericRate = turnErrorCopy("rateLimit", "rate limit exceeded, slow down", true);
    assert.equal(genericRate.title, "Limite temporário atingido");
    assert.equal(genericRate.offerRetry, true);
  });

  it("keeps an unknown kind faithful and handles an error without a code", () => {
    const unknown = turnErrorCopy("fileChanged", "429 Too many requests. Retry after 5 seconds.", true);
    assert.equal(unknown.title, "Esta mensagem falhou");
    assert.equal(unknown.offerRetry, true);
    assert.equal(unknown.technical, null);

    const noCode = turnErrorCopy(null, "Something broke", true);
    assert.equal(noCode.title, "Esta mensagem falhou");
    assert.equal(noCode.offerRetry, true);
    assert.equal(noCode.technical, null);

    const noCodeWaiting = turnErrorCopy(undefined, "Something broke", false);
    assert.equal(noCodeWaiting.title, "Esta mensagem falhou");
    assert.equal(noCodeWaiting.offerRetry, false);
  });
});

describe("falha de autenticação", () => {
  it("explains unauthorized and expired desktop launch without echoing the secret", () => {
    const denied = authErrorCopy("unauthorized", 401, "Missing or invalid token.");
    assert.equal(denied?.title, "Acesso recusado");
    assert.match(denied?.explanation ?? "", /mesmo valor errado não resolve/);
    assert.doesNotMatch(denied?.explanation ?? "", /test-secret|Bearer /);

    const expired = authErrorCopy("desktopAuthExpired", 401, "Invalid or expired desktop launch.");
    assert.match(expired?.explanation ?? "", /atalho/);
    assert.match(expired?.explanation ?? "", /não gera uma abertura nova/);

    const legacy = authErrorCopy(null, 401, "That token does not match this daemon.");
    assert.equal(legacy?.title, "Acesso recusado");
  });

  it("explains host and origin refusals, and does not treat a file 403 as auth", () => {
    assert.equal(authErrorCopy("hostForbidden", 403, "This daemon does not answer that host.")?.title, "Host não permitido");
    assert.equal(authErrorCopy("originForbidden", 403, "This daemon does not answer that origin.")?.title, "Origem não permitida");
    assert.equal(authErrorCopy(null, 403, "That file is outside this project."), null);
  });

  it("surfaces auth copy from a HeliconError without putting the token in the text", () => {
    const error = new HeliconError("Missing or invalid token. Bearer tok_live_secret", 401, "unauthorized");
    const text = userFacingError(error);
    assert.match(text, /não aceitou o acesso/);
    assert.doesNotMatch(text, /tok_live_secret/);
  });
});

describe("falha de sessão", () => {
  it("explains stream mismatch without promising that retry changes the model profile", () => {
    const copy = sessionErrorCopy("sessionStreamMismatch", "stream mismatch");
    assert.equal(copy?.title, "O fluxo desta conversa não bate");
    assert.match(copy?.explanation ?? "", /não troca o perfil/);
    assert.doesNotMatch(copy?.explanation ?? "", /troca o modelo/);
    const legacy = sessionErrorCopy(null, "stream mismatch");
    assert.equal(legacy?.title, copy?.title);
  });

  it("explains a session that is not loaded or is gone, and ignores other kinds", () => {
    assert.match(sessionErrorCopy("sessionNotLoaded", "not loaded")?.explanation ?? "", /não troca o modelo nem o perfil/);
    assert.match(sessionErrorCopy("sessionNotFound", "Unknown session.")?.explanation ?? "", /não a recria/);
    assert.equal(sessionErrorCopy("unauthorized", "not loaded"), null);
    const text = userFacingError(new HeliconError("stream mismatch", 409, "sessionStreamMismatch"));
    assert.match(text, /Recarregar a conversa pode realinhar/);
    assert.doesNotMatch(text, /Bearer /);
  });
});
