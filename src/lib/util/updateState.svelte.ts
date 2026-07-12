import type { Update } from '@tauri-apps/plugin-updater';

let pendingVersion = $state<string | null>(null);
let pendingUpdate: Update | null = null;

export const updateState = {
  get pendingVersion() {
    return pendingVersion;
  },
  set(version: string, update: Update) {
    pendingVersion = version;
    pendingUpdate = update;
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
