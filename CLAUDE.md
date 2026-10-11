# Better Images & Attachments: notes for Claude Code

The owner's Obsidian plugin combining Image Converter (image features, in `src/`) and Attachment Steward (attachment organizer, in `src/steward/`). Installed with BRAT from `theshayneb/better-images`. Keep the plugin id `better-images`: changing it would orphan the installed plugin and its `data.json`.

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
npm test            # tests/ (images) and test-steward/ (attachments, own Obsidian mock)
npm run build
npx eslint src/main.ts src/BetterImagesSettingTab.ts "src/steward/**/*.ts"
```

`npm run lint` (whole `src/`) has some pre-existing errors in the original Image Converter files; don't add new ones.

## Things to know

- `data.json` holds the image settings at the top level and the attachment settings under `attachmentSteward`. `src/main.ts` splits them on load and writes both on every save (`saveAllData`); nothing else should call `saveData` directly.
- Attachment records are sharded under the plugin folder in `records/`, not in `data.json`.
- The settings tab (`src/BetterImagesSettingTab.ts`) extends the image settings tab and adds an Images / Attachments switcher.
- `src/steward/` keeps upstream Attachment Steward's code style (eslint override in `eslint.config.mjs`) so upstream fixes can be compared and ported.
