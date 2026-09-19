import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { approvalChoiceLabel, translateApprovalLabel } from "../src/model/approvals.js";

describe("rótulos de aprovação", () => {
  it("traduz permitir uma vez, na sessão, regra persistente e recusa, sem mudar ids", () => {
    const once = { choiceId: "once", label: "Allow once", decision: "approved", scope: "once" };
    const session = { choiceId: "session", label: "Allow for this session", decision: "approved", scope: "session" };
    const remember = {
      choiceId: "remember",
      label: "Allow and remember",
      decision: "approved",
      scope: "session",
      rulePreview: "git rebase *",
    };
    const always = { choiceId: "always", label: "Always allow", decision: "approved", scope: "persistent" };
    const reject = { choiceId: "no", label: "Reject", decision: "denied", scope: "once" };
    const deny = { choiceId: "deny", label: "Deny", decision: "denied", scope: "once" };

    assert.equal(approvalChoiceLabel(once), "Permitir desta vez");
    assert.equal(approvalChoiceLabel(session), "Permitir nesta sessão");
    assert.equal(approvalChoiceLabel(remember), "Permitir e lembrar");
    assert.equal(remember.rulePreview, "git rebase *");
    assert.equal(approvalChoiceLabel(always), "Permitir sempre");
    assert.equal(approvalChoiceLabel(reject), "Rejeitar");
    assert.equal(approvalChoiceLabel(deny), "Recusar");
    assert.equal(once.choiceId, "once");
    assert.equal(remember.choiceId, "remember");
    assert.equal(reject.decision, "denied");
    assert.equal(session.scope, "session");
  });

  it("keeps unknown labels faithful and does not infer approval from wording", () => {
    assert.equal(translateApprovalLabel("Ship it"), "Ship it");
    assert.equal(translateApprovalLabel("Allow this host"), "Allow this host");
    assert.equal(translateApprovalLabel("Allow"), "Allow");
    assert.equal(
      approvalChoiceLabel({ label: "Looks safe to me" }),
      "Looks safe to me",
    );
    assert.equal(translateApprovalLabel(""), "");
    assert.equal(translateApprovalLabel("  Allow once  "), "Permitir desta vez");
  });

  it("keeps command or rule text that follows a known label", () => {
    assert.equal(translateApprovalLabel("Allow once: git push"), "Permitir desta vez: git push");
    assert.equal(translateApprovalLabel("Allow and remember - rm *"), "Permitir e lembrar - rm *");
    assert.equal(translateApprovalLabel("Reject: do not run npm test"), "Rejeitar: do not run npm test");
  });
});
