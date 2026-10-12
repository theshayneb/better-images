/**
 * Stand-in for the "obsidian" npm package, which ships only type
 * declarations (no runtime) — real Obsidian injects the actual
 * implementation at plugin-load time. Aliased in over the real import in
 * vitest.config.ts. Deliberately not a faithful full reimplementation of
 * Obsidian's API — just enough behavior for this plugin's own code paths
 * (in-memory vault tree, adapter, metadata cache, rename/create/delete
 * events) to run against in tests.
 */
import realMoment from "moment";

// ---------------------------------------------------------------------------
// Path helpers (mirrors Obsidian's normalizePath closely enough for tests)
// ---------------------------------------------------------------------------

export function normalizePath(path: string): string {
  let out = path.normalize("NFC").replace(/\\/g, "/").replace(/\/+/g, "/");
  if (out.startsWith("/")) out = out.slice(1);
  if (out.endsWith("/") && out.length > 1) out = out.slice(0, -1);
  return out === "." ? "" : out;
}

function parentOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

function nameOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

function extensionOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx <= 0 ? "" : name.slice(idx + 1);
}

function basenameOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx <= 0 ? name : name.slice(0, idx);
}

// ---------------------------------------------------------------------------
// Vault file tree
// ---------------------------------------------------------------------------

export class TAbstractFile {
  name: string;
  path: string;
  parent: TFolder | null = null;
  vault!: FakeVault;

  constructor(path: string) {
    this.path = path;
    this.name = nameOf(path);
  }
}

export class TFile extends TAbstractFile {
  basename: string;
  extension: string;
  stat = { ctime: 0, mtime: 0, size: 0 };
  /** Test-only: binary payload returned by `vault.readBinary`. */
  _content: ArrayBuffer = new ArrayBuffer(0);

  constructor(path: string) {
    super(path);
    this.basename = basenameOf(this.name);
    this.extension = extensionOf(this.name);
  }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];

  isRoot(): boolean {
    return this.path === "";
  }
}

// ---------------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------------

type VaultEventName = "create" | "rename" | "delete";
// Deliberately loose (not per-event overloads like the real Vault.on) — must accept whatever handler signature src/ code passes for each event name.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VaultEventCb = (...args: any[]) => any;

export interface EventRef {
  unsubscribe: () => void;
}

class FakeAdapter {
  constructor(private readonly raw: Map<string, string>, private readonly dirs: Set<string>) {}

  async exists(path: string): Promise<boolean> {
    const p = normalizePath(path);
    return this.raw.has(p) || this.dirs.has(p);
  }

  async read(path: string): Promise<string> {
    const p = normalizePath(path);
    const content = this.raw.get(p);
    if (content === undefined) throw new Error(`ENOENT: no such file, open '${path}'`);
    return content;
  }

  async write(path: string, data: string): Promise<void> {
    const p = normalizePath(path);
    if (p.length > 240) {
      // Mirrors the real filesystem limit that motivated shardKey's hash
      // fallback — see store/shards.ts.
      const err = new Error(`ENAMETOOLONG: name too long, open '${path}'`) as NodeJS.ErrnoException;
      err.code = "ENAMETOOLONG";
      throw err;
    }
    this.raw.set(p, data);
  }

  async remove(path: string): Promise<void> {
    this.raw.delete(normalizePath(path));
  }

  async mkdir(path: string): Promise<void> {
    this.dirs.add(normalizePath(path));
  }

  async rmdir(path: string, _recursive: boolean): Promise<void> {
    const p = normalizePath(path);
    this.dirs.delete(p);
    for (const key of [...this.raw.keys()]) {
      if (key === p || key.startsWith(`${p}/`)) this.raw.delete(key);
    }
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const p = normalizePath(path);
    const prefix = p ? `${p}/` : "";
    const files = [...this.raw.keys()].filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/"));
    const folders = [...this.dirs].filter((d) => d.startsWith(prefix) && !d.slice(prefix.length).includes("/"));
    return { files, folders };
  }
}

export class FakeVault {
  configDir = ".obsidian";
  readonly adapter: FakeAdapter;

  private readonly files = new Map<string, TFile>();
  private readonly folders = new Map<string, TFolder>();
  private readonly rawFs = new Map<string, string>();
  private readonly rawDirs = new Set<string>();
  private readonly listeners = new Map<VaultEventName, Set<VaultEventCb>>();

  constructor() {
    this.adapter = new FakeAdapter(this.rawFs, this.rawDirs);
    this.folders.set("", new TFolder(""));
  }

  // ---- test-setup helpers (not part of the real Vault API) ----

  /** Registers a file (and any missing parent folders) in the note tree, without firing events — use for initial fixture setup. */
  seedFile(path: string, opts?: { content?: ArrayBuffer; mtime?: number; size?: number }): TFile {
    const p = normalizePath(path);
    const file = new TFile(p);
    if (opts?.content) file._content = opts.content;
    if (opts?.mtime !== undefined) file.stat.mtime = opts.mtime;
    if (opts?.size !== undefined) file.stat.size = opts.size;
    this.attach(file);
    return file;
  }

  seedFolder(path: string): TFolder {
    return this.ensureFolder(normalizePath(path));
  }

  /** Like seedFile, but fires a real 'create' event — use to simulate a file landing in the vault mid-test. */
  simulateCreate(path: string, opts?: { content?: ArrayBuffer; mtime?: number; size?: number }): TFile {
    const file = this.seedFile(path, opts);
    this.trigger("create", file);
    return file;
  }

  simulateDelete(path: string): void {
    const file = this.files.get(normalizePath(path));
    if (!file) return;
    this.detach(file);
    this.trigger("delete", file);
  }

  private ensureFolder(path: string): TFolder {
    let folder = this.folders.get(path);
    if (folder) return folder;
    folder = new TFolder(path);
    this.folders.set(path, folder);
    const parentPath = parentOf(path);
    const parent = this.ensureFolder(parentPath);
    folder.parent = parent;
    parent.children.push(folder);
    return folder;
  }

  private attach(file: TFile): void {
    const parent = this.ensureFolder(parentOf(file.path));
    file.parent = parent;
    file.vault = this;
    parent.children.push(file);
    this.files.set(file.path, file);
  }

  private detach(file: TFile): void {
    this.files.delete(file.path);
    if (file.parent) file.parent.children = file.parent.children.filter((c) => c !== file);
  }

  // ---- real Vault API surface used by src/ ----

  getAbstractFileByPath(path: string): TAbstractFile | null {
    const p = normalizePath(path);
    return this.files.get(p) ?? this.folders.get(p) ?? null;
  }

  getMarkdownFiles(): TFile[] {
    return [...this.files.values()].filter((f) => f.extension === "md");
  }

  async createFolder(path: string): Promise<TFolder> {
    const p = normalizePath(path);
    if (this.folders.has(p)) throw new Error(`Folder already exists: ${p}`);
    return this.ensureFolder(p);
  }

  async readBinary(file: TFile): Promise<ArrayBuffer> {
    return file._content;
  }

  async createBinary(path: string, data: ArrayBuffer): Promise<TFile> {
    const p = normalizePath(path);
    if (this.files.has(p)) throw new Error(`File already exists: ${p}`);
    return this.simulateCreate(p, { content: data });
  }

  async modifyBinary(file: TFile, data: ArrayBuffer): Promise<void> {
    file._content = data;
  }

  on(name: VaultEventName, cb: VaultEventCb): EventRef {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(cb);
    return { unsubscribe: () => set?.delete(cb) };
  }

  trigger(name: VaultEventName, ...args: unknown[]): void {
    for (const cb of this.listeners.get(name) ?? []) cb(...args);
  }

  // ---- fileManager delegate (kept here since it needs direct tree access) ----

  async renameFile(file: TAbstractFile, newPath: string): Promise<void> {
    const p = normalizePath(newPath);
    if (file instanceof TFile) {
      const oldPath = file.path;
      this.detach(file);
      file.path = p;
      file.name = nameOf(p);
      file.basename = basenameOf(file.name);
      file.extension = extensionOf(file.name);
      this.attach(file);
      this.trigger("rename", file, oldPath);
      return;
    }
    if (file instanceof TFolder) {
      const oldPath = file.path;
      this.folders.delete(oldPath);
      file.path = p;
      file.name = nameOf(p);
      const parent = this.ensureFolder(parentOf(p));
      file.parent = parent;
      this.folders.set(p, file);
      this.trigger("rename", file, oldPath);
    }
  }
}

// ---------------------------------------------------------------------------
// MetadataCache
// ---------------------------------------------------------------------------

export interface CachedMetadata {
  embeds?: { link: string }[];
  links?: { link: string }[];
  frontmatterLinks?: { link: string; key?: string }[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  frontmatter?: Record<string, any>;
  tags?: { tag: string }[];
}

/** Inline tags plus frontmatter `tags`, each with a leading "#", like Obsidian's getAllTags. */
export function getAllTags(cache: CachedMetadata): string[] {
  const out = (cache.tags ?? []).map((t) => t.tag);
  const fm = cache.frontmatter?.tags;
  for (const tag of Array.isArray(fm) ? fm : typeof fm === "string" ? fm.split(/[,\s]+/) : []) {
    if (tag) out.push(String(tag).startsWith("#") ? String(tag) : `#${tag}`);
  }
  return out;
}

export interface RequestUrlResponse {
  status: number;
  headers: Record<string, string>;
  arrayBuffer: ArrayBuffer;
}
let requestUrlHandler: (params: { url: string }) => Promise<RequestUrlResponse> = async () => {
  throw new Error("no network in tests");
};
/** Test helper: decides what requestUrl returns. */
export function setRequestUrlHandler(handler: typeof requestUrlHandler): void {
  requestUrlHandler = handler;
}
export function requestUrl(params: { url: string; throw?: boolean }): Promise<RequestUrlResponse> {
  return requestUrlHandler(params);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MetadataEventCb = (...args: any[]) => any;

export class FakeMetadataCache {
  /** sourcePath -> destPath -> link count. Tests populate this directly to represent resolved links/embeds. */
  resolvedLinks: Record<string, Record<string, number>> = {};

  private readonly fileCaches = new Map<TFile, CachedMetadata>();
  private readonly listeners = new Set<MetadataEventCb>();

  constructor(private readonly vault: FakeVault) {}

  setFileCache(file: TFile, cache: CachedMetadata): void {
    this.fileCaches.set(file, cache);
  }

  getFileCache(file: TFile): CachedMetadata | null {
    return this.fileCaches.get(file) ?? null;
  }

  fileToLinktext(file: TFile, _sourcePath: string, _omitMdExtension?: boolean): string {
    return file.name;
  }

  getFirstLinkpathDest(linkpath: string, _sourcePath: string): TFile | null {
    const direct = this.vault.getAbstractFileByPath(normalizePath(linkpath));
    if (direct instanceof TFile) return direct;
    const all = [...(this.vault as unknown as { files: Map<string, TFile> })["files"]?.values?.() ?? []];
    return (all as TFile[]).find((f) => f.name === linkpath || f.path.endsWith(`/${linkpath}`)) ?? null;
  }

  on(_name: "changed", cb: MetadataEventCb): EventRef {
    this.listeners.add(cb);
    return { unsubscribe: () => this.listeners.delete(cb) };
  }

  trigger(...args: unknown[]): void {
    for (const cb of this.listeners) cb(...args);
  }
}

// ---------------------------------------------------------------------------
// FileManager / Workspace / App
// ---------------------------------------------------------------------------

export class FakeFileManager {
  constructor(private readonly vault: FakeVault) {}

  async renameFile(file: TAbstractFile, newPath: string): Promise<void> {
    return this.vault.renameFile(file, newPath);
  }

  /** Edits the cached frontmatter in place (tests have no note text to rewrite). */
  cache: FakeMetadataCache | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async processFrontMatter(file: TFile, fn: (frontmatter: Record<string, any>) => void): Promise<void> {
    const cache = this.cache?.getFileCache(file) ?? {};
    const frontmatter = { ...(cache.frontmatter ?? {}) };
    fn(frontmatter);
    this.cache?.setFileCache(file, { ...cache, frontmatter });
  }

  /** Overridable per test; default mirrors "same folder as the owning note". */
  getAvailablePathForAttachment = async (filename: string, ownerPath: string): Promise<string> => {
    const parent = ownerPath ? parentOf(ownerPath) : "";
    return parent ? `${parent}/${filename}` : filename;
  };
}

export class FakeWorkspace {
  private activeFile: TFile | null = null;

  setActiveFile(file: TFile | null): void {
    this.activeFile = file;
  }

  getActiveFile(): TFile | null {
    return this.activeFile;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(_name: string, _cb: (...args: any[]) => any): EventRef {
    return { unsubscribe: () => {} };
  }

  onLayoutReady(cb: () => void): void {
    cb();
  }
}

export class App {
  vault = new FakeVault();
  metadataCache = new FakeMetadataCache(this.vault);
  fileManager = new FakeFileManager(this.vault);

  constructor() {
    this.fileManager.cache = this.metadataCache;
  }
  workspace = new FakeWorkspace();
}

// ---------------------------------------------------------------------------
// Plugin / PluginSettingTab
// ---------------------------------------------------------------------------

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  dir?: string;
}

export class Plugin {
  app: App;
  manifest: PluginManifest;
  private _data: unknown = null;

  constructor(app: App, manifest: PluginManifest) {
    this.app = app;
    this.manifest = manifest;
  }

  async loadData(): Promise<unknown> {
    return this._data;
  }

  async saveData(data: unknown): Promise<void> {
    this._data = data;
  }

  addCommand(_cmd: unknown): void {}
  addSettingTab(_tab: unknown): void {}
  registerEvent(_ref: EventRef): void {}
}

export class PluginSettingTab {
  containerEl = new FakeEl("div");
  constructor(public app: App, public plugin: Plugin) {}
  display(): void {}
}

// ---------------------------------------------------------------------------
// Minimal DOM stand-in + Modal/Setting, for the two preview/report modals
// ---------------------------------------------------------------------------

export class FakeEl {
  tag: string;
  cls: string[] = [];
  text = "";
  children: FakeEl[] = [];
  attr: Record<string, unknown> = {};

  constructor(tag = "div") {
    this.tag = tag;
  }

  addClass(...cls: string[]): this {
    this.cls.push(...cls);
    return this;
  }

  setText(text: string): this {
    this.text = text;
    return this;
  }

  empty(): this {
    this.children = [];
    return this;
  }

  createEl(tag: string, opts?: { text?: string; cls?: string | string[]; attr?: Record<string, unknown> }): FakeEl {
    const el = new FakeEl(tag);
    if (opts?.text) el.text = opts.text;
    if (opts?.cls) el.addClass(...(Array.isArray(opts.cls) ? opts.cls : [opts.cls]));
    if (opts?.attr) el.attr = opts.attr;
    this.children.push(el);
    return el;
  }

  createDiv(opts?: { text?: string; cls?: string | string[] }): FakeEl {
    return this.createEl("div", opts);
  }

  createSpan(opts?: { text?: string; cls?: string | string[] }): FakeEl {
    return this.createEl("span", opts);
  }

  appendChild(el: FakeEl): FakeEl {
    this.children.push(el);
    return el;
  }

  remove(): void {}
}

export class ButtonComponent {
  buttonText = "";
  isCta = false;
  onClickFn: (() => void | Promise<void>) | null = null;
  extraSettingsEl = new FakeEl();

  setButtonText(text: string): this {
    this.buttonText = text;
    return this;
  }

  setCta(): this {
    this.isCta = true;
    return this;
  }

  setIcon(_icon: string): this {
    return this;
  }

  setTooltip(_tooltip: string): this {
    return this;
  }

  onClick(fn: () => void | Promise<void>): this {
    this.onClickFn = fn;
    return this;
  }

  /** Test helper — not part of the real API. */
  async click(): Promise<void> {
    await this.onClickFn?.();
  }
}

export class ToggleComponent {
  value = false;
  toggleEl = new FakeEl();
  onChangeFn: ((v: boolean) => void) | null = null;
  setValue(v: boolean): this {
    this.value = v;
    return this;
  }
  onChange(fn: (v: boolean) => void): this {
    this.onChangeFn = fn;
    return this;
  }
}

export class TextComponent {
  value = "";
  inputEl = new FakeEl("input");
  onChangeFn: ((v: string) => void) | null = null;
  setValue(v: string): this {
    this.value = v;
    return this;
  }
  setPlaceholder(_p: string): this {
    return this;
  }
  onChange(fn: (v: string) => void): this {
    this.onChangeFn = fn;
    return this;
  }
}

export class DropdownComponent {
  options: Record<string, string> = {};
  value = "";
  onChangeFn: ((v: string) => void) | null = null;
  addOption(value: string, label: string): this {
    this.options[value] = label;
    return this;
  }
  setValue(v: string): this {
    this.value = v;
    return this;
  }
  onChange(fn: (v: string) => void): this {
    this.onChangeFn = fn;
    return this;
  }
}

export class Setting {
  infoEl = new FakeEl();
  controlEl = new FakeEl();
  descEl = new FakeEl();
  nameEl = new FakeEl();
  buttons: ButtonComponent[] = [];
  toggles: ToggleComponent[] = [];
  texts: TextComponent[] = [];
  dropdowns: DropdownComponent[] = [];

  /** Test hook, mirroring Modal.instances — lets a test find the Setting a modal/settings-tab just built (e.g. to click a button) without exposing internals. Reset with `Setting.instances.length = 0` in `beforeEach`. */
  static instances: Setting[] = [];

  constructor(public containerEl: FakeEl) {
    Setting.instances.push(this);
  }

  setName(_n: string): this {
    return this;
  }
  setDesc(_d: string): this {
    return this;
  }
  setHeading(): this {
    return this;
  }
  addButton(cb: (b: ButtonComponent) => void): this {
    const b = new ButtonComponent();
    cb(b);
    this.buttons.push(b);
    return this;
  }
  addExtraButton(cb: (b: ButtonComponent) => void): this {
    return this.addButton(cb);
  }
  addToggle(cb: (t: ToggleComponent) => void): this {
    const t = new ToggleComponent();
    cb(t);
    this.toggles.push(t);
    return this;
  }
  addText(cb: (t: TextComponent) => void): this {
    const t = new TextComponent();
    cb(t);
    this.texts.push(t);
    return this;
  }
  addDropdown(cb: (d: DropdownComponent) => void): this {
    const d = new DropdownComponent();
    cb(d);
    this.dropdowns.push(d);
    return this;
  }
}

export class Modal {
  contentEl = new FakeEl("div");
  app: App;

  /** Test hook — every instantiated modal (of any subclass) is pushed here so tests can grab the one a command just opened. Reset with `Modal.instances.length = 0` in `beforeEach`. */
  static instances: Modal[] = [];

  constructor(app: App) {
    this.app = app;
    Modal.instances.push(this);
  }

  open(): void {
    this.onOpen();
  }

  close(): void {
    this.onClose();
  }

  onOpen(): void {}
  onClose(): void {}
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export class Notice {
  message: string;
  static log: string[] = [];

  hidden = false;

  constructor(message: string, _duration?: number) {
    this.message = message;
    Notice.log.push(message);
  }

  setMessage(message: string): this {
    this.message = message;
    Notice.log.push(message);
    return this;
  }

  hide(): void {
    this.hidden = true;
  }
}

export const Platform = {
  isMobile: false,
  isDesktop: true,
};

export abstract class AbstractInputSuggest<T> {
  constructor(protected app: App, protected inputEl: HTMLInputElement) {}
  abstract getSuggestions(query: string): T[] | Promise<T[]>;
  abstract renderSuggestion(value: T, el: HTMLElement): void;
  abstract selectSuggestion(value: T): void;
}

export const moment = realMoment;

// Minimal stand-ins so src/main.ts (and the crop tool it imports) can load.
export class Component {
  load(): void {}
  unload(): void {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerDomEvent(..._args: any[]): void {}
}

export class MarkdownView {}
