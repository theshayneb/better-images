# Attachment Steward

Organizes your notes' attachments into a folder/filename structure you define — and actually gets the edge cases right.

[![Buy Me A Coffee](https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png)](https://buymeacoffee.com/miroff)

## Why another attachment-organizing plugin?

Every attachment-management plugin for Obsidian promises the same thing: move your images and files into tidy, templated folders instead of leaving them scattered next to your notes. In practice, the existing options tend to fall down on the same handful of edge cases:

- **Bulk imports get missed.** If a note arrives with its attachments already linked — e.g. exporting from Apple Notes, Evernote, or any other "convert to Markdown" tool — the note and its files land in the vault together, links already inline. Plugins that only react to you *editing* a note afterwards never notice these attachments, so nothing gets organized until you touch the note by hand.
- **Reapplying rules corrupts filenames.** Templates commonly include the attachment's original filename. But if a plugin reads that from the file's *current* (already renamed) name instead of remembering the true original, running the same rule twice keeps stacking the template on top of itself — you end up with the date or hash prefix repeated two, three, four times in a single filename.
- **Moves only patch the one note that triggered them.** If an attachment is linked from more than one note, or from a canvas, a move that only rewrites the triggering note's text leaves every other reference pointing at a file that no longer exists there.

Attachment Steward is built around fixing exactly these three things:

1. **Attachments are organized the moment they're seen** — including bulk imports, by matching newly-created files against the metadata cache instead of waiting for a note edit.
2. **The true original filename is captured once, frozen, and never re-derived from a possibly-already-renamed file.** Reapplying your rules is idempotent: run it as many times as you like, nothing compounds.
3. **Every move goes through Obsidian's own link-rewriting**, so every note and canvas that references the file gets updated — not just the one that happened to trigger the move.

## Installation

Not yet in the official Community Plugins directory. Install via [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install and enable the **BRAT** community plugin.
2. BRAT → *Add beta plugin* → enter this repository's URL.
3. Enable **Attachment Steward** under Settings → Community plugins.

## How it works

- **Location** settings decide *where* attachments go: a base location (vault root, a fixed folder, next to the note, or wherever Obsidian's own core setting puts new attachments) plus a folder template and a filename template, both built from variables: `${notepath}`, `${notename}`, `${parent}`, `${date}`, `${md5}`, `${originalname}`.
- New attachments are organized automatically as soon as they're linked from a note.
- Renaming or moving a note moves its attachments along and updates every link, everywhere in the vault (toggle: *Automatically rename attachment*).
- Empty folders left behind by a move are cleaned up automatically (toggle: *Clean up empty folders*) — a folder that still contains a note or other files is never touched.

### Commands

- **Reapply rules to all managed attachments** / **…to active note's attachments** — recomputes every attachment's destination from its frozen original name and your *current* settings, previews the diff, and moves on confirmation. Safe to run repeatedly.
- **Adopt unmanaged attachments in active note / in whole vault** — for attachments that exist and are linked but were never organized (e.g. from before you installed the plugin, or ones a previous plugin left untouched), registers them and offers to move them into place.
- **Prune orphaned attachment records** — manual cleanup of tracking records for files that no longer exist (this also happens automatically on delete).

### Folder context menu

Right-click any folder in the file explorer for an **Attachment Steward** entry with a submenu of folder-scoped versions of the above, applied recursively to that folder and its subfolders:

- **Adopt unmanaged attachments**
- **Reapply rules**
- **Prune orphaned records**
- **Find attachments with no links** — a diagnostic, report-only scan: lists every file under the folder that no note or canvas anywhere in the vault links to or embeds. This is different from "unmanaged" — a file can be unmanaged but still referenced (Adopt catches those); this command finds the ones with *no reference at all*, e.g. leftovers from a bulk import (Apple Notes, Evernote, …) where a link never parsed correctly and the file was simply left behind in the export folder.
- **Exclude this folder / Remove this folder from Exclusions** — toggles the folder in and out of the *Excluded folders* list below (recursively), for a folder this plugin should never touch at all — e.g. a raw export dump you don't want reorganized.

### Exclusions

- **Exclude extension pattern** — a regular expression; matching extensions are left alone entirely.
- **Excluded folders** — a list of folders this plugin never touches, each with its own *include subfolders* toggle. Add one from the settings tab (with folder-name autocomplete as you type) or via the folder context menu above. Entries follow the folder if you rename or move it; an entry flagged "folder not found" points at a folder that no longer exists and can be deleted with its trash icon.
- **Extension overrides** — a different folder/filename template for specific extensions.

## Development

Local dev tooling runs entirely in Docker — nothing is installed on the host beyond Docker itself.

```bash
docker compose build
docker compose run --rm build npm install
docker compose up -d      # watches src/ and rebuilds main.js on change
```

Symlink the build output into a test vault's `.obsidian/plugins/attachment-steward/` folder, then reload plugins in Obsidian (`Cmd+P` → *Reload app without saving*) after each rebuild, or install the [Hot Reload](https://github.com/pjeby/hot-reload) community plugin for automatic reloading.

## License

MIT
