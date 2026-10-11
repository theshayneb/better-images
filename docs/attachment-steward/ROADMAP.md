# Roadmap / known follow-ups

Not urgent — nothing here blocks day-to-day use. Noted so a future session doesn't have to re-derive the same research from scratch.

## Migrate to the declarative settings API (`getSettingDefinitions()`)

- `display()` is deprecated since Obsidian 1.13.0 in favor of a new declarative settings API (`PluginSettingTab.getSettingDefinitions()`). Plugins that only implement `display()` don't show up in Obsidian's cross-plugin settings search on 1.13.0+.
- Not done yet because this API surface is new enough that there's no solid documentation for it in memory — needs an actual research pass first: check `obsidian.d.ts` for the exact shape of `getSettingDefinitions()`, whether `display()` can stay as a fallback for pre-1.13.0 users or has to be replaced outright, and whether the *dynamic* parts of this settings UI — the excluded-folders list and the extension-overrides list, both of which add/remove rows at runtime — are even expressible in a declarative schema, or need an escape hatch.
- Touches: [src/settings/tab.ts](src/settings/tab.ts) (the whole file), and the same deprecation warning also flags the `display()` call site in [src/main.ts](src/main.ts) (`this.settingTab.display()` inside `refreshSettingsTab()`).
- Trade-off if we do it: raising `minAppVersion` past `1.6.6` up to whatever version first shipped the declarative API cleanly (confirm the exact number via `@since` in `obsidian.d.ts`) — that drops support for anyone still on an older Obsidian. Needs an explicit decision, not a silent bump.

## Verify actual mobile behavior

- `manifest.json` claims `isDesktopOnly: false`, and the community.obsidian.md scorecard lists "Platforms: Desktop, Mobile" — but this has never actually been run on iOS/iPadOS/Android, only reasoned about (no `require`/`electron`/`process`/raw `fs` usage anywhere in `src/`, so nothing *should* be desktop-only). Worth an actual manual pass on a mobile device or simulator before fully trusting the claim — especially the folder-path autocomplete ([src/ui/folderSuggest.ts](src/ui/folderSuggest.ts)) and the folder context-menu submenu, which leans on `MenuItem.setSubmenu()` — itself an API undocumented in the public types (see [src/types/obsidian-augment.d.ts](src/types/obsidian-augment.d.ts)) and worth double-checking it even renders sanely on mobile's context menus.

## Optional: backup/export for `data.json`

- Came up while discussing what happens if the plugin folder gets fully removed (as opposed to just updated) — `data.json` holds every setting plus the entire attachment-tracking database, and an actual "Remove" (not an update) deletes it with no recovery path.
- Never actually requested, just flagged as a possible small addition: an "Export settings & data" button in the Maintenance section that dumps `data.json`'s content somewhere the user picks. Pick this up only if it's actually wanted — don't build it speculatively.
