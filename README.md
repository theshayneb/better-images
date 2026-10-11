# Better Images & Attachments

An Obsidian plugin that combines two plugins into one:

- **Images** (based on [Image Converter](https://github.com/xRyul/obsidian-image-converter) by xRyul): convert, compress, resize, crop, rotate, flip, annotate and align images, with batch processing.
- **Attachments** (based on [Attachment Steward](https://github.com/m1roff/obsidian-attachment-steward) by miroff): files every attachment into templated folders and filenames, remembers each file's original name, and never breaks links.

Plugin ID: `better-images`.

## Install with BRAT

1. Install and enable the **BRAT** community plugin.
2. In BRAT's settings choose **Add beta plugin** and enter `theshayneb/better-images`.
3. Enable **Better Images & Attachments** under Settings → Community plugins.

If you use the original Image Converter or Attachment Steward, turn them off: running them alongside this plugin would process every pasted image twice. Settings are not carried over from them, so set this plugin up once (it has its own `data.json`).

## Settings

The settings tab has two sections, switched with the buttons at the top:

- **Images**: the full Image Converter settings (presets for conversion, folders, filenames, link format, resizing; alignment, drag-resize, captions, context menu).
- **Attachments**: the full Attachment Steward settings (location and name templates, exclusions, per-extension overrides, maintenance actions).

### Using both together

When you paste or drop an image, the Images half converts it and saves it; the Attachments half then notices the new file, waits until a note links to it, and moves and renames it according to its templates. Converting a file to a new format (for example PNG to WebP) is recognized as the same attachment, so it keeps its original name.

To avoid two sets of naming rules fighting, pick one half to decide where files go:

- **Let Attachments organize** (recommended): leave the Images folder and filename presets on their defaults and set the location and name templates under Attachments.
- **Let Images organize**: exclude the folders your Images presets write to under Attachments → Exclusions (or right-click the folder → Organize attachments → Exclude this folder).

## Features

### Images

- Convert pasted and dropped images to WebP, JPG or PNG; compress with a quality setting.
- Resize originals or just the link (`|width`), including drag-resize and scroll-wheel resize.
- Crop, rotate and flip; annotate and draw on images.
- Align images and wrap text around them; captions.
- Right-click menu on images in notes: rename/move, resize, copy, copy as Base64, convert/compress, crop/rotate/flip, annotate, delete image and link.
- Batch process a note, a folder or the whole vault.

More detail: [docs/image-converter/README.md](docs/image-converter/README.md).

### Attachments

- Moves and renames new attachments as soon as a note links to them, using templates such as `${notename}`, `${originalname}`, `${date}` and `${md5}`.
- Keeps each attachment's original name, so rules can be changed and reapplied any time.
- Moves attachments along when their note is renamed.
- Folder right-click menu (Organize attachments): adopt, reapply rules, prune records, find attachments with no links, exclude the folder.
- Commands: reapply rules (all, active note), adopt unmanaged attachments (active note, whole vault), prune orphaned records.

More detail: [docs/attachment-steward/README.md](docs/attachment-steward/README.md).

## Development

```
npm ci
npm run typecheck   # tsc for the plugin and the Attachments tests
npm test            # Images tests (tests/) and Attachments tests (test-steward/)
npm run build       # writes build/main.js, build/manifest.json, build/styles.css
```

Code layout: the image features live in `src/`, the attachment organizer in `src/steward/` (started from `src/steward/module.ts`). `src/main.ts` loads both, and `src/BetterImagesSettingTab.ts` is the combined settings tab.

Releases are published by `.github/workflows/release.yml`; see [CHANGELOG.md](CHANGELOG.md).

## License

MIT. See [LICENSE](LICENSE) for the copyright notices of both original plugins.
