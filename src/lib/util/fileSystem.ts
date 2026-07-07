export const isTauri = () => '__TAURI_INTERNALS__' in window;

export interface FileHandle {
  path: string;
  name: string;
}

export interface FileResult {
  handle: FileHandle;
  code: string;
  config?: string;
}

export const openFile = async (): Promise<FileResult | null> => {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');

    const path = await open({
      filters: [{ name: 'Mermaid', extensions: ['mmd', 'mermaid'] }],
      multiple: false
    });
    if (!path) return null;

    const code = await readTextFile(path as string);
    const name = (path as string).split('/').pop() ?? (path as string).split('\\').pop() ?? 'file';
    return { handle: { path: path as string, name }, code };
  }

  // Browser fallback via File System Access API or input[type=file]
  if ('showOpenFilePicker' in window) {
    const [handle] = await (window as any).showOpenFilePicker({
      types: [{ description: 'Mermaid', accept: { 'text/plain': ['.mmd', '.mermaid'] } }]
    });
    const file = await handle.getFile();
    const code = await file.text();
    return { handle: { path: handle.name, name: handle.name }, code, _fsHandle: handle } as any;
  }

  // Legacy fallback
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mmd,.mermaid';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      const code = await file.text();
      resolve({ handle: { path: file.name, name: file.name }, code });
    };
    input.click();
  });
};

export const saveFile = async (handle: FileHandle & { _fsHandle?: any }, content: string): Promise<boolean> => {
  if (isTauri()) {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(handle.path, content);
    return true;
  }

  if (handle._fsHandle) {
    const writable = await handle._fsHandle.createWritable();
    await writable.write(content);
    await writable.close();
    return true;
  }

  return false;
};

export const saveFileAs = async (content: string, defaultName = 'diagram.mmd'): Promise<FileHandle | null> => {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');

    const path = await save({
      defaultPath: defaultName,
      filters: [{ name: 'Mermaid', extensions: ['mmd', 'md', 'txt'] }]
    });
    if (!path) return null;

    await writeTextFile(path, content);
    const name = path.split('/').pop() ?? path.split('\\').pop() ?? defaultName;
    return { path, name };
  }

  if ('showSaveFilePicker' in window) {
    const handle = await (window as any).showSaveFilePicker({
      suggestedName: defaultName,
      types: [{ description: 'Mermaid', accept: { 'text/plain': ['.mmd'] } }]
    });
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    return { path: handle.name, name: handle.name, _fsHandle: handle } as any;
  }

  // Legacy download fallback
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultName;
  a.click();
  URL.revokeObjectURL(url);
  return null;
};

export const getRecentFiles = async (): Promise<FileHandle[]> => {
  const raw = localStorage.getItem('mermaid-recent-files');
  return raw ? (JSON.parse(raw) as FileHandle[]) : [];
};

export const addRecentFile = async (handle: FileHandle): Promise<void> => {
  const recent = await getRecentFiles();
  const filtered = recent.filter((f) => f.path !== handle.path);
  const updated = [handle, ...filtered].slice(0, 10);
  localStorage.setItem('mermaid-recent-files', JSON.stringify(updated));
};

import type { WatchEvent } from '@tauri-apps/plugin-fs';
export type { WatchEvent };

export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
}

export const readDir = async (path: string): Promise<DirEntry[]> => {
  if (!isTauri()) return [];
  const { readDir: tauriReadDir } = await import('@tauri-apps/plugin-fs');
  const entries = await tauriReadDir(path);
  return entries.map((e) => ({
    name: e.name,
    path: `${path}/${e.name}`,
    isDirectory: e.isDirectory,
    isFile: e.isFile
  }));
};

export const rename = async (oldPath: string, newPath: string): Promise<void> => {
  if (!isTauri()) return;
  const { rename: tauriRename } = await import('@tauri-apps/plugin-fs');
  await tauriRename(oldPath, newPath);
};

export const deleteNode = async (path: string, isDir: boolean): Promise<void> => {
  if (!isTauri()) return;
  const { remove } = await import('@tauri-apps/plugin-fs');
  await remove(path, { recursive: isDir });
};

export const createFile = async (path: string): Promise<void> => {
  if (!isTauri()) return;
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');
  await writeTextFile(path, '');
};

export const createDir = async (path: string): Promise<void> => {
  if (!isTauri()) return;
  const { mkdir } = await import('@tauri-apps/plugin-fs');
  await mkdir(path, { recursive: true });
};

export const watchFolder = async (
  path: string,
  cb: (event: WatchEvent) => void
): Promise<() => void> => {
  if (!isTauri()) return () => {};
  const { watch } = await import('@tauri-apps/plugin-fs');
  const unwatch = await watch(path, cb, { recursive: false, delayMs: 500 });
  return unwatch;
};

export const openFolderDialog = async (): Promise<string | null> => {
  if (!isTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({ directory: true, multiple: false });
  return typeof result === 'string' ? result : null;
};

export const writeTextFile = async (path: string, content: string): Promise<void> => {
  if (!isTauri()) return;
  const { writeTextFile: tauriWrite } = await import('@tauri-apps/plugin-fs');
  await tauriWrite(path, content);
};

export const readTextFile = async (path: string): Promise<string> => {
  if (!isTauri()) return '';
  const { readTextFile: tauriRead } = await import('@tauri-apps/plugin-fs');
  return tauriRead(path);
};

export const confirmDialog = async (message: string): Promise<boolean> => {
  if (isTauri()) {
    const { confirm } = await import('@tauri-apps/plugin-dialog');
    return confirm(message);
  }
  return window.confirm(message);
};
