# FrogPaste for LinkedIn

> Paste images directly from your clipboard into LinkedIn — without saving them first.

FrogPaste is a Firefox WebExtension that makes image attachments in LinkedIn less frustrating. It handles user-initiated image pastes and, in the post composer, lets you collect multiple images in a small review tray before handing them to LinkedIn's own upload field.

**Current version:** 0.4.0  
**Platform:** Firefox  
**Format:** Manifest V3  
**Status:** Experimental

> [!WARNING]
> The local test suite passes, but version 0.4.0 has not yet been validated in an authenticated LinkedIn session. LinkedIn can change its markup and upload flow at any time, so real-site compatibility is not guaranteed.

## Features

- Paste screenshots and other clipboard images directly into LinkedIn.
- Collect multiple images from successive pastes in a publication tray.
- Switch tabs or applications while building the batch.
- Review thumbnails and remove individual images before attaching them.
- Attach the complete batch with one click.
- Keep normal text and HTML pastes untouched.
- Work with image MIME types received from the clipboard without forced PNG conversion.
- Leave the final upload and publication action under the user's control.

In LinkedIn messages and comments, the extension keeps the direct single-image handoff used by earlier versions. The multi-image tray is focused on the publication composer, where LinkedIn normally keeps only the first pasted image.

## How to use

1. Open LinkedIn and start a new publication.
2. Copy an image from any application.
3. Focus the publication editor and press Ctrl+V.
4. Copy and paste additional images. You can switch tabs between pastes.
5. Review the FrogPaste tray. Remove unwanted images with × if necessary.
6. Click **Anexar todas (N)**.
7. Check the thumbnails in LinkedIn and publish manually when ready.

The button does not publish the post. It only passes the selected batch to LinkedIn's file input.

If LinkedIn has not created its file input yet, FrogPaste keeps the batch ready and asks you to click LinkedIn's **Adicionar imagem** button. If no publication editor is open, the extension shows a notice instead of hijacking an unrelated text field.

Closing the composer, navigating away, reloading the page, or pressing Esc discards the current tray. Switching tabs does not discard it.

## Installation

### Temporary installation for testing

1. Download or clone this repository.
2. Open **about:debugging#/runtime/this-firefox** in Firefox.
3. Click **Load Temporary Add-on…**.
4. Select the repository's **manifest.json** file.
5. Reload LinkedIn and open a new publication.

Temporary add-ons are removed when Firefox restarts. This is the easiest way to test changes locally.

### Permanent installation

Firefox Release and Beta require Mozilla-signed extensions. For a persistent installation, submit the package to Mozilla Add-ons as a self-distributed (unlisted) extension, download the signed XPI, and install it through **about:addons**.

Renaming a ZIP file to XPI does not sign it and is not enough for a normal Firefox installation. See Mozilla's [signing and distribution guide](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).

## Supported images and limits

FrogPaste recognizes image files received from the clipboard with an **image/** MIME type. Common formats include PNG, JPEG, GIF, WebP, AVIF, BMP, TIFF, SVG, ICO, HEIC/HEIF, and JPEG XL when the source provides a compatible type or filename.

The extension preserves the file bytes and MIME information it receives. It does not:

- download isolated image URLs;
- read the clipboard periodically;
- re-encode images through a canvas;
- silently reduce the number of images in a batch;
- change LinkedIn's file-size, format, or server-side limits.

The destination field must accept the selected format and, for a batch, multiple files. LinkedIn remains responsible for the final validation and upload. Adding a second batch after LinkedIn has already processed the first is dependent on the site's current editor behavior, so collecting the complete batch before clicking **Anexar todas** is recommended.

Text-only and HTML-only pastes continue through the browser's normal paste behavior. When a paste contains image files, the image files take priority for FrogPaste handling.

## Privacy and permissions

FrogPaste is intentionally narrow in scope:

- It runs only on pages matching **https://www.linkedin.com/**.
- It reads files from a trusted, user-initiated paste event.
- It does not request the **clipboardRead** permission.
- It does not poll or monitor the system clipboard.
- It does not send telemetry or use its own server.
- It does not write images to disk or keep them in permanent storage.
- Preview object URLs are released when images are removed or the tray is closed.
- The normal upload is performed by LinkedIn after the user chooses to attach the files.
- The extension never clicks LinkedIn's **Publish**, **Send**, or equivalent final-action buttons.

The manifest declares that no data collection is required.

## How the handoff works

For a publication batch, FrogPaste:

1. Reads the image files synchronously while the paste event is active.
2. Keeps the files in the in-page tray for review.
3. Creates a unique virtual filename for each attachment to avoid collisions between clipboard files that are all named image.png.
4. Adds the files to a DataTransfer object.
5. Assigns the resulting FileList to LinkedIn's compatible file input.
6. Dispatches the normal change event and lets LinkedIn handle the upload.

The image bytes are not changed during this process. The unique names are only a compatibility measure.

## Validation status

The project currently has:

- **31 passing tests** covering file detection, MIME compatibility, consecutive pastes, multi-image batches, modal mounting, outside-click protection, delayed file inputs, tab switching, removal, cancellation, and related edge cases;
- **1 environment-limited clipboard test skipped**, because the headless environment cannot reliably retain a real operating-system clipboard image;
- Firefox browser tests running against local fixtures with intercepted page traffic.

These tests verify the extension's routing and file handoff logic. They do not use an authenticated LinkedIn account and are not a substitute for validation on the live site.

## Running the tests

Node.js 20 or newer is recommended.

Core tests:

~~~sh
node --test tests/core.test.cjs
~~~

Full local Firefox fixture suite:

~~~sh
npm install --no-save playwright
npx playwright install firefox
node --test tests/core.test.cjs tests/browser.test.cjs
~~~

For disposable container environments, the browser suite can be run with:

~~~sh
FROGPASTE_CONTAINER_TEST=1 node --test tests/core.test.cjs tests/browser.test.cjs
~~~

The manual fixture is available at **tests/manual.html**. It demonstrates the shared scripts locally, but it does not reproduce Firefox extension isolation or LinkedIn's backend.

## Project structure

| File | Purpose |
| --- | --- |
| **manifest.json** | Firefox Manifest V3 metadata, permissions, and content-script registration. |
| **core.js** | Clipboard image extraction, MIME validation, and unique attachment names. |
| **tray.js** | Shadow-DOM image tray, thumbnails, removal, cancellation, and batch attachment. |
| **content.js** | LinkedIn composer detection, paste routing, file-input handoff, and lifecycle handling. |
| **tests/core.test.cjs** | Unit tests for clipboard and file-handling logic. |
| **tests/browser.test.cjs** | Firefox fixture tests for DOM integration and event behavior. |
| **tests/manual.html** | Local manual demonstration page. |

There are no runtime dependencies or build steps. The JavaScript and manifest files are included as readable source, and the ZIP/XPI is only a package for Firefox to install.
