# Changelog

## [1.0.3] - 2026-10-12

- New: **cover images**. When a note's `Image` or `WideImage` property holds a web link, the image is downloaded to the `Images` folder next to the note and the property is changed to link to the saved file. It is named after the note (`Dune.jpg`, `Dune-wide.jpg`); notes tagged `#song` are named after their `Album` property instead, and songs on an album that already has an image reuse it without downloading again.
- Happens automatically a moment after the link is added (can be turned off in settings), or on demand: commands "Download cover images in current note" / "in all notes", and "Download cover images" in a folder's right-click menu.
- The attachment organizer leaves cover images (any file linked from an `Image` or `WideImage` property) where they are, with their names.

## [1.0.2] - 2026-10-11

- Fixed: if version 1.0.0 had ever run, 1.0.1 skipped importing your Attachment Steward settings and used the default attachment settings instead. This version imports them once on start-up (replacing the defaults), as long as Attachment Steward is still installed in the vault.

## [1.0.1] - 2026-10-11

- Slimmed down to Attachment Steward plus crop / rotate / flip. All other Image Converter features are gone (paste conversion, compression, resizing, annotation, alignment, captions, batch processing), so the settings tab now only has the attachment settings.
- Imports your Attachment Steward settings and attachment records automatically on first run, and from **Import** at the top of the settings any time.
- **Crop, rotate or flip** in the right-click menu of PNG, JPG and WebP images (file list and images in notes) and of image links in the editor, plus a command for the open image or the image link under the cursor.

## [1.0.0] - 2026-10-11

First release of Better Images & Attachments, combining Image Converter 1.4.6 and Attachment Steward 0.6.0 into one plugin (ID `better-images`).

- All Image Converter features: convert, compress, resize, crop, rotate, flip, annotate, align, captions, batch processing.
- All Attachment Steward features: templated attachment folders and names, original-name tracking, note-rename handling, exclusions, adopt / reapply / prune.
- One settings tab with **Images** and **Attachments** sections.
- Folder right-click menu: Attachment Steward's submenu is now called **Organize attachments**.
- Commands are listed under Better Images & Attachments; "Open Image Converter Settings" is now **Open settings**.
- Settings are stored in this plugin's own `data.json` (attachment settings under `attachmentSteward`), so they don't mix with the original plugins' settings.
