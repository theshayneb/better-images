import type { App } from "obsidian";

/** How long to wait after start-up, or after the app comes back to the foreground, before automatic vault changes. */
export const SETTLE_MS = 45_000;

/**
 * Being away (in the background, or offline) for less than this doesn't
 * restart the wait: Sync can't have fallen behind in so short a time.
 */
export const AWAY_MS = 30_000;

/** Device-local (never synced) switch, stored in Obsidian's per-vault localStorage. */
const LOCAL_STORAGE_KEY = "better-images:run-background-tasks";

/**
 * Decides whether this device does automatic vault work (downloading covers,
 * renaming covers, organizing attachments) and when.
 *
 * Only one always-on device should do it: on a phone that syncs every few
 * hours, a file arriving through sync isn't newer, and acting on it races the
 * desktop that already did. The switch is stored per device, defaulting to on
 * for desktop and off for mobile. Even where it's on, work waits until the
 * app has been running (or back in the foreground) for SETTLE_MS, so Sync can
 * bring the vault up to date first.
 */
export class BackgroundTasks {
    private settledAt: number;
    private timer: number | null = null;
    private hiddenAt: number | null = null;
    private offlineAt: number | null = null;
    private waiting: Array<() => void> = [];

    constructor(
        private readonly app: App,
        private readonly isMobile: boolean
    ) {
        this.settledAt = Date.now() + SETTLE_MS;
        this.arm();
    }

    /** Whether this device runs automatic work at all. */
    get enabled(): boolean {
        const stored: unknown = this.app.loadLocalStorage(LOCAL_STORAGE_KEY);
        if (stored === true || stored === "true") return true;
        if (stored === false || stored === "false") return false;
        return !this.isMobile;
    }

    set enabled(value: boolean) {
        this.app.saveLocalStorage(LOCAL_STORAGE_KEY, value);
    }

    /** Whether this device runs automatic work and Sync has had time to settle. */
    get ready(): boolean {
        return this.enabled && Date.now() >= this.settledAt;
    }

    /** The app went to the background. */
    appHidden(): void {
        this.hiddenAt = Date.now();
    }

    /**
     * The app came back to the foreground. On a phone or tablet the app (and
     * Sync) is paused in the background, so after a real absence, wait for
     * Sync again. On desktop Obsidian keeps syncing while hidden (and the
     * system reports it hidden whenever another window covers it), so this
     * doesn't restart the wait there.
     */
    appVisible(): void {
        const hiddenFor = this.hiddenAt === null ? 0 : Date.now() - this.hiddenAt;
        this.hiddenAt = null;
        if (this.isMobile && hiddenFor >= AWAY_MS) this.restart();
    }

    wentOffline(): void {
        this.offlineAt = Date.now();
    }

    /** Back online after a real absence: Sync has catching up to do, so wait for it again. */
    cameOnline(): void {
        const offlineFor = this.offlineAt === null ? 0 : Date.now() - this.offlineAt;
        this.offlineAt = null;
        if (offlineFor >= AWAY_MS) this.restart();
    }

    /** Start waiting again. */
    restart(): void {
        this.settledAt = Date.now() + SETTLE_MS;
        this.arm();
    }

    /**
     * Runs `task` once this device may do automatic work: now if already
     * settled, otherwise when the wait ends. Dropped if background tasks are
     * off for this device by then.
     */
    whenReady(task: () => void): void {
        if (!this.enabled) return;
        if (this.ready) {
            task();
            return;
        }
        this.waiting.push(task);
    }

    dispose(): void {
        if (this.timer !== null) window.clearTimeout(this.timer);
        this.timer = null;
        this.waiting = [];
    }

    private arm(): void {
        if (this.timer !== null) window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => this.release(), Math.max(0, this.settledAt - Date.now()));
    }

    private release(): void {
        this.timer = null;
        if (Date.now() < this.settledAt) {
            this.arm();
            return;
        }
        const tasks = this.waiting;
        this.waiting = [];
        if (!this.enabled) return;
        for (const task of tasks) task();
    }
}
