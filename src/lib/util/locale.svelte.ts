import {
  getLocale as pgGetLocale,
  setLocale as pgSetLocale,
  overwriteGetLocale,
  locales,
  baseLocale
} from '$/paraglide/runtime';

export { locales, baseLocale };

export type Locale = (typeof locales)[number];

// Reactive mirror of the active locale. Routing Paraglide's getLocale through
// this $state makes every m.*() call re-render on switch — no page reload needed.
let current = $state<Locale>(pgGetLocale());
overwriteGetLocale(() => current);

export function getAppLocale(): Locale {
  return current;
}

const LOCALE_FILE = 'locale.json';

/**
 * Persist the current locale to appConfigDir so the Rust side can read it at
 * startup and localize the native menu / dialogs. Paraglide persists the locale
 * in localStorage, which Rust cannot read — this file is the bridge. No-op
 * outside Tauri (e.g. dev in a plain browser).
 */
async function writeLocaleFile(locale: string): Promise<void> {
  try {
    const { appConfigDir, join } = await import('@tauri-apps/api/path');
    const { writeTextFile, mkdir, exists } = await import('@tauri-apps/plugin-fs');
    const dir = await appConfigDir();
    if (!(await exists(dir))) await mkdir(dir, { recursive: true });
    await writeTextFile(await join(dir, LOCALE_FILE), JSON.stringify({ locale }));
  } catch {
    // Non-Tauri context or fs unavailable — the native side falls back to the OS locale.
  }
}

/**
 * Switch the app locale without reloading the page (Tauri SPA). Updates the
 * reactive rune (live re-render), persists via Paraglide's localStorage
 * strategy, and mirrors the value to the Rust-readable file. The native menu
 * picks up the change on next launch.
 */
export function setAppLocale(locale: Locale): void {
  pgSetLocale(locale, { reload: false });
  current = locale;
  void writeLocaleFile(locale);
}

/**
 * Write the resolved locale to the file once at startup, so the native side has
 * a value even if the user never switches language.
 */
export function initLocale(): void {
  void writeLocaleFile(current);
}
