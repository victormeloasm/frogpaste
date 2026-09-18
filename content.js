(function () {
  "use strict";

  const core = globalThis.FrogPasteCore;
  const EDITOR = '[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], textarea';
  const DIALOG = '.artdeco-modal, [role="dialog"], dialog';
  // LinkedIn changes its markup. All routing is restricted to the active composer.
  const MAX_PENDING_MS = 45000;
  let pending = null;
  let noticeHost = null;
  let noticeTimer = 0;
  let staged = null;
  let batchSerial = 0;

  function visible(element) {
    if (!element || !element.isConnected || element.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  function editorFrom(target) {
    if (!(target instanceof Element)) return null;
    const editor = target.closest(EDITOR);
    if (!editor || editor.closest('[contenteditable="false"]') || editor.disabled || editor.readOnly) return null;
    return visible(editor) ? editor : null;
  }

  function scopeFrom(editor) {
    // Use the nearest conversation/comment, never a document-wide upload search.
    const comment = editor.closest(".comments-comment-box, .comment-box") || editor.closest(".comments-comment-texteditor");
    if (comment) return comment;
    const message = editor.closest(".msg-form") || editor.closest(".msg-overlay-conversation-bubble, .msg-conversation-card, .msg-thread");
    if (message) return message;
    const dialog = editor.closest(DIALOG) || editor.closest(".share-box, .share-creation-state");
    if (dialog) return dialog;
    // Fallback for updated markup: a nearby form with only this editable field.
    const form = editor.closest("form");
    if (form && Array.from(form.querySelectorAll(EDITOR)).filter(visible).length === 1) return form;
    return null;
  }

  function hasUploadControls(scope) {
    if (scope.querySelector('input[type="file"]')) return true;
    return Array.from(scope.querySelectorAll('button, [role="button"], label'))
      .some(button => attachmentButton(button, scope));
  }

  function pasteContext(target) {
    const element = target instanceof Element ? target : document.activeElement;
    if (!element) return null;
    if (staged && staged.tray.host.contains(element)) return { scope: staged.scope, editor: null };
    // Do not hijack the search bar, a name field, or another text input.
    if (element.closest('input:not([type="file"]):not([type="button"]):not([type="submit"])')) return null;
    const editor = editorFrom(element);
    if (editor) {
      const scope = scopeFrom(editor);
      return scope && visible(scope) ? { scope, editor } : null;
    }
    const direct = scopeFrom(element);
    if (direct && visible(direct) && hasUploadControls(direct)) return { scope: direct, editor: null };
    // LinkedIn can replace the composer with a photo preview, leaving focus on
    // the document body. Continue there only when one upload dialog is open.
    if (element !== document.body && element !== document.documentElement) return null;
    const dialogs = Array.from(document.querySelectorAll(DIALOG)).filter(visible);
    const roots = dialogs.filter(dialog => !dialogs.some(other => other !== dialog && other.contains(dialog)));
    if (roots.length !== 1 || !hasUploadControls(roots[0])) return null;
    return { scope: roots[0], editor: null };
  }

  function isPost(scope) {
    return scope.matches(DIALOG + ", .share-box, .share-creation-state") &&
      !scope.closest(".msg-form, .msg-overlay-conversation-bubble, .msg-conversation-card, .msg-thread, .comments-comment-box, .comments-comment-texteditor, .comment-box");
  }

  function composerMount(scope) {
    const dialog = scope.closest(DIALOG);
    return dialog && dialog.isConnected ? dialog : scope;
  }

  function clearStaged(expected = staged) {
    if (!expected || staged !== expected) return;
    if (pending && pending.staged === expected) clearPending();
    staged = null;
    expected.observer.disconnect();
    expected.tray.destroy();
  }

  function stageImages(scope, images) {
    clearPending();
    if (staged && (staged.scope !== scope || staged.url !== location.href)) clearStaged();
    if (!staged) {
      const record = { scope, url: location.href, tray: null, observer: null };
      record.mount = composerMount(scope);
      record.tray = globalThis.FrogPasteTray.create(files => submitStaged(record, files), () => clearStaged(record), { mount: record.mount });
      record.observer = new MutationObserver(() => {
        if (staged !== record) return;
        if (!scope.isConnected || location.href !== record.url || (!document.hidden && !visible(scope))) clearStaged(record);
      });
      record.observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "aria-hidden", "class", "style"] });
      staged = record;
    }
    staged.tray.add(images);
  }

  function submitStaged(record, files) {
    if (staged !== record) return;
    if (!visible(record.scope) || record.url !== location.href) {
      clearStaged(record);
      notice("A publicação foi fechada. Abra o editor e cole novamente.");
      return;
    }
    const batch = core.uploadBatch(files, "frogpaste-" + Date.now() + "-" + (++batchSerial));
    const match = candidates(record.scope, batch);
    if (match.best) {
      if (handoff(match.best, batch)) clearStaged(record);
      else record.tray.setStatus("Não consegui entregar o lote. As imagens continuam na bandeja.");
      return;
    }
    if (match.inputs.length === 1 && !match.supported.length) {
      record.tray.setStatus(core.validateFiles(match.inputs[0], batch));
      return;
    }
    beginPending(record.scope, null, batch, record);
    record.tray.setBusy(true);
    record.tray.setStatus("Lote pronto. Clique em Adicionar imagem no LinkedIn para abrir o campo de anexos.");
  }

  function notice(message, persistent = false) {
    clearTimeout(noticeTimer);
    if (noticeHost) noticeHost.remove();
    const host = document.createElement("div");
    host.setAttribute("data-frogpaste-notice", "");
    host.setAttribute("data-frogpaste-message", message);
    host.style.cssText = "all:initial;position:fixed;bottom:22px;left:22px;z-index:2147483647;max-width:min(460px,calc(100vw - 44px));";
    const shadow = host.attachShadow({ mode: "closed" });
    const box = document.createElement("div");
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    box.style.cssText = "font:14px/1.5 system-ui,sans-serif;background:#222038;color:#fff;padding:14px 42px 14px 16px;border:1px solid #8a7ab7;border-radius:12px;box-shadow:0 6px 28px #0004;";
    const text = document.createElement("span");
    text.textContent = "🐸 FrogPaste: " + message;
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "Fechar aviso e cancelar imagem pendente");
    close.style.cssText = "position:absolute;right:9px;top:8px;font:22px system-ui;color:inherit;background:none;border:0;cursor:pointer;";
    close.addEventListener("click", () => { clearPending(); host.remove(); });
    box.append(text, close);
    shadow.append(box);
    (document.body || document.documentElement).append(host);
    noticeHost = host;
    noticeTimer = setTimeout(() => host.remove(), persistent ? MAX_PENDING_MS : 9000);
  }

  function clearPending() {
    if (!pending) return;
    if (pending.staged && staged === pending.staged) staged.tray.setBusy(false);
    clearTimeout(pending.timer);
    pending.observer.disconnect();
    pending.images = [];
    pending = null;
    clearTimeout(noticeTimer);
    if (noticeHost) noticeHost.remove();
  }

  function current(job) {
    return pending === job && visible(job.scope) && location.href === job.url;
  }

  function candidates(scope, images) {
    const inputs = Array.from(scope.querySelectorAll('input[type="file"]'));
    const compatible = inputs.filter(input => !core.validate(input, images));
    const supported = inputs.filter(input => !core.validateFiles(input, images));
    // Prefer image-specific inputs over generic document attachments.
    const specific = compatible.filter(input => input.accept.trim() && input.accept.trim() !== "*/*");
    const multiple = specific.filter(input => input.multiple);
    return { inputs, supported, best: multiple.length === 1 ? multiple[0] : specific.length === 1 ? specific[0] : compatible.length === 1 ? compatible[0] : null };
  }

  function handoff(input, images) {
    const error = core.validate(input, images);
    if (error) { notice(error); return false; }
    try {
      const transfer = new DataTransfer();
      for (const file of images) transfer.items.add(file);
      // Send only the NEW batch. Merging input.files would re-upload the previous
      // batch because LinkedIn keeps the accepted attachments in its own state.
      input.files = transfer.files;
      if (input.files.length !== images.length) throw new Error("A lista de arquivos não foi aplicada.");
      console.info("FrogPaste 0.4.0 — lote entregue ao seletor", {
        images: images.length, selectedFiles: input.files.length,
        multiple: input.multiple, accept: input.accept
      });
      // 'change' is the upload event used by file selectors; do not also fire an
      // 'input' event, which can cause duplicate uploads in some applications.
      input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      // Do not clear the input after dispatch: an asynchronous upload handler may
      // still read it. The next paste replaces the chooser selection naturally.
      notice(images.length === 1 ? "1 imagem entregue ao campo de anexos. Confira a prévia do LinkedIn." : images.length + " imagens entregues ao campo de anexos. Confira a prévia do LinkedIn.");
      return true;
    } catch (error) {
      console.warn("FrogPaste: não foi possível preencher o anexo.", error.name);
      notice("Não consegui preencher este anexo. A compatibilidade com este campo precisa ser ajustada.");
      return false;
    }
  }

  function attachPending(input, job) {
    if (pending !== job) return; // An old callback must not cancel a newer paste.
    if (!current(job)) { clearPending(); return; }
    const images = job.images;
    clearPending();
    const success = handoff(input, images);
    if (success && job.staged) clearStaged(job.staged);
  }

  function attachmentButton(target, scope) {
    if (!(target instanceof Element)) return null;
    const button = target.closest('button, [role="button"], label');
    if (!button || !scope.contains(button) || button.disabled || !visible(button)) return null;
    if (button.tagName === "BUTTON" && button.type === "submit") return null;
    if (button.tagName === "LABEL" && button.control && button.control.type === "file") return button;
    const label = [button.getAttribute("aria-label"), button.getAttribute("title"), button.textContent]
      .filter(Boolean).join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (/\b(remove|delete|remover|excluir|apagar|publicar|postar|enviar|send|publish)\b/.test(label)) return null;
    return /\b(photo|photos|image|images|picture|pictures|media|attach|attachment|foto|fotos|imagem|imagens|midia|anexar|anexo)\b/.test(label) ? button : null;
  }

  function beginPending(scope, editor, images, stagedRecord = null) {
    clearPending();
    const job = { scope, editor, images, staged: stagedRecord, url: location.href, timer: 0, observer: null, armedUntil: 0 };
    job.observer = new MutationObserver(() => {
      if (pending !== job) return;
      if (!current(job)) { clearPending(); return; }
      const match = candidates(scope, images);
      if (match.best) attachPending(match.best, job);
    });
    pending = job;
    job.observer.observe(scope, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "accept", "multiple", "type"] });
    job.timer = setTimeout(() => { clearPending(); notice("A imagem pendente expirou. Cole novamente para tentar."); }, MAX_PENDING_MS);
    // Delayed native file controls are populated when the user presses the
    // image/attachment button. Do not guess among unrelated composers.
    notice(images.length + " imagem(ns) aguardando o campo de anexos. Você pode colar mais. Se necessário, clique em Adicionar imagem. Esc cancela.", true);
  }

  function onPaste(event) {
    if (!event.isTrusted) return;
    const images = core.readImages(event.clipboardData);
    if (!images.length) { clearPending(); return; } // Leave text/HTML paste native.
    const context = pasteContext(event.target);
    if (!context) {
      clearPending();
      notice(editorFrom(event.target)
        ? "Abra a janela de publicação do LinkedIn e cole a imagem dentro dela."
        : "Abra o editor de publicação do LinkedIn antes de colar a imagem.");
      return;
    }
    const { scope, editor } = context;
    if (isPost(scope)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      stageImages(scope, images);
      return;
    }
    const previous = pending && current(pending) && pending.scope === scope ? pending.images : [];
    const batch = previous.concat(images);
    const match = candidates(scope, batch);
    if (match.inputs.length === 1 && !match.supported.length) {
      // Reject the new paste as a whole; do not discard previously queued images.
      if (!previous.length) clearPending();
      notice(core.validateFiles(match.inputs[0], batch));
      return;
    }
    // Only take ownership after locating a composer and an image payload.
    event.preventDefault();
    event.stopImmediatePropagation();
    clearPending();
    if (match.best) handoff(match.best, batch);
    else beginPending(scope, editor, batch);
  }

  function onClick(event) {
    const job = pending;
    if (!job) return;
    if (!current(job)) { clearPending(); return; }
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (event.isTrusted && attachmentButton(target, job.scope)) job.armedUntil = Date.now() + 1500;
    if (!(target instanceof HTMLInputElement) || target.type !== "file") return;
    if (!job.scope.contains(target) && Date.now() > job.armedUntil) return;
    if (core.validate(target, job.images)) { notice(core.validate(target, job.images)); return; }
    event.preventDefault();
    event.stopImmediatePropagation();
    // Let the caller's button handler return before dispatching 'change'.
    queueMicrotask(() => attachPending(target, job));
  }

  document.addEventListener("paste", onPaste, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("focusin", event => {
    if (pending) {
      const editor = editorFrom(event.target);
      if (editor && !pending.scope.contains(editor)) clearPending();
    }
  }, true);
  document.addEventListener("keydown", event => {
    if (event.isTrusted && event.key === "Escape" && (pending || staged)) {
      clearPending();
      clearStaged();
      if (noticeHost) noticeHost.remove();
    }
  }, true);
  addEventListener("pagehide", () => { clearPending(); clearStaged(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) clearPending(); });
})();
