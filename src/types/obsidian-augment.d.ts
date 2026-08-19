import "obsidian";

declare module "obsidian" {
  interface MenuItem {
    /**
     * Not in the public .d.ts, but present at runtime (used internally by
     * Obsidian and by plugins like Templater for grouped context-menu items).
     */
    setSubmenu(): Menu;
  }
}
