(function () {
  "use strict";

  function create(onAttach, onCancel, options = {}) {
    let serial = 0;
    let items = [];
    let busy = false;
    const host = document.createElement("div");
    host.setAttribute("data-frogpaste-tray", "");
    const mount = options.mount instanceof Element && options.mount.isConnected
      ? options.mount
      : (document.body || document.documentElement);
    const position = "position:fixed;right:20px;bottom:20px;";
    host.style.cssText = "all:initial;" + position + "z-index:2147483647!important;pointer-events:auto!important;user-select:none;width:min(440px,calc(100vw - 40px));";
    // LinkedIn closes a composer when a click bubbles outside its dialog. The
    // tray lives inside the dialog and consumes pointer events at its boundary.
    for (const eventName of ["pointerdown", "mousedown", "click", "dblclick", "focusin"]) {
      // Bubble phase is intentional: a button inside the shadow tree must run
      // its own handler before the event is stopped at the host boundary.
      host.addEventListener(eventName, event => event.stopPropagation());
    }
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      *{box-sizing:border-box}section{background:#211b35;color:#fff;border:1px solid #9d8acb;border-radius:14px;box-shadow:0 8px 36px #0005;padding:16px;font:14px/1.45 system-ui,sans-serif}
      h2{font-size:17px;margin:0 0 8px}p{margin:8px 0}ul{display:flex;gap:9px;flex-wrap:wrap;list-style:none;margin:12px 0;padding:0;max-height:240px;overflow:auto}
      li{position:relative;width:84px;height:78px;background:#392e53;border-radius:8px}img{width:100%;height:100%;object-fit:contain;border-radius:8px}
      button{font:inherit;cursor:pointer;border:1px solid #ab97d0;border-radius:7px;padding:8px 12px;background:transparent;color:inherit}
      button:focus-visible{outline:3px solid #72efb0;outline-offset:2px}button:disabled{opacity:.55;cursor:wait}
      li button{position:absolute;top:2px;right:2px;width:24px;height:24px;border:0;border-radius:50%;padding:0;background:#17111edb;color:#fff;font-size:18px}
      footer{display:flex;gap:10px;align-items:center;flex-wrap:wrap}footer button:first-child{background:#8ff0b6;border-color:#8ff0b6;color:#162c20;font-weight:650}
      small{display:block;margin-top:10px;color:#d6cde4}
    `;
    const section = document.createElement("section");
    section.setAttribute("aria-label", "Imagens para a publicação");
    const title = document.createElement("h2");
    title.textContent = "🐸 Imagens da publicação";
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    status.textContent = "Cole suas imagens aqui ou no editor. Quando terminar, clique em Anexar todas.";
    const list = document.createElement("ul");
    const footer = document.createElement("footer");
    const submit = document.createElement("button");
    submit.type = "button";
    submit.setAttribute("data-frogpaste-attach", "");
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancelar";
    const hint = document.createElement("small");
    hint.textContent = "Você pode mudar de aba para copiar outras imagens. Nada é publicado por este botão.";
    footer.append(submit, cancel);
    section.append(title, status, list, footer, hint);
    shadow.append(style, section);
    mount.append(host);

    function render() {
      list.replaceChildren();
      for (const item of items) {
        const li = document.createElement("li");
        const img = document.createElement("img");
        img.src = item.url;
        img.alt = item.file.name || "Imagem do clipboard";
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "×";
        remove.setAttribute("aria-label", "Remover imagem " + item.id);
        remove.disabled = busy;
        remove.addEventListener("click", () => {
          if (busy) return;
          URL.revokeObjectURL(item.url);
          items = items.filter(other => other !== item);
          if (!items.length) onCancel();
          else render();
        });
        li.append(img, remove);
        list.append(li);
      }
      submit.textContent = "Anexar todas (" + items.length + ")";
      submit.disabled = busy || !items.length;
    }

    submit.addEventListener("click", () => {
      if (!busy && items.length) onAttach(items.map(item => item.file));
    });
    cancel.addEventListener("click", onCancel);
    render();
    return {
      host,
      add(files) {
        for (const file of files) items.push({ id: ++serial, file, url: URL.createObjectURL(file) });
        status.textContent = items.length + (items.length === 1 ? " imagem na bandeja. " : " imagens na bandeja. ") + "Cole outras ou clique em Anexar todas.";
        render();
      },
      setBusy(value) { busy = value; render(); },
      setStatus(message) { status.textContent = message; },
      destroy() {
        for (const item of items) URL.revokeObjectURL(item.url);
        items = [];
        host.remove();
      }
    };
  }

  Object.defineProperty(globalThis, "FrogPasteTray", { value: Object.freeze({ create }) });
})();
