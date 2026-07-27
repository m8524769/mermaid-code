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
  const { open } = await import('@tauri-apps/plugin-dialog');
  const { readTextFile } = await import('@tauri-apps/plugin-fs');

  const path = await open({
    filters: [{ name: 'Mermaid', extensions: ['mmd', 'mermaid'] }],
    multiple: false
  });
  if (!path) return null;

  const code = await readTextFile(path as string);
  const name = (path as string).split(/[/\\]/).pop() ?? 'file';
  return { handle: { path: path as string, name }, code };
};

export const saveFile = async (
  handle: FileHandle & { _fsHandle?: any },
  content: string
): Promise<boolean> => {
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');
  await writeTextFile(handle.path, content);
  return true;
};

export const saveFileAs = async (
  content: string,
  defaultName = 'diagram.mmd'
): Promise<FileHandle | null> => {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');

  const path = await save({
    defaultPath: defaultName,
    filters: [{ name: 'Mermaid', extensions: ['mmd', 'md', 'txt'] }]
  });
  if (!path) return null;

  await writeTextFile(path, content);
  const name = path.split(/[/\\]/).pop() ?? defaultName;
  return { path, name };
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
  const { readDir: tauriReadDir } = await import('@tauri-apps/plugin-fs');
  const entries = await tauriReadDir(path);
  return entries.map((e) => ({
    name: e.name,
    path: `${path}${path.includes('\\') ? '\\' : '/'}${e.name}`,
    isDirectory: e.isDirectory,
    isFile: e.isFile
  }));
};

export const rename = async (oldPath: string, newPath: string): Promise<void> => {
  const { rename: tauriRename } = await import('@tauri-apps/plugin-fs');
  await tauriRename(oldPath, newPath);
};

export const deleteNode = async (path: string, isDir: boolean): Promise<void> => {
  const { remove } = await import('@tauri-apps/plugin-fs');
  await remove(path, { recursive: isDir });
};

export const createFile = async (path: string): Promise<void> => {
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');
  await writeTextFile(path, '');
};

export const createDir = async (path: string): Promise<void> => {
  const { mkdir } = await import('@tauri-apps/plugin-fs');
  await mkdir(path, { recursive: true });
};

export const watchFolder = async (
  path: string,
  cb: (event: WatchEvent) => void
): Promise<() => void> => {
  const { watch } = await import('@tauri-apps/plugin-fs');
  const unwatch = await watch(path, cb, { recursive: false, delayMs: 500 });
  return unwatch;
};

export const openFolderDialog = async (): Promise<string | null> => {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({ directory: true, multiple: false });
  return typeof result === 'string' ? result : null;
};

export const writeTextFile = async (path: string, content: string): Promise<void> => {
  const { writeTextFile: tauriWrite } = await import('@tauri-apps/plugin-fs');
  await tauriWrite(path, content);
};

export const readTextFile = async (path: string): Promise<string> => {
  const { readTextFile: tauriRead } = await import('@tauri-apps/plugin-fs');
  return tauriRead(path);
};

export const confirmDialog = async (message: string): Promise<boolean> => {
  const { confirm } = await import('@tauri-apps/plugin-dialog');
  return confirm(message);
};
