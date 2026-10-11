# Better Images & Attachments

An Obsidian plugin that does two things:

- **Organizes attachments**: all of [Attachment Steward](https://github.com/m1roff/obsidian-attachment-steward) by miroff. It files every attachment into templated folders and filenames, remembers each file's original name, and never breaks links.
- **Crops, rotates and flips images**: the crop tool from [Image Converter](https://github.com/xRyul/obsidian-image-converter) by xRyul, opened from an image's right-click menu. Nothing else from Image Converter is included.

Plugin ID: `better-images`.

## Install with BRAT

1. Install and enable the **BRAT** community plugin.
2. In BRAT's settings choose **Add beta plugin** and enter `theshayneb/better-images`.
3. Enable **Better Images & Attachments** under Settings → Community plugins.

### Moving over from Attachment Steward

The first time it runs, the plugin copies the settings and attachment records of the Attachment Steward plugin installed in the same vault, and shows a notice when it has. Then **turn off Attachment Steward**, or both will organize your attachments.

You can repeat the import any time with **Import** at the top of this plugin's settings; it replaces the attachment settings and records with Attachment Steward's.

## Crop, rotate or flip an image

Open the editor in any of these ways:

- Right-click an image in the file list.
- Right-click an image shown in a note.
- In the editor, right-click on an image link (`![[photo.png]]` or `![](photo.png)`).
- Run the command **Crop, rotate or flip image** while viewing an image, or with the cursor on an image link.

In the editor, drag a crop box (optionally locked to a ratio such as 1:1 or 16:9), rotate, flip, zoom, then **Save**. Saving overwrites the image at the same path in the same format, so links and attachment records stay valid. Works with PNG, JPG and WebP.

Drawing the crop box needs a mouse or trackpad; on a phone, rotate and flip work but dragging a crop box doesn't.

## Organizing attachments

- Moves and renames new attachments as soon as a note links to them, using templates such as `${notename}`, `${originalname}`, `${date}` and `${md5}`.
- Keeps each attachment's original name, so rules can be changed and reapplied any time.
- Moves attachments along when their note is renamed.
- Folder right-click menu (**Organize attachments**): adopt, reapply rules, prune records, find attachments with no links, exclude the folder.
- Commands: reapply rules (all, active note), adopt unmanaged attachments (active note, whole vault), prune orphaned records.

If your name template uses `${md5}`, cropping an image changes its contents, so the next **Reapply rules** gives it a new name.

More detail: [docs/attachment-steward/README.md](docs/attachment-steward/README.md).

## Development

```
npm ci
npm run typecheck
npm test            # tests/ (crop tool) and test-steward/ (attachments)
npm run lint
npm run build       # writes build/main.js, build/manifest.json, build/styles.css
```

`src/main.ts` is the plugin; the attachment organizer is in `src/steward/` and the crop tool in `src/crop/`. Releases are published by `.github/workflows/release.yml`; see [CHANGELOG.md](CHANGELOG.md).

## License

MIT. See [LICENSE](LICENSE) for the copyright notices of both original plugins.
