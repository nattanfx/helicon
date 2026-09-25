import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ControllerProvider } from "../src/app/context.js";
import { HostPatchDetails } from "../src/components/thread/items.js";
import { loadHostPatch } from "../src/model/patch.js";
import type { HeliconController } from "../src/model/controller.js";
import type { OutputRange } from "../src/types.js";

function page(content: string, offsetBytes: number, byteLen: number, eof: boolean): OutputRange {
  return { content, offsetBytes, byteLen, eof, encoding: "utf8", mediaType: "application/json" };
}

describe("patch armazenado no Muse", () => {
  it("lê todas as páginas avançando pelos bytes servidos, inclusive texto UTF-8", async () => {
    const offsets: number[] = [];
    const read = async (_session: string, _item: string, _ref: string, offset: number) => {
      offsets.push(offset);
      return offset === 0 ? page('{"texto":"á', 0, 12, false) : page('"}', 12, 2, true);
    };
    assert.equal(await loadHostPatch(read, "s", "i", "patch"), '{"texto":"á"}');
    assert.deepEqual(offsets, [0, 12]);
  });

  it("interrompe uma página sem avanço e um patch maior que o limite", async () => {
    await assert.rejects(
      loadHostPatch(async () => page("", 0, 0, false), "s", "i", "patch"),
      /não pôde ser lido/,
    );
    await assert.rejects(
      loadHostPatch(async () => page("abc", 0, 3, false), "s", "i", "patch", 2),
      /excede o limite/,
    );
  });

  it("mostra a prévia inferida e a limitação quando as contagens chegam sem patchRef", () => {
    const fallback = { path: "arquivo.txt", patch: "@@ -1 +1 @@\n-antigo\n+novo" };
    const html = renderToStaticMarkup(createElement(
      ControllerProvider,
      { controller: {} as HeliconController, children: createElement(HostPatchDetails, { sessionId: "s", itemId: "i", patchRef: null, fallback }) },
    ));
    assert.match(html, /sem uma referência de patch consultável/);
    assert.match(html, /Prévia reconstruída da edição/);
    assert.match(html, /antigo/);
    assert.match(html, /novo/);
    assert.doesNotMatch(html, /Carregar diff do Muse/);
  });

  it("explica quando não há patchRef nem dados para reconstruir o diff", () => {
    const html = renderToStaticMarkup(createElement(
      ControllerProvider,
      { controller: {} as HeliconController, children: createElement(HostPatchDetails, { sessionId: "s", itemId: "i", patchRef: null, fallback: null }) },
    ));
    assert.match(html, /sem uma referência de patch consultável/);
    assert.doesNotMatch(html, /Prévia reconstruída/);
  });

  it("prioriza o patch armazenado quando a referência está disponível", () => {
    const html = renderToStaticMarkup(createElement(
      ControllerProvider,
      {
        controller: {} as HeliconController,
        children: createElement(HostPatchDetails, {
          sessionId: "s",
          itemId: "i",
          patchRef: { id: "patch-1" },
          fallback: { path: "arquivo.txt", patch: "@@ -1 +1 @@\n-antigo\n+novo" },
        }),
      },
    ));
    assert.match(html, /Carregar diff do Muse/);
    assert.doesNotMatch(html, /Prévia reconstruída/);
  });
});
