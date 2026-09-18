"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../core.js");
const file = (name, type, data = "image-bytes") => new File([data], name, { type });
const field = (accept = "image/*", multiple = false) => ({ accept, multiple, disabled: false, files: [], matches: () => false });

test("image MIME types are not restricted to screenshots or a format whitelist", () => {
  for (const type of ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/tiff", "image/heic", "image/future-format"]) {
    const original = file("clipboard.bin", type);
    const images = core.readImages({ files: [original] });
    assert.equal(images[0], original);
    assert.equal(images[0].type, type);
    assert.equal(core.validate(field(), images), "");
  }
});

test("FileList is authoritative; items do not duplicate the same image", () => {
  const original = file("photo.png", "image/png");
  const images = core.readImages({ files: [original], items: [{ kind: "file", getAsFile() { throw new Error("duplicate access"); } }] });
  assert.deepEqual(images, [original]);
});

test("items-only clipboard retains multiple original files", () => {
  const a = file("a.jpg", "image/jpeg"), b = file("b.gif", "image/gif");
  const images = core.readImages({ items: [{ kind: "string" }, { kind: "file", getAsFile: () => a }, { kind: "file", getAsFile: () => b }] });
  assert.deepEqual(images, [a, b]);
});

test("empty MIME image files are recognized by extension without changing type", () => {
  const original = file("PHOTO.JPEG", "");
  assert.equal(core.readImages({ files: [original] })[0], original);
  assert.equal(original.type, "");
  assert.equal(core.accepts(original, "image/jpeg"), true);
});

test("ordinary text, HTML and non-images are left alone", () => {
  assert.deepEqual(core.readImages({ files: [file("document.pdf", "application/pdf")] }), []);
  assert.deepEqual(core.readImages({ items: [{ kind: "string", type: "text/html" }] }), []);
  assert.deepEqual(core.readImages(null), []);
  assert.equal(core.isImage(file("not-an-image.png", "application/pdf")), false);
});

test("accept supports extensions, MIME types, wildcards and case", () => {
  const original = file("hello.JPG", "image/jpeg");
  for (const rule of ["", "*/*", "image/*", "IMAGE/JPEG", ".png, .JPG"]) assert.equal(core.accepts(original, rule), true);
  for (const rule of ["image/png", ".gif", "video/*"]) assert.equal(core.accepts(original, rule), false);
});

test("unsupported formats are rejected without conversion or partial batches", () => {
  const images = [file("a.png", "image/png"), file("b.webp", "image/webp")];
  assert.match(core.validate(field("image/png", true), images), /formato/);
  assert.equal(images[1].type, "image/webp");
});

test("single-file inputs do not silently drop images", () => {
  const images = [file("a.png", "image/png"), file("b.png", "image/png")];
  assert.match(core.validate(field(), images), /uma imagem por vez/);
  assert.equal(core.validate(field("image/*", true), images), "");
});

test("disabled fields and empty files are rejected", () => {
  const images = [file("a.png", "image/png")];
  assert.match(core.validate({ ...field(), disabled: true }, images), /desativado/);
  assert.match(core.validate({ ...field(), matches: () => true }, images), /desativado/);
  assert.match(core.validate(field(), [file("a.png", "image/png", "")]), /vazia/);
});

test("the previous chooser selection does not block the next image or batch", () => {
  const previous = [file("old.png", "image/png")];
  const fresh = [file("new.jpg", "image/jpeg"), file("new.gif", "image/gif")];
  const input = { ...field("image/*", true), files: previous };
  assert.equal(core.validate(input, fresh), "");
  assert.deepEqual(input.files, previous);
  assert.equal(core.validate({ ...input, multiple: false }, [fresh[0]]), "");
});

test("equal clipboard names receive distinct upload names while bytes and MIME remain intact", async () => {
  const input = [file("image.png", "image/png", "first bytes"), file("image.png", "image/png", "second bytes")];
  const batch = core.uploadBatch(input, "frogpaste-test");
  assert.notEqual(batch[0].name, batch[1].name);
  assert.deepEqual(batch.map(item => item.type), ["image/png", "image/png"]);
  assert.deepEqual(await Promise.all(batch.map(item => item.text())), ["first bytes", "second bytes"]);
  assert.deepEqual(input.map(item => item.name), ["image.png", "image.png"]);
});
