import type { Update } from '@tauri-apps/plugin-updater';

let pendingVersion = $state<string | null>(null);
let pendingUpdate: Update | null = null;
let isLatest = $state(false);

export const updateState = {
  get pendingVersion() {
    return pendingVersion;
  },
  get isLatest() {
    return isLatest;
  },
  set(version: string, update: Update) {
    pendingVersion = version;
    pendingUpdate = update;
    isLatest = false;
  },
  setLatest() {
    isLatest = true;
  },
  clear() {
    pendingVersion = null;
    pendingUpdate = null;
  },
  async install(onStart: () => void): Promise<void> {
    if (!pendingUpdate) return;
    onStart();
    await pendingUpdate.downloadAndInstall();
    updateState.clear();
  }
};
