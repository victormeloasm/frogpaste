/* File objects are passed through unchanged: no canvas, re-encoding or network. */
(function (root) {
  "use strict";

  const extensionTypes = Object.freeze({
    png: "image/png", apng: "image/apng", jpg: "image/jpeg", jpeg: "image/jpeg",
    jfif: "image/jpeg", pjpeg: "image/jpeg", pjp: "image/jpeg", gif: "image/gif",
    webp: "image/webp", avif: "image/avif", bmp: "image/bmp", dib: "image/bmp",
    tif: "image/tiff", tiff: "image/tiff", svg: "image/svg+xml", svgz: "image/svg+xml",
    ico: "image/vnd.microsoft.icon", heic: "image/heic", heif: "image/heif",
    jxl: "image/jxl"
  });

  function extension(file) {
    const match = /\.([^.]+)$/.exec(file.name || "");
    return match ? match[1].toLowerCase() : "";
  }

  function mediaType(file) {
    let type = (file.type || "").split(";")[0].trim().toLowerCase();
    if (!type || type === "application/octet-stream") {
      type = extensionTypes[extension(file)] || type;
    }
    if (type === "image/jpg" || type === "image/pjpeg") return "image/jpeg";
    if (type === "image/x-png") return "image/png";
    return type;
  }

  function isImage(file) {
    return Boolean(file && mediaType(file).startsWith("image/"));
  }

  function readImages(clipboard) {
    if (!clipboard) return [];
    const files = Array.from(clipboard.files || []);
    if (files.length) return files.filter(isImage);
    // Read synchronously inside the paste handler, before clipboard access expires.
    const images = [];
    for (const item of Array.from(clipboard.items || [])) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (isImage(file)) images.push(file);
    }
    return images;
  }

  function accepts(file, accept) {
    const rules = (accept || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
    if (!rules.length || rules.includes("*/*")) return true;
    const type = mediaType(file);
    const name = (file.name || "").toLowerCase();
    return rules.some(rule => {
      if (rule.startsWith(".")) return name.endsWith(rule);
      if (rule.endsWith("/*")) return type.startsWith(rule.slice(0, -1));
      return type === rule;
    });
  }

  function validateFiles(input, images) {
    if (!images.length) return "O clipboard não contém um arquivo de imagem.";
    if (images.some(file => file.size === 0)) return "A imagem do clipboard está vazia.";
    if (!input.multiple && images.length > 1) return "Este campo aceita uma imagem por vez. Copie apenas uma.";
    if (!images.every(file => accepts(file, input.accept))) {
      return "O campo do LinkedIn não aceita o formato recebido. Formatos indicados: " + input.accept;
    }
    return "";
  }

  function validate(input, images) {
    if (input.disabled || input.matches(":disabled")) return "O campo de anexos está desativado.";
    // input.files is the last chooser selection, not the site's attachment list.
    // A populated input is reusable, exactly like selecting another local file.
    return validateFiles(input, images);
  }

  function uploadBatch(images, prefix) {
    return images.map((file, index) => {
      const fallbackExtension = Object.keys(extensionTypes).find(ext => extensionTypes[ext] === mediaType(file)) || "img";
      const originalName = (file.name || "image." + fallbackExtension).split(/[\\/]/).pop();
      const name = prefix + "-" + (index + 1) + "-" + originalName;
      // Different clipboard images frequently all have the name "image.png".
      // Give each attachment an independent name without changing its bytes.
      return new File([file], name, { type: file.type, lastModified: file.lastModified });
    });
  }

  const api = Object.freeze({ extension, mediaType, isImage, readImages, accepts, validateFiles, validate, uploadBatch });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.defineProperty(root, "FrogPasteCore", { value: api });
})(globalThis);
