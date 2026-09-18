"use strict";
// Runs the unchanged production scripts on local fixture DOMs in Firefox.
// Simulated file payloads are passed to the registered handler. Keyboard tests
// use real, trusted Ctrl+V events. The OS clipboard test probes availability.
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { test, before, after } = require("node:test");
const playwright = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, "playwright"))
  : require("playwright");
const root = path.resolve(__dirname, "..");
let browser;

before(async () => {
  // An opt-in option for disposable container tests, never a user-browser setting.
  const env = { ...process.env };
  if (process.env.FROGPASTE_CONTAINER_TEST === "1") env.MOZ_DISABLE_CONTENT_SANDBOX = "1";
  browser = await playwright.firefox.launch({ headless: true, env, firefoxUserPrefs: { "dom.events.testing.asyncClipboard": true } });
  console.log("Firefox " + browser.version() + " — local fixtures; LinkedIn traffic intercepted");
});
after(async () => { if (browser) await browser.close(); });

async function fixture(t, body) {
  const context = await browser.newContext();
  t.after(() => context.close());
  await context.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body>" + body + "</body></html>" }));
  const page = await context.newPage();
  await page.goto("https://www.linkedin.com/frogpaste-local-test");
  await page.evaluate(() => {
    window.deliveries = [];
    window.acceptedAttachments = [];
    document.addEventListener("change", event => {
      if (event.target.type !== "file") return;
      const files = Array.from(event.target.files);
      window.deliveries.push({ input: event.target.id, files });
      window.acceptedAttachments.push(...files);
    });
    const original = document.addEventListener;
    document.addEventListener = function (type, handler, options) {
      if (type === "paste") window.productionPasteHandler = handler;
      return original.call(this, type, handler, options);
    };
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  for (const source of manifest.content_scripts[0].js) await page.addScriptTag({ content: fs.readFileSync(path.join(root, source), "utf8") });
  await page.evaluate(() => { delete document.addEventListener; });
  return page;
}

const image = (name, type = "image/png", bytes = name) => ({ name, type, bytes });

async function paste(page, selector, specs) {
  return page.evaluate(({ selector, specs }) => {
    const files = specs.map(spec => new File([spec.bytes], spec.name, { type: spec.type }));
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    let prevented = false;
    window.productionPasteHandler({
      isTrusted: true,
      target: document.querySelector(selector),
      clipboardData: transfer,
      preventDefault() { prevented = true; },
      stopImmediatePropagation() {}
    });
    return prevented;
  }, { selector, specs });
}

async function deliveries(page) {
  return page.evaluate(() => window.deliveries.map(batch => ({ input: batch.input, names: batch.files.map(file => file.name), types: batch.files.map(file => file.type) })));
}

async function attachAll(page) {
  await page.locator('[data-frogpaste-attach]').click();
}

async function originalBatches(page) {
  return (await deliveries(page)).map(batch => batch.names.map(name => name.replace(/^frogpaste-\d+-\d+-\d+-/, "")));
}

test("three consecutive pastes reuse the populated input without blocking or resending old files", async t => {
  const page = await fixture(t, '<form class="msg-form"><textarea id="editor"></textarea><input id="upload" type="file" accept="image/*" multiple hidden></form>');
  for (const name of ["a.png", "b.png", "c.png"]) await paste(page, "#editor", [image(name)]);
  assert.deepEqual((await deliveries(page)).map(batch => batch.names), [["a.png"], ["b.png"], ["c.png"]]);
  assert.deepEqual(await page.evaluate(() => window.acceptedAttachments.map(file => file.name)), ["a.png", "b.png", "c.png"]);
});

test("post pastes collect all four files and submit them in a single change event", async t => {
  const page = await fixture(t, '<div role="dialog"><textarea id="editor"></textarea><input id="upload" type="file" accept="image/*" multiple hidden></div>');
  await paste(page, "#editor", [image("a.jpg", "image/jpeg", "jpeg bytes"), image("b.gif", "image/gif", "gif bytes")]);
  await paste(page, "#editor", [image("c.webp", "image/webp", "webp bytes"), image("d.avif", "image/avif", "avif bytes")]);
  assert.equal((await deliveries(page)).length, 0);
  assert.equal(await page.locator('[data-frogpaste-tray] img').count(), 4);
  await attachAll(page);
  assert.deepEqual(await originalBatches(page), [["a.jpg", "b.gif", "c.webp", "d.avif"]]);
  assert.deepEqual(await page.evaluate(() => Promise.all(window.acceptedAttachments.map(file => file.text()))), ["jpeg bytes", "gif bytes", "webp bytes", "avif bytes"]);
});

test("the post tray is inside the modal and cannot trigger an outside-click close", async t => {
  const page = await fixture(t, '<div id="backdrop"></div><div role="dialog" id="post-modal"><textarea id="editor"></textarea><input id="upload" type="file" accept="image/*" multiple hidden></div>');
  await page.addStyleTag({ content: '#backdrop{position:fixed;inset:0;z-index:10;background:#0008}#post-modal{position:fixed;z-index:20;inset:10% 20%;background:white;min-height:300px}' });
  await page.evaluate(() => {
    const modal = document.getElementById("post-modal");
    document.addEventListener("click", event => {
      if (!modal.contains(event.target)) modal.remove();
    });
  });
  await paste(page, "#editor", [image("a.png"), image("b.png")]);
  assert.equal(await page.locator('[data-frogpaste-tray]').evaluate(host => host.parentElement.id), "post-modal");
  await attachAll(page);
  assert.equal(await page.locator("#post-modal").count(), 1);
  assert.deepEqual(await originalBatches(page), [["a.png", "b.png"]]);
});

test("pasting an image without an open publication reports the required action", async t => {
  const page = await fixture(t, '<p id="feed">Feed</p>');
  await paste(page, "#feed", [image("a.png")]);
  assert.match(await page.locator("[data-frogpaste-notice]").getAttribute("data-frogpaste-message"), /Abra o editor de publicação/);
  assert.equal(await page.locator('[data-frogpaste-tray]').count(), 0);
});

test("pasting continues in the photo dialog after the text editor is replaced", async t => {
  const page = await fixture(t, '<div role="dialog" id="composer"><textarea id="editor"></textarea><input id="first" type="file" accept="image/*" multiple hidden></div>');
  await paste(page, "#editor", [image("a.png")]);
  await attachAll(page);
  await page.evaluate(() => {
    document.getElementById("composer").remove();
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.id = "preview";
    modal.innerHTML = '<h2>Editar imagens</h2><input id="more" type="file" accept="image/*" multiple hidden><button type="button">Adicionar imagens</button>';
    document.body.append(modal);
  });
  await paste(page, "body", [image("b.png"), image("c.png")]);
  await attachAll(page);
  assert.deepEqual(await originalBatches(page), [["a.png"], ["b.png", "c.png"]]);
});

test("images queued before a dynamic input appears accumulate", async t => {
  const page = await fixture(t, '<div class="share-box" id="composer"><textarea id="editor"></textarea><button type="button">Adicionar imagens</button></div>');
  await paste(page, "#editor", [image("a.png")]);
  await paste(page, "#editor", [image("b.png"), image("c.png")]);
  await attachAll(page);
  await page.evaluate(() => {
    const field = document.createElement("input");
    Object.assign(field, { id: "late", type: "file", accept: "image/*", multiple: true, hidden: true });
    document.getElementById("composer").append(field);
  });
  await page.waitForFunction(() => window.deliveries.length > 0);
  assert.deepEqual(await originalBatches(page), [["a.png", "b.png", "c.png"]]);
});

test("a temporarily disabled uploader receives the queued batch when enabled", async t => {
  const page = await fixture(t, '<form class="msg-form"><textarea id="editor"></textarea><input id="upload" type="file" accept="image/*" multiple disabled hidden></form>');
  await paste(page, "#editor", [image("a.png")]);
  await paste(page, "#editor", [image("b.png")]);
  await page.evaluate(() => { document.getElementById("upload").disabled = false; });
  await page.waitForFunction(() => window.deliveries.length > 0, null, { timeout: 2000 });
  assert.deepEqual((await deliveries(page)).map(batch => batch.names), [["a.png", "b.png"]]);
});

test("conversation and comment destinations remain separate", async t => {
  const page = await fixture(t, '<form class="msg-form"><textarea id="a"></textarea><input id="ua" type="file" accept="image/*" multiple hidden></form><div class="comments-comment-box"><div class="comments-comment-texteditor"><div id="b" contenteditable="true">Comment</div></div><input id="ub" type="file" accept="image/*" multiple hidden></div>');
  await paste(page, "#a", [image("a.png")]);
  await paste(page, "#b", [image("b.png"), image("c.png")]);
  await paste(page, "#a", [image("d.png")]);
  assert.deepEqual((await deliveries(page)).map(batch => batch.input), ["ua", "ub", "ua"]);
});

test("a single-file field never receives a truncated multi-image batch", async t => {
  const page = await fixture(t, '<form class="msg-form"><textarea id="editor"></textarea><input id="upload" type="file" accept="image/*" hidden></form>');
  await paste(page, "#editor", [image("a.png"), image("b.png")]);
  assert.equal((await deliveries(page)).length, 0);
  assert.equal(await page.locator("#upload").evaluate(field => field.multiple), false);
});

test("rejected formats preserve the previous selection and attachments", async t => {
  const page = await fixture(t, '<form class="msg-form"><textarea id="editor"></textarea><input id="upload" type="file" accept="image/png" multiple hidden></form>');
  await paste(page, "#editor", [image("a.png")]);
  await paste(page, "#editor", [image("b.gif", "image/gif")]);
  assert.deepEqual((await deliveries(page)).map(batch => batch.names), [["a.png"]]);
  assert.equal(await page.locator("#upload").evaluate(field => field.files[0].name), "a.png");
});

test("synthetic paste events cannot trigger an upload", async t => {
  const page = await fixture(t, '<form class="msg-form"><textarea id="editor"></textarea><input id="upload" type="file" accept="image/*" multiple hidden></form>');
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(["test"], "a.png", { type: "image/png" }));
    document.getElementById("editor").dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  });
  assert.equal((await deliveries(page)).length, 0);
});

test("body paste does not choose among two open dialogs", async t => {
  const page = await fixture(t, '<div role="dialog"><h2>Conversa A</h2><input id="a" type="file" accept="image/*" multiple hidden></div><div role="dialog"><h2>Conversa B</h2><input id="b" type="file" accept="image/*" multiple hidden></div>');
  await paste(page, "body", [image("a.png")]);
  assert.equal((await deliveries(page)).length, 0);
});

test("input replacement between pastes does not break reuse", async t => {
  const page = await fixture(t, '<form class="msg-form"><textarea id="editor"></textarea><input id="upload" type="file" accept="image/*" multiple hidden></form>');
  await paste(page, "#editor", [image("a.png")]);
  await page.evaluate(() => {
    const old = document.getElementById("upload");
    old.replaceWith(old.cloneNode());
  });
  await paste(page, "#editor", [image("b.png"), image("c.png")]);
  assert.deepEqual((await deliveries(page)).map(batch => batch.names), [["a.png"], ["b.png", "c.png"]]);
});

test("a multi-file image control is selected for a complete batch", async t => {
  const page = await fixture(t, '<div role="dialog"><textarea id="editor"></textarea><input id="single" type="file" accept="image/*" hidden><input id="multiple" type="file" accept="image/*" multiple hidden></div>');
  await paste(page, "#editor", [image("a.png"), image("b.png")]);
  await attachAll(page);
  assert.deepEqual((await deliveries(page)).map(batch => batch.input), ["multiple"]);
});

test("three images survive a one-shot uploader that closes after the first selection", async t => {
  const page = await fixture(t, '<div role="dialog" id="composer"><textarea id="editor"></textarea><input id="upload" type="file" accept="image/*" multiple hidden></div>');
  await page.evaluate(() => {
    document.getElementById("upload").addEventListener("change", event => {
      window.finalPostImages = Array.from(event.target.files);
      document.getElementById("composer").remove();
    });
  });
  for (const value of ["first", "second", "third"]) await paste(page, "#editor", [image("image.png", "image/png", value)]);
  assert.equal((await deliveries(page)).length, 0);
  await attachAll(page);
  assert.equal((await deliveries(page)).length, 1);
  assert.deepEqual(await page.evaluate(() => Promise.all(window.finalPostImages.map(file => file.text()))), ["first", "second", "third"]);
  const names = (await deliveries(page))[0].names;
  assert.equal(new Set(names).size, 3);
  assert.equal(await page.locator('[data-frogpaste-tray]').count(), 0);
});

test("switching away to copy another image does not discard the post tray", async t => {
  const page = await fixture(t, '<div role="dialog"><textarea id="editor"></textarea><input id="upload" type="file" accept="image/*" multiple hidden></div>');
  await paste(page, "#editor", [image("one.png")]);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await paste(page, "#editor", [image("two.png")]);
  await attachAll(page);
  assert.deepEqual(await originalBatches(page), [["one.png", "two.png"]]);
});

test("tray removal and cancellation control exactly which files get attached", async t => {
  const page = await fixture(t, '<div role="dialog"><textarea id="editor"></textarea><input id="upload" type="file" accept="image/*" multiple hidden></div>');
  await paste(page, "#editor", [image("one.png"), image("two.png"), image("three.png")]);
  await page.getByRole("button", { name: "Remover imagem 2", exact: true }).click();
  await attachAll(page);
  assert.deepEqual(await originalBatches(page), [["one.png", "three.png"]]);
  await paste(page, "#editor", [image("cancel.png")]);
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  assert.equal(await page.locator('[data-frogpaste-tray]').count(), 0);
  assert.equal((await deliveries(page)).length, 1);
});

test("a post field that rejects the complete batch retains the tray for correction", async t => {
  const page = await fixture(t, '<div role="dialog"><textarea id="editor"></textarea><input id="upload" type="file" accept="image/png" multiple hidden></div>');
  await paste(page, "#editor", [image("one.png"), image("two.gif", "image/gif")]);
  await attachAll(page);
  assert.equal((await deliveries(page)).length, 0);
  assert.equal(await page.locator('[data-frogpaste-tray] img').count(), 2);
  assert.match(await page.getByRole("status").innerText(), /não aceita o formato/);
});

test("a stale click callback cannot cancel a new pending batch", async t => {
  const page = await fixture(t, '<form class="msg-form" id="one"><textarea id="a"></textarea></form><form class="msg-form" id="two"><textarea id="b"></textarea></form>');
  await paste(page, "#a", [image("old.png")]);
  await page.evaluate(() => {
    const oldField = document.createElement("input");
    Object.assign(oldField, { type: "file", accept: "image/*", multiple: true, hidden: true });
    document.getElementById("one").append(oldField);
    oldField.click(); // Schedules attachment on the pending job's microtask.
    const data = new DataTransfer();
    data.items.add(new File(["new"], "new.png", { type: "image/png" }));
    window.productionPasteHandler({ isTrusted: true, target: document.getElementById("b"), clipboardData: data, preventDefault() {}, stopImmediatePropagation() {} });
  });
  await page.evaluate(() => {
    const field = document.createElement("input");
    Object.assign(field, { id: "new", type: "file", accept: "image/*", multiple: true, hidden: true });
    document.getElementById("two").append(field);
  });
  await page.waitForFunction(() => window.deliveries.length > 0, null, { timeout: 2000 });
  assert.deepEqual((await deliveries(page)).map(batch => batch.names), [["new.png"]]);
});

test("trusted Ctrl+V events deliver repeated batches with a fixture clipboard payload", async t => {
  const page = await fixture(t, '<form class="msg-form"><textarea id="editor"></textarea><input id="upload" type="file" accept="image/*" multiple hidden></form>');
  await page.evaluate(() => {
    window.nativePasteCount = 0;
    window.addEventListener("paste", event => {
      if (!event.isTrusted) throw new Error("Expected Firefox's native paste event");
      const data = new DataTransfer();
      for (let i = 0; i < 2; i++) data.items.add(new File(["fixture bytes"], "batch-" + window.nativePasteCount + "-" + i + ".png", { type: "image/png" }));
      // Replace only the fixture payload, not the real event or isTrusted flag.
      Object.defineProperty(event, "clipboardData", { value: data });
      window.nativePasteCount++;
    }, true);
  });
  await page.locator("#editor").focus();
  for (let count = 1; count <= 3; count++) {
    await page.keyboard.press("Control+v");
    await page.waitForFunction(expected => window.deliveries.length === expected, count, { timeout: 2000 });
  }
  assert.deepEqual((await deliveries(page)).map(batch => batch.names), [["batch-0-0.png", "batch-0-1.png"], ["batch-1-0.png", "batch-1-1.png"], ["batch-2-0.png", "batch-2-1.png"]]);
});

test("OS image clipboard supports repeated Ctrl+V and native text paste when available", async t => {
  const page = await fixture(t, '<form class="msg-form"><textarea id="editor"></textarea><input id="upload" type="file" accept="image/*" multiple hidden></form>');
  await page.evaluate(async () => {
    window.trustedPastes = [];
    window.addEventListener("paste", event => {
      window.trustedPastes.push(event.isTrusted);
    }, true);
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    canvas.getContext("2d").fillRect(0, 0, 2, 2);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  });
  const available = await page.evaluate(async () => (await navigator.clipboard.read()).some(item => item.types.includes("image/png")));
  if (!available) {
    t.skip("This headless system does not retain images in the OS clipboard; file-payload and keyboard tests run separately.");
    return;
  }
  await page.locator("#editor").focus();
  for (let index = 1; index <= 3; index++) {
    await page.keyboard.press("Control+v");
    await page.waitForFunction(count => window.deliveries.length === count, index, { timeout: 3000 });
  }
  assert.deepEqual((await deliveries(page)).map(batch => batch.types), [["image/png"], ["image/png"], ["image/png"]]);
  await page.evaluate(() => navigator.clipboard.writeText("Texto continua normal"));
  await page.keyboard.press("Control+v");
  assert.equal(await page.locator("#editor").inputValue(), "Texto continua normal");
  assert.deepEqual(await page.evaluate(() => window.trustedPastes), [true, true, true, true]);
});
