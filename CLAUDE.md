# Better Images & Attachments: notes for Claude Code

The owner's Obsidian plugin: Attachment Steward's attachment organizer (`src/steward/`) plus Image Converter's crop / rotate / flip editor (`src/crop/`), opened from image right-click menus. The owner only wants crop/rotate/flip from Image Converter; don't bring back its other features. Installed with BRAT from `theshayneb/better-images`. Keep the plugin id `better-images`: changing it would orphan the installed plugin and its `data.json`.

## Workflow

- Push finished, checked work straight to `main`. No pull requests, no asking first.
- Every change that ships gets a new patch version and a GitHub release:
  1. Bump the version in `manifest.json`, `package.json` and `package-lock.json` (top-level `version` and `packages[""].version`), and add it to the top of `versions.json` mapped to `manifest.json`'s `minAppVersion`.
  2. Add a `## [x.y.z] - YYYY-MM-DD` entry at the top of `CHANGELOG.md`. The release workflow uses it as the release notes and fails without it.
  3. Commit and push to `main`, then publish with `.github/workflows/release.yml`: push the tag `x.y.z` (no `v` prefix), or where tag pushes are blocked run the "Release Plugin" workflow on `main` with `version: x.y.z`; it creates the tag itself.
  4. Tell the owner the version number. Don't give them git commands; they use the GitHub web interface.
- Never reuse a version number that was already tagged or released.

## Checks before pushing

```
npm run typecheck
npm test            # tests/ (crop tool) and test-steward/ (attachments, own Obsidian mock)
npm run lint        # warnings only in src/crop/Crop.ts (copied from Image Converter)
npm run build
```

## Things to know

- `data.json` holds the attachment settings under `attachmentSteward`. `src/main.ts` owns `saveData`; the organizer saves through the `StewardHost` it is given.
- Attachment records are sharded under the plugin folder in `records/`, not in `data.json`.
- On first run (no `attachmentSteward` saved) the plugin imports the stand-alone Attachment Steward's `data.json` and `records/` (`src/steward/import.ts`); the settings tab has an Import button for doing it again.
- `src/steward/` keeps upstream Attachment Steward's code style (eslint override in `eslint.config.mjs`) so upstream fixes can be compared and ported.
