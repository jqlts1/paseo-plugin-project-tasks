import assert from "node:assert/strict";
import test from "node:test";
import { prepareComposerSubmission } from "./composer-draft";

const png = { mime: "image/png", dataBase64: "cG5n" } as const;
const jpg = { mime: "image/jpeg", dataBase64: "anBn" } as const;
const webp = { mime: "image/webp", dataBase64: "d2VicA==" } as const;

test("rejects a completely empty draft", () => {
  assert.equal(prepareComposerSubmission({ title: "  ", body: "\n", images: [] }), null);
});

test("uses the body as the create payload when title is empty", () => {
  assert.deepEqual(
    prepareComposerSubmission({ title: "", body: "第一行灵感\n后续 prompt", images: [] }),
    { create: { body: "第一行灵感\n后续 prompt" }, images: [] },
  );
});

test("accepts image-only drafts and keeps at most three valid images", () => {
  assert.deepEqual(
    prepareComposerSubmission({
      title: "",
      body: "",
      images: [png, jpg, webp, png],
    }),
    { create: {}, images: [png, jpg, webp] },
  );
});

test("trims title but preserves body whitespace", () => {
  assert.deepEqual(
    prepareComposerSubmission({ title: "  标题  ", body: "  保留 prompt 格式\n", images: [] }),
    { create: { title: "标题", body: "  保留 prompt 格式\n" }, images: [] },
  );
});
