import type { Update } from '@tauri-apps/plugin-updater';

let pendingVersion = $state<string | null>(null);
let pendingUpdate: Update | null = null;
let isLatest = $state(false);
let downloadProgress = $state<number | null>(null); // null = not downloading, 0-100 = downloading, 101 = ready to install
let downloadedBytes = $state(0);

export const updateState = {
  get pendingVersion() {
    return pendingVersion;
  },
  get isLatest() {
    return isLatest;
  },
  get downloadProgress() {
    return downloadProgress;
  },

  set(version: string, update: Update) {
    pendingVersion = version;
    pendingUpdate = update;
    isLatest = false;
    downloadProgress = null;
    downloadedBytes = 0;
  },
  setLatest() {
    isLatest = true;
  },
  clear() {
    pendingVersion = null;
    pendingUpdate = null;
    downloadProgress = null;
    downloadedBytes = 0;
  },
  async download(): Promise<void> {
    if (!pendingUpdate || downloadProgress !== null) return;
    downloadProgress = 0;
    downloadedBytes = 0;
    let total = 0;
    await pendingUpdate.download((event) => {
      if (event.event === 'Started') {
        total = event.data.contentLength ?? 0;
      } else if (event.event === 'Progress') {
        downloadedBytes += event.data.chunkLength;
        downloadProgress =
          total > 0 ? Math.min(Math.round((downloadedBytes / total) * 100), 100) : 0;
      } else if (event.event === 'Finished') {
        downloadProgress = 101; // ready to install
      }
    });
  },
  async installDownloaded(): Promise<void> {
    if (!pendingUpdate || downloadProgress !== 101) return;
    await pendingUpdate.install();
    // On macOS, install() doesn't relaunch automatically — do it manually
    const { platform } = await import('@tauri-apps/plugin-os');
    if ((await platform()) === 'macos') {
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    }
    updateState.clear();
  }
};
