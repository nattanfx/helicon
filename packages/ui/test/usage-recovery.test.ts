import { it } from "node:test";
import assert from "node:assert/strict";
import { backfillDetail, recoveryGap } from "../src/model/usage-recovery.js";
import type { UsageBackfillStatus } from "../src/types.js";

const status: UsageBackfillStatus = { running: false, total: 2, done: 2, calls: 0, failed: 0, startedAt: null, finishedAt: null, error: null };

it("discloses partial enumeration, incomplete histories and unidentified calls", () => {
  const detail = backfillDetail({ ...status, incomplete: 1, skipped: 2, enumerationIncomplete: true });
  assert.match(detail, /Recuperação parcial/);
  assert.match(detail, /0 chamadas novas/);
  assert.match(detail, /1 com leitura incompleta/);
  assert.match(detail, /2 registros sem identificação/);
  assert.match(detail, /lista de conversas não pôde ser lida por inteiro/);
  assert.match(backfillDetail({ ...status, failed: 1 }), /Recuperação parcial/);
});

it("reports the missing portion of a snapshot without duplicating detailed tokens", () => {
  const row = { sessionId: "s", complete: false, reason: null, promptTokens: 100, outputTokens: 50, recordedPromptTokens: 40, recordedOutputTokens: 60 };
  assert.deepEqual(recoveryGap(row), { promptTokens: 60, outputTokens: 0 });
  assert.deepEqual(recoveryGap({ ...row, promptTokens: null, outputTokens: null }), { promptTokens: null, outputTokens: null });
});
