import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseModelList } from "../src/client.js";
import {
  alignLines,
  describeApproval,
  describeTool,
  diffFromEcho,
  diffLines,
  diffStats,
  displayTitle,
  emptyAttachmentWarning,
  extractDiff,
  formatDuration,
  formatTokens,
  hostPatchViews,
  itemDiff,
  lastLine,
  mergeDiffLines,
  readableHostPatch,
  CONTRIBUTOR_LABEL,
  CONTRIBUTOR_NOTICE,
  contributorChoiceLabel,
  modelDisplayName,
  relativeTime,
  shortenPath,
  stripAttachmentMentions,
  stripImageMarkers,
  withoutDiffEcho,
} from "../src/model/format.js";
import type { MspItem } from "../src/types.js";
import { modelList } from "./fixtures/probe.js";

function tool(name: string, args: unknown, status = "completed", visibleOutput?: string): MspItem {
  return {
    itemId: "i",
    kind: "toolCall",
    status,
    revision: 1,
    tool: name,
    args: JSON.stringify(args),
    ...(visibleOutput === undefined ? {} : { visibleOutput }),
  };
}

describe("formatação", () => {
  it("reads a giant edit as two plain blocks instead of aligning it", () => {
    // A running edit's diff is recomputed on every flush, and the alignment table costs a cell per
    // old/new pair: a 2000-line find/replace would eat the frame budget on its own (#32).
    const removed = Array.from({ length: 2000 }, (_, i) => `old line ${i}`);
    const added = Array.from({ length: 2000 }, (_, i) => `new line ${i}`);
    const started = Date.now();
    const rows = alignLines(removed, added);
    assert.ok(Date.now() - started < 2000, `giant edit took ${Date.now() - started}ms to align`);
    assert.equal(rows.length, 4000);
    assert.ok(rows.every((row, i) => (i < 2000 ? row.kind === "del" : row.kind === "add")));
    assert.deepEqual(
      rows.map((row) => row.text),
      [...removed, ...added],
    );
    // A modest edit still aligns: shared lines read as context, not as churn.
    assert.deepEqual(
      alignLines(["same", "old"], ["same", "new"]).map((row) => row.kind),
      ["same", "del", "add"],
    );
  });

  it("takes the last non-blank line without reading the whole log", () => {
    assert.equal(lastLine(undefined), null);
    assert.equal(lastLine(""), null);
    assert.equal(lastLine("\n"), null);
    assert.equal(lastLine("\n  \n"), null);
    assert.equal(lastLine("only"), "only");
    assert.equal(lastLine("first\nsecond\n\n"), "second");
    assert.equal(lastLine("first\nsecond"), "second");
    assert.equal(lastLine("a\n\x1b[32mok\x1b[0m\n"), "ok");
    assert.equal(lastLine("a\n\x1b[0m\n"), "a");
    assert.equal(lastLine("a\r\nb\r\n"), "b");
    const head = `${"x".repeat(1000)}\n`.repeat(5000);
    assert.equal(lastLine(`${head}tail\n\n\n`), "tail");
  });


  it("formata tempos relativos de forma compacta", () => {
    const now = Date.parse("2026-09-11T12:00:00Z");
    assert.equal(relativeTime("2026-09-11T11:59:40Z", now), "agora");
    assert.equal(relativeTime("2026-09-11T11:56:00Z", now), "4min");
    assert.equal(relativeTime("2026-09-11T09:00:00Z", now), "3h");
    assert.equal(relativeTime("2026-09-09T12:00:00Z", now), "2d");
    assert.equal(relativeTime("2026-08-21T12:00:00Z", now), "3sem");
    assert.equal(relativeTime("garbage", now), "");
  });

  it("formata durações e contagens de tokens", () => {
    assert.equal(formatDuration(42316), "42s");
    assert.equal(formatDuration(73471), "1min 13s");
    assert.equal(formatDuration(120000), "2min");
    assert.equal(formatDuration(3_900_000), "1h 5min");
    assert.equal(formatTokens(842), "842");
    assert.equal(formatTokens(21177), "21k");
    assert.equal(formatTokens(1500), "1.5k");
    assert.equal(formatTokens(1_007_997), "1M");
  });

  it("esconde marcadores de imagem do texto exibido do prompt", () => {
    assert.equal(stripImageMarkers("olá[Image #1]"), "olá");
    assert.equal(stripImageMarkers("[Image #1]"), "");
    assert.equal(stripImageMarkers("a[Image #1] b[Image #12]"), "a b");
    assert.equal(stripImageMarkers("texto\n\n[Image #1]"), "texto");
    assert.equal(stripImageMarkers("sem marcador"), "sem marcador");
    assert.equal(stripImageMarkers("[Image #x]"), "[Image #x]");
    assert.equal(stripImageMarkers("[image #1]"), "[image #1]");
    assert.equal(stripImageMarkers(""), "");
  });

  it("esconde menções de anexo do texto exibido do prompt", () => {
    assert.equal(stripAttachmentMentions("texto\n\n@.helicon/attachments/relatorio.txt"), "texto");
    assert.equal(stripAttachmentMentions("@.helicon/attachments/Novo-a-Documento-de-Texto.txt"), "");
    assert.equal(stripAttachmentMentions("a@.helicon/attachments/a.txt b@.helicon/attachments/c-2.md"), "a b");
    assert.equal(stripAttachmentMentions("sem menção"), "sem menção");
    assert.equal(stripAttachmentMentions("@alguem"), "@alguem");
    assert.equal(stripAttachmentMentions("@.helicon/outros/x.txt"), "@.helicon/outros/x.txt");
    assert.equal(stripAttachmentMentions(""), "");
  });

  it("avisa em português quando a mensagem traz arquivo vazio", () => {
    assert.equal(emptyAttachmentWarning([]), null);
    assert.deepEqual(emptyAttachmentWarning(["vazio.txt"]), {
      title: "Arquivo vazio",
      detail:
        '"vazio.txt" não tem conteúdo (0 B), então a mensagem não foi enviada. Remova o arquivo da mensagem ou escolha um arquivo com conteúdo.',
    });
    const two = emptyAttachmentWarning(["a.txt", "b.txt"]);
    assert.equal(two?.title, "Arquivos vazios");
    assert.ok(two?.detail.includes('"a.txt", "b.txt"'));
    assert.ok(two?.detail.includes("0 B"));
  });

  it("encurta caminhos longos pelo meio", () => {
    assert.equal(shortenPath("D:\\Projects\\helicon", 48), "D:\\Projects\\helicon");
    const short = shortenPath("D:\\Projects\\clients\\acme\\platform\\packages\\ui\\src", 32);
    assert.ok(short.startsWith("D:\\...\\"));
    assert.ok(short.endsWith("src"));
    assert.ok(short.length <= 34);
  });
});

describe("descrições de ferramenta", () => {
  it("descreve uma chamada bash real", () => {
    const description = describeTool(tool("bash", { command: "ls -la", description: "List workspace directory contents" }));
    assert.deepEqual(description, {
      kind: "shell",
      verb: "Executou",
      subject: "ls -la",
      mono: true,
      note: "List workspace directory contents",
    });
    assert.equal(describeTool(tool("bash", { command: "npm test" }, "inProgress")).verb, "Executando");
  });

  it("descreve perguntas, ferramentas de arquivo, buscas e ferramentas desconhecidas", () => {
    const question = describeTool(
      tool("request_user_input", { questions: [{ id: "q", header: "Color", question: "Which color?", options: [], selection: { mode: "single" } }] }),
    );
    assert.equal(question.kind, "question");
    assert.equal(question.subject, "Which color?");
    assert.equal(describeTool(tool("read_file", { path: "src/app.ts" })).subject, "src/app.ts");
    assert.equal(describeTool(tool("str_replace_editor", { file_path: "a.ts", old_string: "a", new_string: "b" })).verb, "Editou");
    const search = describeTool(tool("grep", { pattern: "TODO", path: "src" }));
    assert.equal(search.verb, "Buscou");
    assert.equal(search.note, "src");
    const unknown = describeTool(tool("frobnicate_widgets", { target: "x" }));
    assert.equal(unknown.kind, "generic");
    assert.equal(unknown.subject, "Frobnicate widgets");
    assert.equal(describeTool({ itemId: "i", kind: "toolCall", status: "completed", revision: 1, tool: "bash", args: "{not json" }).subject, "{not json");
  });

  it("extrai diffs revisáveis dos argumentos de edição", () => {
    const diff = extractDiff(tool("edit", { path: "a.ts", old_string: "const a = 1;\nconst b = 2;", new_string: "const a = 3;" }));
    assert.ok(diff && "hunks" in diff);
    assert.deepEqual(diffStats(diff), { added: 1, removed: 2 });
    const patch = extractDiff(tool("apply_patch", { input: "*** Begin Patch\n--- a.ts\n+++ a.ts\n@@\n-old\n+new\n+more" }));
    assert.ok(patch && "patch" in patch);
    assert.deepEqual(diffStats(patch), { added: 2, removed: 1 });
    assert.equal(extractDiff(tool("bash", { command: "ls" })), null);
  });

  it("prefere contagens do Muse quando a inferência dos argumentos discorda", () => {
    const item: MspItem = {
      ...tool("edit", { path: "a.ts", old_string: "uma linha", new_string: "outra linha" }),
      patchSummary: { files: 2, added: 7, removed: 3 },
      patchRef: { id: "patch-1", kind: "tool_patch", mediaType: "application/json" },
    };
    const fallback = extractDiff(item);
    assert.deepEqual(itemDiff(item), { source: "host", summary: item.patchSummary, ref: item.patchRef, fallback });
    assert.deepEqual(itemDiff({ ...item, patchRef: undefined }), { source: "host", summary: item.patchSummary, ref: null, fallback });
    assert.deepEqual(itemDiff({ ...item, patchRef: { id: "" } }), { source: "host", summary: item.patchSummary, ref: null, fallback });
    assert.deepEqual(itemDiff({ ...item, patchSummary: undefined }), { source: "inferred", diff: extractDiff(item) });
    assert.equal(itemDiff(tool("bash", { command: "ls" })), null);
  });

  it("mostra o patch JSON do host sem perder um formato ainda desconhecido", () => {
    const known = JSON.stringify({ files: [{ path: "a.ts", patch: "@@ -1 +1 @@\n-antigo\n+novo" }] });
    assert.deepEqual(hostPatchViews(known), [{ path: "a.ts", patch: "@@ -1 +1 @@\n-antigo\n+novo" }]);
    const future = JSON.stringify({ files: [{ path: "a.ts", chunks: [{ before: "antigo", after: "novo" }] }] });
    assert.deepEqual(hostPatchViews(future), []);
    assert.match(readableHostPatch(future), /"chunks": \[/);
    assert.deepEqual(hostPatchViews(JSON.stringify({ files: [{ path: "a.ts", patch: "@@\n-a\n+b" }, { path: "b.ts", chunks: [] }] })), []);
  });

  it("alinha as linhas de preenchimento de uma edição como contexto em vez de remover-e-readicionar", () => {
    const diff = extractDiff(
      tool("edit", {
        path: "ThreadView.tsx",
        old_string: ["const startedAt = 1;", "const now = 2;", "return (", "<header>", "<SidebarToggle />"].join("\n"),
        new_string: [
          "const startedAt = 1;",
          "const now = 2;",
          "const drag = 3;",
          "const noDrag = 4;",
          "return (",
          "<header now>",
          "<TrafficLightSpacer />",
          "<SidebarToggle />",
        ].join("\n"),
      }),
    );
    assert.ok(diff && "hunks" in diff);
    assert.deepEqual(
      diff.hunks[0]?.rows.map((row) => row.kind),
      ["same", "same", "add", "add", "same", "del", "add", "add", "same"],
    );
    assert.deepEqual(diffStats(diff), { added: 4, removed: 1 });
  });

  it("alinha mudanças de um lado só sem caçar sobreposição", () => {
    assert.deepEqual(
      alignLines([], ["a", "b"]).map((row) => row.kind),
      ["add", "add"],
    );
    assert.deepEqual(
      alignLines(["a", "b"], []).map((row) => row.kind),
      ["del", "del"],
    );
    assert.deepEqual(alignLines([], []), []);
    const written = extractDiff(tool("write", { path: "note.txt", content: "hello\n" }));
    assert.ok(written && "hunks" in written);
    assert.deepEqual(diffStats(written), { added: 2, removed: 0 });
  });

  it("tira o eco de edição do runtime mas mantém o resto que a saída trouxe", () => {
    const echo = ["edited", "changed lines: lines 39-43", "--- original", "+++ updated", "@@", "-old", "+new"].join("\n");
    assert.equal(withoutDiffEcho(echo), "");
    assert.equal(withoutDiffEcho(`${echo}\nnote: lint is unhappy`), "note: lint is unhappy");
    assert.equal(withoutDiffEcho(`${echo}\n${echo}`), "");
    assert.equal(withoutDiffEcho(echo.replace(/\n/g, "\r\n")), "");
    assert.equal(withoutDiffEcho("command not found: frobnicate"), null);
    assert.equal(withoutDiffEcho("edited\nchanged lines: lines 1-2"), null);
    assert.equal(withoutDiffEcho("edited\nchanged lines: lines 1-2\n--- original\n+++ updated"), null);
  });

  it("lê os argumentos de edição find/replace do runtime", () => {
    const diff = extractDiff(
      tool("edit_file", {
        find: 'import { useApp } from "../../app/context.js";\nimport { modelDisplayName } from "../../model/format.js";',
        path: "packages/ui/src/components/settings/SettingsPage.tsx",
        replace:
          'import { useApp } from "../../app/context.js";\nimport { useOverlayDragProps } from "../../app/frame.js";\nimport { modelDisplayName } from "../../model/format.js";',
      }),
    );
    assert.ok(diff && "hunks" in diff);
    assert.equal(diff.path, "packages/ui/src/components/settings/SettingsPage.tsx");
    assert.deepEqual(
      diff.hunks[0]?.rows.map((row) => row.kind),
      ["same", "add", "same"],
    );
    assert.deepEqual(diffStats(diff), { added: 1, removed: 0 });
  });

  it("monta o diff do eco do resultado quando os argumentos não o trazem", () => {
    const echo = [
      "edited",
      "changed lines: lines 4-5",
      "--- original",
      "+++ updated",
      "@@",
      "-import { useApp } from 1;",
      "-import { modelDisplayName } from 2;",
      "+import { useApp } from 1;",
      "+import { useOverlayDragProps } from 3;",
      "+import { modelDisplayName } from 2;",
    ].join("\n");
    const direct = diffFromEcho(echo, "SettingsPage.tsx");
    assert.ok(direct && "hunks" in direct);
    assert.deepEqual(
      direct.hunks[0]?.rows.map((row) => row.kind),
      ["same", "add", "same"],
    );
    assert.deepEqual(diffStats(direct), { added: 1, removed: 0 });
    assert.equal(diffFromEcho("command not found: frobnicate", null), null);
    // Uma forma de edição desconhecida ainda renderiza um diff, do eco em vez dos argumentos.
    const fellBack = extractDiff(tool("edit", { target: "a.ts", patch: null }, "completed", echo));
    assert.ok(fellBack && "hunks" in fellBack);
    assert.deepEqual(diffStats(fellBack), { added: 1, removed: 0 });
    // Mas um resultado que não ecoa nada ainda não rende diff.
    assert.equal(extractDiff(tool("edit", { target: "a.ts" }, "completed", "File updated successfully")), null);
  });

  it("achata um diff em linhas, marcando os vãos entre seus hunks", () => {
    const hunks = diffLines({
      path: "a.ts",
      hunks: [
        { rows: [{ kind: "same", text: "top" }] },
        { rows: [{ kind: "del", text: "old" }] },
      ],
    });
    assert.deepEqual(
      hunks.map((line) => [line.kind, line.text]),
      [
        ["ctx", "top"],
        ["meta", "..."],
        ["del", "old"],
      ],
    );
    const patch = diffLines({ path: "a.ts", patch: "@@\n-old\n+new\n context" });
    assert.deepEqual(
      patch.map((line) => [line.kind, line.text]),
      [
        ["meta", "@@"],
        ["del", "old"],
        ["add", "new"],
        ["ctx", "context"],
      ],
    );
  });

  it("junta os diffs de um arquivo num fluxo único contínuo de linhas, em ordem", () => {
    const first = extractDiff(tool("edit_file", { path: "a.ts", find: "one", replace: "ONE" }));
    const second = extractDiff(tool("edit_file", { path: "a.ts", find: "two", replace: "TWO" }));
    assert.ok(first && "hunks" in first && second && "hunks" in second);
    assert.deepEqual(
      mergeDiffLines([first, second]).map((line) => [line.kind, line.text]),
      [
        ["del", "one"],
        ["add", "ONE"],
        ["meta", "..."],
        ["del", "two"],
        ["add", "TWO"],
      ],
    );
    assert.deepEqual(mergeDiffLines([]), []);
  });
});

describe("aprovações e modelos", () => {
  it("descreve assuntos de aprovação em linguagem simples", () => {
    const base = { approvalId: "a", sessionId: "s", availableChoices: [], currentRequirementId: null };
    assert.deepEqual(describeApproval({ ...base, subject: { kind: "shell", command: "rm -rf dist" } }), {
      title: "Executar um comando shell",
      detail: "rm -rf dist",
      mono: true,
    });
    assert.equal(describeApproval({ ...base, subject: { kind: "fileAccess", access: "write", path: "/etc/hosts" } }).title, "Escrever em um arquivo");
    assert.equal(describeApproval({ ...base, subject: { kind: "network", host: "api.github.com", port: 443, protocol: "https" } }).detail, "https://api.github.com:443");
    assert.equal(describeApproval({ ...base, subject: { kind: "somethingNew", target: "x" } }).title, "Permitir something new");
  });

  it("mostra Nova conversa só para placeholder, sem traduzir título manual", () => {
    assert.equal(displayTitle({ title: "New thread", titleSource: "placeholder" }), "Nova conversa");
    assert.equal(displayTitle({ title: "New thread", titleSource: "user" }), "New thread");
    assert.equal(displayTitle({ title: "Meu nome", titleSource: "user" }), "Meu nome");
    assert.equal(displayTitle({ title: "Fix login", titleSource: "auto" }), "Fix login");
  });

  it("interpreta o catálogo real de modelos e marca níveis de colaborador", () => {
    const models = parseModelList(modelList);
    assert.equal(models.length, 4);
    const contributor = models.find((m) => m.modelId === "muse-spark-1.3-contributor");
    assert.equal(contributor?.contributor, true);
    assert.equal(contributor?.isDefault, true);
    assert.equal(models.find((m) => m.modelId === "muse-spark-1.3")?.contributor, false);
    assert.equal(modelDisplayName("muse-spark-1.3-contributor"), "muse-spark-1.3");
    assert.equal(contributorChoiceLabel("muse-spark-1.3-contributor"), "muse-spark-1.3 · Contribuidor");
    assert.equal(CONTRIBUTOR_LABEL, "Contribuidor");
    assert.match(CONTRIBUTOR_NOTICE, /melhoria do produto/);
    assert.doesNotMatch(CONTRIBUTOR_NOTICE, /Meta|preço|USD/i);
  });
});
