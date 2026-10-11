# Changelog

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
