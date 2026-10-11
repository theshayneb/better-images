# Changelog

## [1.0.0] - 2026-10-11

First release of Better Images & Attachments, combining Image Converter 1.4.6 and Attachment Steward 0.6.0 into one plugin (ID `better-images`).

- All Image Converter features: convert, compress, resize, crop, rotate, flip, annotate, align, captions, batch processing.
- All Attachment Steward features: templated attachment folders and names, original-name tracking, note-rename handling, exclusions, adopt / reapply / prune.
- One settings tab with **Images** and **Attachments** sections.
- Folder right-click menu: Attachment Steward's submenu is now called **Organize attachments**.
- Commands are listed under Better Images & Attachments; "Open Image Converter Settings" is now **Open settings**.
- Settings are stored in this plugin's own `data.json` (attachment settings under `attachmentSteward`), so they don't mix with the original plugins' settings.
