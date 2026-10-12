# Better Images & Attachments

An Obsidian plugin that does three things:

- **Organizes attachments**: all of [Attachment Steward](https://github.com/m1roff/obsidian-attachment-steward) by miroff. It files every attachment into templated folders and filenames, remembers each file's original name, and never breaks links.
- **Downloads cover images** linked in a note's `Image` and `WideImage` properties into an `Images` folder next to the note.
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

## Cover images

If a note's `Image` or `WideImage` property holds a web link (`https://…`), the plugin downloads the image into the `Images` folder next to the note and changes the property to link to the saved file:

| Note | Property | Saved as |
| --- | --- | --- |
| `Books/Dune.md` | `Image` | `Books/Images/Dune.jpg` |
| `Books/Dune.md` | `WideImage` | `Books/Images/Dune-wide.jpg` |
| `Music/Love.md`, tagged `#song`, `Album: Beatles Album2` | `Image` | `Music/Images/Beatles Album2.jpg` |

- Notes tagged `#song` with an `Album` property are named after the album, so all songs on an album share one image. If that album's image already exists, it is linked without downloading again.
- For other notes, a new link replaces the existing image of the same name.
- The file extension comes from the downloaded image itself; links that don't lead to an image (for example a web page) are left as they are, with a notice.
- Runs automatically a moment after a web link is added to one of those properties (turn off under **Cover images** in settings). For notes that already have web links, run **Download cover images in all notes**, **Download cover images in current note**, or right-click a folder → **Download cover images**.
- Renaming or moving a note renames its covers to match (`Dune.jpg` → `Dune Messiah.jpg`) and moves them to the `Images` folder next to the note, updating the properties. Only covers named after the note are renamed; shared album covers and other images stay as they are.
- The attachment organizer itself never moves or renames cover images (files linked from `Image` or `WideImage`).

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
npm test            # tests/ (crop tool) and test-steward/ (attachments, covers)
npm run lint
npm run build       # writes build/main.js, build/manifest.json, build/styles.css
```

`src/main.ts` is the plugin; the attachment organizer is in `src/steward/`, the crop tool in `src/crop/` and the cover downloader in `src/covers/`. Releases are published by `.github/workflows/release.yml`; see [CHANGELOG.md](CHANGELOG.md).

## License

MIT. See [LICENSE](LICENSE) for the copyright notices of both original plugins.
