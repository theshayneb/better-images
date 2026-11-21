# Changelog

## [1.0.7] - 2026-11-21

- Fixed: on desktop, covers of new notes often weren't downloaded automatically. Every time Obsidian came back to the foreground, which Windows and macOS also report when another window had been covering it, the 45-second wait for Sync started over, so queued work kept being put off. On desktop, coming back to the foreground no longer restarts the wait (Obsidian keeps syncing in the background there). On phone and tablet it restarts only after being away for at least 30 seconds, and coming back online only after being offline for at least 30 seconds.

## [1.0.6] - 2026-11-18

Stops devices overwriting each other through Obsidian Sync, and makes start-up faster.

- New setting **Run background tasks on this device** (under **This device**), saved on each device and not synced. On by default for desktop, off for phone and tablet. Only a device with it on downloads cover images automatically, renames covers when a note is renamed, and organizes attachments. Elsewhere attachments are left as they are (pasted images keep their "Pasted image …" name) until the background device organizes them after they sync. Commands and menus still work on every device.
- Automatic work waits 45 seconds after Obsidian starts, comes back to the foreground or comes back online, so Sync can bring the vault up to date first.
- `data.json`, attachment record files and cover images are only written when their content actually changed. Before, every device rewrote `data.json` on every record save and every time Obsidian closed, so a device with old settings could overwrite newer ones.
- Settings that arrive through Sync are now taken in straight away (merged with any change made on this device that wasn't saved yet), instead of being overwritten by this device's older copy later.
- A cover rename no longer rewrites the note when Obsidian already updated the link.
- Faster start-up: attachment records are read in parallel in the background instead of one by one before the plugin finishes loading. Files that arrive meanwhile are handled once the records are in.
- Fixed: re-running rules on an attachment that already had its numbered name (`Note-1.png`) tried to move it onto itself.
- Requires Obsidian 1.8.7 or newer.

## [1.0.5] - 2026-10-12

- Fixed: renaming a note (for example a #book note) left its cover images under the old name. Now `Images/<old name>.jpg` and `<old name>-wide.jpg` are renamed to the note's new name, moved to the `Images` folder next to the note if the note moved, and the `Image` / `WideImage` properties are updated. Album covers of #song notes are shared and stay as they are; images with other names are left alone, and an existing image with the new name is never overwritten.

## [1.0.4] - 2026-10-12

- "Download cover images" (commands and folder menu) now shows "Downloading covers for 40 notes…" while it works, counting notes as they finish, then the summary.

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
