import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadHostPatch } from "../src/model/patch.js";
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
});
