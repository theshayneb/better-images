import { Notice } from "obsidian";

const PREFIX = "[attachment-organizer]";

let debugEnabled = false;
let notificationsEnabled = true;

export function configureLogging(opts: { debug: boolean; notifications: boolean }): void {
  debugEnabled = opts.debug;
  notificationsEnabled = opts.notifications;
}

export const log = {
  debug(...args: unknown[]): void {
    if (debugEnabled) console.log(PREFIX, ...args);
  },
  warn(...args: unknown[]): void {
    console.warn(PREFIX, ...args);
  },
  error(...args: unknown[]): void {
    console.error(PREFIX, ...args);
  },
  notice(message: string): void {
    if (notificationsEnabled) new Notice(`${PREFIX} ${message}`);
  },
};
