import { v4 as uuidV4 } from 'uuid';
import { thumbnailCache } from '$/util/thumbnailState.svelte';
import {
  confirmDialog,
  createDir as fsCreateDir,
  createFile as fsCreateFile,
  deleteNode as fsDeleteNode,
  openFolderDialog,
  readDir,
  readTextFile,
  rename as fsRename,
  saveFileAs,
  watchFolder,
  writeTextFile
} from '$/util/fileSystem';
import { notify } from '$/util/notify';
import { inputState, updateCode, updateCodeStore } from '$/util/state.svelte';
import { readJSON, writeJSON } from '$/util/persist.svelte';
import debounce from 'lodash-es/debounce';

// Cross-platform path join: works on both Unix (/) and Windows (\)
const joinPath = (...parts: string[]): string => {
  const sep = parts[0]?.includes('\\') ? '\\' : '/';
  return parts
    .map((p, i) => (i > 0 ? p.replace(/^[/\\]+/, '') : p))
    .join(sep)
    .replace(/[/\\]+$/, '');
};

const pathBasename = (p: string): string => {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p;
};

const pathDirname = (p: string): string => {
  const parts = p.split(/[/\\]/);
  parts.pop();
  return parts.join(p.includes('\\') ? '\\' : '/') || (p.includes('\\') ? '\\' : '/');
};

export interface Tab {
  id: string;
  path: string;
  name: string;
  code: string;
  savedCode: string;
  isDirty: boolean;
  isDraft?: boolean;
  pan?: { x: number; y: number };
  zoom?: number;
}

export interface FileTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: FileTreeNode[];
  expanded: boolean;
  loaded: boolean;
}

const buildNode = (name: string, path: string, isDir: boolean): FileTreeNode => ({
  name,
  path,
  isDir,
  children: [],
  expanded: false,
  loaded: false
});

const sortNodes = (nodes: FileTreeNode[]): FileTreeNode[] =>
  [...nodes].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

// Directories that are too large or irrelevant to watch/display
export const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.svelte-kit',
  'dist',
  'build',
  'target',
  '.cache',
  '__pycache__',
  '.venv',
  'venv',
  '.next',
  '.nuxt',
  'coverage',
  '.yarn',
  '.idea',
  '.vscode',
  '.claude',
  '.github',
  'out',
  '.turbo',
  '.nx',
  '.gradle',
  '.maven',
  '.terraform'
]);

const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

const filterEntries = <T extends { name: string; isDir?: boolean; isDirectory?: boolean }>(
  entries: T[]
): T[] =>
  entries.filter((e) => {
    const isDir = 'isDir' in e ? e.isDir : e.isDirectory;
    if (isDir) return !IGNORED_DIRS.has(e.name);
    return !IGNORED_FILES.has(e.name);
  });

const DRAFT_TAB_ID = 'draft';
const DRAFT_TAB_PATH = '__draft__';

const makeDraftTab = (): Tab => ({
  id: DRAFT_TAB_ID,
  path: DRAFT_TAB_PATH,
  name: 'Draft',
  code: '',
  savedCode: '',
  isDirty: false,
  isDraft: true
});

const LAST_FOLDER_KEY = 'mermaid-last-folder';
const FOLDER_TABS_PREFIX = 'mermaid-tabs:';
const RECENT_FOLDERS_KEY = 'mermaid-recent-folders';
const RECENT_FILES_KEY = 'mermaid-recent-files';
const RECENT_FOLDERS_MAX = 8;
const RECENT_FILES_MAX = 8;

let tabs = $state<Tab[]>([makeDraftTab()]);
let activeTabId = $state<string | null>(DRAFT_TAB_ID);
let rootPath = $state<string | null>(null);
let tree = $state<FileTreeNode[]>([]);
let recentFolders = $state<string[]>(readJSON(RECENT_FOLDERS_KEY, []));
let recentFiles = $state<string[]>(readJSON(RECENT_FILES_KEY, []));
let isAutoSave = $state(localStorage.getItem('mermaid-autosave') !== 'false');
// Map of watched path → unwatch function; only visible directories are watched
let watchMap = new Map<string, () => void>();

const saveRecentFolder = (path: string): void => {
  const recent = readJSON<string[]>(RECENT_FOLDERS_KEY, []).filter((p: string) => p !== path);
  recent.unshift(path);
  const trimmed = recent.slice(0, RECENT_FOLDERS_MAX);
  writeJSON(RECENT_FOLDERS_KEY, trimmed);
  recentFolders = trimmed;
  syncRecent(trimmed, recentFiles);
};

const saveRecentFile = (path: string): void => {
  const recent = readJSON<string[]>(RECENT_FILES_KEY, []).filter((p: string) => p !== path);
  recent.unshift(path);
  const trimmed = recent.slice(0, RECENT_FILES_MAX);
  writeJSON(RECENT_FILES_KEY, trimmed);
  recentFiles = trimmed;
  syncRecent(recentFolders, trimmed);
};

const syncRecent = (folders: string[], files: string[]): void => {
  void import('@tauri-apps/api/core').then(({ invoke }) =>
    invoke('update_recent', { folders, files })
  );
};

// Watch a single directory (non-recursive) and store the unwatch fn
const watchDir = async (path: string): Promise<void> => {
  if (watchMap.has(path)) return;
  const unwatch = await watchFolder(path, (event) => void handleWatchEvent(event));
  watchMap.set(path, unwatch);
};

// Unwatch a directory
const unwatchDir = (path: string): void => {
  watchMap.get(path)?.();
  watchMap.delete(path);
};

interface PersistedTabs {
  paths: string[];
  activePath: string | null;
}

const tabsStorageKey = (folder: string) => `${FOLDER_TABS_PREFIX}${folder}`;

const saveTabsToStorage = (): void => {
  const key = rootPath ?? pathDirname(tabs.find((t) => !t.isDraft)?.path ?? '');
  if (!key) return;
  const data: PersistedTabs = {
    paths: tabs.filter((t) => !t.isDraft).map((t) => t.path),
    activePath: tabs.find((t) => t.id === activeTabId && !t.isDraft)?.path ?? null
  };
  localStorage.setItem(tabsStorageKey(key), JSON.stringify(data));
};

const openFolderPath = async (path: string): Promise<void> => {
  // Save current tabs before switching
  saveTabsToStorage();

  fileState.stopWatching();
  // Preserve draft tab if it has content; close all other tabs
  const draftTab = tabs.find((t) => t.isDraft);
  const keepDraft = draftTab && draftTab.code.trim() !== '';
  tabs = keepDraft ? [draftTab!] : [makeDraftTab()];
  activeTabId = tabs[0].id;
  updateCode(tabs[0].code, { updateDiagram: true });

  rootPath = path;
  localStorage.setItem(LAST_FOLDER_KEY, path);
  saveRecentFolder(path);
  const entries = await readDir(path);
  tree = sortNodes(filterEntries(entries).map((e) => buildNode(e.name, e.path, e.isDirectory)));
  // Watch only the root directory (non-recursive); expanded subdirs are watched in toggleDir
  await watchDir(path);

  // Restore tabs for this folder
  const raw = localStorage.getItem(tabsStorageKey(path));
  if (!raw) return;
  try {
    const { paths, activePath } = JSON.parse(raw) as PersistedTabs;
    for (const p of paths) {
      await fileState.openFile(p, { recordRecent: false });
    }
    const activeTab = tabs.find((t) => t.path === activePath);
    if (activeTab) fileState.switchTab(activeTab.id);
  } catch {
    localStorage.removeItem(tabsStorageKey(path));
  }
};

const loadChildren = async (node: FileTreeNode): Promise<void> => {
  const entries = await readDir(node.path);
  node.children = sortNodes(
    filterEntries(entries).map((e) => buildNode(e.name, e.path, e.isDirectory))
  );
  node.loaded = true;
};

const findNode = (nodes: FileTreeNode[], path: string): FileTreeNode | null => {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (n.isDir && n.children.length > 0) {
      const found = findNode(n.children, path);
      if (found) return found;
    }
  }
  return null;
};

const refreshNodeChildren = async (node: FileTreeNode): Promise<void> => {
  if (!node.isDir || !node.expanded) return;
  const entries = await readDir(node.path);
  const newChildren = sortNodes(
    filterEntries(entries).map((e) => buildNode(e.name, e.path, e.isDirectory))
  );
  // Preserve expanded state of children that still exist
  for (const newChild of newChildren) {
    const old = node.children.find((c) => c.path === newChild.path);
    if (old) {
      newChild.expanded = old.expanded;
      newChild.loaded = old.loaded;
      newChild.children = old.children;
    }
  }
  node.children = newChildren;
  node.loaded = true;
  // Recurse into still-expanded children
  await Promise.all(newChildren.filter((c) => c.expanded).map(refreshNodeChildren));
};

const refreshTree = async (): Promise<void> => {
  if (!rootPath) return;
  const entries = await readDir(rootPath);
  const newRoot = sortNodes(
    filterEntries(entries).map((e) => buildNode(e.name, e.path, e.isDirectory))
  );
  // Preserve expanded state from current tree
  for (const newNode of newRoot) {
    const old = tree.find((n) => n.path === newNode.path);
    if (old) {
      newNode.expanded = old.expanded;
      newNode.loaded = old.loaded;
      newNode.children = old.children;
    }
  }
  // Reload expanded subdirs
  await Promise.all(newRoot.filter((n) => n.expanded).map(refreshNodeChildren));
  tree = newRoot;
};

// Debounce tree refresh: prevents dozens of refreshTree calls per second
// when watching large directories (e.g. ~/Src with node_modules)
const debouncedRefreshTree = debounce(() => void refreshTree(), 1000);

export const fileState = {
  get tabs() {
    return tabs;
  },
  get activeTabId() {
    return activeTabId;
  },
  get rootPath() {
    return rootPath;
  },
  get tree() {
    return tree;
  },
  get recentFolders() {
    return recentFolders;
  },
  get recentFiles() {
    return recentFiles;
  },
  get isAutoSave() {
    return isAutoSave;
  },

  async openFolder(): Promise<void> {
    const dirtyTabs = tabs.filter((t) => !t.isDraft && t.isDirty);
    if (dirtyTabs.length > 0) {
      const names = dirtyTabs.map((t) => t.name).join(', ');
      const save = await confirmDialog(
        `Unsaved changes in: ${names}\n\nSave all before switching?`
      );
      if (save) {
        await Promise.all(dirtyTabs.map((t) => fileState.saveTab(t.id, { silent: true })));
      }
    }
    const path = await openFolderDialog();
    if (!path || path === rootPath) return;
    await openFolderPath(path);
  },

  async openFolderByPath(path: string): Promise<void> {
    if (path === rootPath) return;
    const dirtyTabs = tabs.filter((t) => !t.isDraft && t.isDirty);
    if (dirtyTabs.length > 0) {
      const names = dirtyTabs.map((t) => t.name).join(', ');
      const save = await confirmDialog(
        `Unsaved changes in: ${names}\n\nSave all before switching?`
      );
      if (save) {
        await Promise.all(dirtyTabs.map((t) => fileState.saveTab(t.id, { silent: true })));
      }
    }
    await openFolderPath(path);
  },

  async restoreLastFolder(): Promise<void> {
    const folderPath = localStorage.getItem(LAST_FOLDER_KEY);
    if (!folderPath) return;
    try {
      await openFolderPath(folderPath);
    } catch {
      localStorage.removeItem(LAST_FOLDER_KEY);
    }
  },

  async openFile(
    path: string,
    { recordRecent = true }: { recordRecent?: boolean } = {}
  ): Promise<void> {
    // Switch to existing tab if already open
    const existing = tabs.find((t) => t.path === path);
    if (existing) {
      fileState.switchTab(existing.id);
      return;
    }
    // Only open text-based files
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const supported = ['mmd', 'mermaid'];
    if (!supported.includes(ext)) {
      notify(`Cannot edit this file type: .${ext}`);
      return;
    }
    let code = '';
    try {
      code = await readTextFile(path);
    } catch {
      notify(`Failed to read file: ${pathBasename(path)}`);
      return;
    }
    const name = pathBasename(path);
    const tab: Tab = { id: uuidV4(), path, name, code, savedCode: code, isDirty: false };
    // Remove empty draft tab when opening a real file
    const draftTab = tabs.find((t) => t.isDraft);
    if (draftTab && !draftTab.code.trim()) {
      tabs = tabs.filter((t) => !t.isDraft);
    }
    tabs = [...tabs, tab];
    fileState.switchTab(tab.id);
    saveTabsToStorage();
    if (recordRecent) saveRecentFile(path);
    // Watch the file's parent directory if not already watched (covers subdirs in grid view)
    const dir = pathDirname(path);
    if (dir && dir !== rootPath) await watchDir(dir);
  },

  async closeTab(id: string): Promise<void> {
    const tab = tabs.find((t) => t.id === id);
    if (!tab || tab.isDraft) return;
    if (tab.isDirty) {
      const confirmed = await confirmDialog(
        `"${tab.name}" has unsaved changes. Close without saving?`
      );
      if (!confirmed) return;
    }
    const idx = tabs.findIndex((t) => t.id === id);
    tabs = tabs.filter((t) => t.id !== id);
    // Restore Draft tab only when all real file tabs are closed
    const hasRealTabs = tabs.some((t) => !t.isDraft);
    if (!hasRealTabs && !tabs.some((t) => t.isDraft)) {
      tabs = [makeDraftTab()];
    }
    if (activeTabId === id) {
      const next = tabs[idx] ?? tabs[idx - 1] ?? tabs[0] ?? null;
      if (next) {
        fileState.switchTab(next.id);
      } else {
        activeTabId = null;
        updateCode('', { updateDiagram: true });
      }
    }
    saveTabsToStorage();
  },

  switchTab(id: string): void {
    // Save current tab's pan/zoom before switching
    const currentTab = tabs.find((t) => t.id === activeTabId);
    if (currentTab) {
      currentTab.pan = inputState.pan;
      currentTab.zoom = inputState.zoom;
    }

    activeTabId = id;
    const tab = tabs.find((t) => t.id === id);
    if (tab) {
      updateCode(tab.code, { updateDiagram: true, resetPanZoom: true });
      // Restore this tab's pan/zoom if it has one
      if (tab.pan !== undefined || tab.zoom !== undefined) {
        updateCodeStore({ pan: tab.pan, zoom: tab.zoom });
      }
    }
    saveTabsToStorage();
  },

  updateTabCode(id: string, code: string): void {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    tab.code = code;
    tab.isDirty = tab.isDraft ? code.trim() !== '' : code !== tab.savedCode;
  },

  async saveTab(id: string, { silent = false }: { silent?: boolean } = {}): Promise<void> {
    const tab = tabs.find((t) => t.id === id);
    if (!tab || tab.isDraft) return;
    const snapshot = tab.code;
    try {
      await writeTextFile(tab.path, snapshot);
      tab.savedCode = snapshot;
      tab.isDirty = tab.code !== snapshot;
      if (!silent) notify(`Saved: ${tab.name}`);
    } catch {
      notify(`Failed to save: ${tab.name}`);
    }
  },

  async saveAllTabs(): Promise<void> {
    await Promise.all(
      tabs.filter((t) => t.isDirty).map((t) => fileState.saveTab(t.id, { silent: true }))
    );
  },

  async createFile(dirPath: string): Promise<void> {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
    const name = `Diagram ${date} at ${time}.mmd`;
    const path = joinPath(dirPath, name);
    try {
      await fsCreateFile(path);
      thumbnailCache.setLastCreated(path);
      await refreshTree();
      // Expand the target directory so the new file is visible
      const node = findNode(tree, dirPath);
      if (node && node.isDir && !node.expanded) {
        await fileState.toggleDir(dirPath);
      }
      await fileState.openFile(path, { recordRecent: false });
    } catch {
      notify(`Failed to create file in ${pathBasename(dirPath)}`);
    }
  },

  async createDir(dirPath: string): Promise<void> {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
    const name = `New Folder ${date} at ${time}`;
    const path = joinPath(dirPath, name);
    try {
      await fsCreateDir(path);
      await refreshTree();
      // Expand the parent directory so the new folder is visible
      const node = findNode(tree, dirPath);
      if (node && node.isDir && !node.expanded) {
        await fileState.toggleDir(dirPath);
      }
    } catch {
      notify(`Failed to create folder`);
    }
  },

  async renameNode(oldPath: string, newName: string): Promise<void> {
    const dir = pathDirname(oldPath);
    const newPath = joinPath(dir, newName);
    const sep = oldPath.includes('\\') ? '\\' : '/';
    const oldPrefix = oldPath + sep;
    const newPrefix = newPath + sep;
    try {
      await fsRename(oldPath, newPath);
      // Update exact match (file rename) and prefix match (folder rename — update child tabs)
      tabs = tabs.map((t) => {
        if (t.path === oldPath) return { ...t, path: newPath, name: newName };
        if (t.path.startsWith(oldPrefix)) {
          const newTabPath = newPrefix + t.path.slice(oldPrefix.length);
          return { ...t, path: newTabPath };
        }
        return t;
      });
      // Re-register watchers for renamed paths
      for (const [watchedPath, unwatch] of watchMap.entries()) {
        if (watchedPath === oldPath || watchedPath.startsWith(oldPrefix)) {
          unwatch();
          watchMap.delete(watchedPath);
          const updatedPath =
            watchedPath === oldPath ? newPath : newPrefix + watchedPath.slice(oldPrefix.length);
          await watchDir(updatedPath);
        }
      }
      // Clear lastCreated so no file gets pinned to top after a rename
      thumbnailCache.setLastCreated('');
      await refreshTree();
    } catch {
      notify(`Failed to rename`);
    }
  },

  async deleteNode(path: string, isDir: boolean): Promise<void> {
    const name = pathBasename(path);
    const confirmed = await confirmDialog(
      `Delete "${name}"${isDir ? ' and all its contents' : ''}? This cannot be undone.`
    );
    if (!confirmed) return;
    try {
      await fsDeleteNode(path, isDir);
      const sep = path.includes('\\') ? '\\' : '/';
      // Close all tabs whose path starts with this path
      const toClose = isDir
        ? tabs.filter((t) => t.path.startsWith(path + sep) || t.path === path)
        : tabs.filter((t) => t.path === path);
      for (const tab of toClose) {
        tabs = tabs.filter((t) => t.id !== tab.id);
      }
      // Restore Draft tab only when all real file tabs are closed
      if (!tabs.some((t) => !t.isDraft) && !tabs.some((t) => t.isDraft)) {
        tabs = [makeDraftTab()];
      }
      if (toClose.some((t) => t.id === activeTabId)) {
        activeTabId = tabs[0]?.id ?? null;
        if (activeTabId) fileState.switchTab(activeTabId);
        else updateCode('', { updateDiagram: true });
      }
      await refreshTree();
    } catch {
      notify(`Failed to delete "${name}"`);
    }
  },

  async toggleDir(path: string): Promise<void> {
    const node = findNode(tree, path);
    if (!node || !node.isDir) return;
    node.expanded = !node.expanded;
    if (node.expanded) {
      if (!node.loaded) await loadChildren(node);
      await watchDir(path);
    } else {
      unwatchDir(path);
    }
    tree = [...tree]; // trigger reactivity
  },

  toggleAutoSave(): void {
    isAutoSave = !isAutoSave;
    localStorage.setItem('mermaid-autosave', String(isAutoSave));
  },

  stopWatching(): void {
    for (const fn of watchMap.values()) fn();
    watchMap.clear();
  },

  /** Clear the draft tab content after saving. */
  clearDraft(): void {
    const draft = tabs.find((t) => t.isDraft);
    if (!draft) return;
    draft.code = '';
    draft.savedCode = '';
    draft.isDirty = false;
  },

  /** Save draft tab as a new file via Save As dialog. */
  async saveDraft(): Promise<void> {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
    const defaultName = `Diagram ${date} at ${time}.mmd`;
    const code = tabs.find((t) => t.isDraft)?.code ?? inputState.code;
    const handle = await saveFileAs(code, defaultName);
    if (handle) {
      fileState.clearDraft();
      await fileState.openFile(handle.path);
    }
  },

  /** Set draft tab content (used by MCP preview). */
  setDraftCode(code: string): void {
    let draft = tabs.find((t) => t.isDraft);
    if (!draft) {
      draft = makeDraftTab();
      tabs = [draft, ...tabs];
    }
    draft.code = code;
    draft.isDirty = code.trim() !== '';
    fileState.switchTab(draft.id);
  }
};

// Auto-save is triggered from FileSidebar.svelte via fileState.autoSaveTick()
// to ensure it runs inside a proper Svelte component effect context.
export const autoSaveTick = (): (() => void) => {
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  if (!isAutoSave || !activeTab?.isDirty || activeTab.isDraft) return () => {};
  const id = activeTab.id;
  const timer = setTimeout(() => {
    void fileState.saveTab(id, { silent: true });
  }, 2000);
  return () => clearTimeout(timer);
};

const handleWatchEvent = async (event: import('$/util/fileSystem').WatchEvent): Promise<void> => {
  // Debounced tree refresh — only refresh for paths relevant to open tabs
  debouncedRefreshTree();
  // Check if any open tab was affected
  const kind = event.type;
  if (typeof kind === 'object' && 'modify' in kind) {
    // File content changed externally
    for (const p of event.paths) {
      const tab = tabs.find((t) => t.path === p);
      if (!tab) continue;
      if (tab.isDirty) {
        // Read the new file content to check if it's our own save
        try {
          const newCode = await readTextFile(p);
          // If the file now matches savedCode, it was written by autoSave — ignore
          if (newCode === tab.savedCode) continue;
        } catch {
          continue;
        }
        notify(`"${tab.name}" was modified externally but has unsaved changes`);
      } else {
        try {
          const code = await readTextFile(p);
          tab.code = code;
          tab.savedCode = code;
          tab.isDirty = false;
          if (tab.id === activeTabId) {
            updateCode(code, { updateDiagram: true });
          }
        } catch {}
      }
      thumbnailCache.invalidate(p);
    }
  }
  if (typeof kind === 'object' && 'remove' in kind) {
    for (const p of event.paths) {
      // Match tabs whose path equals the removed path OR is inside a removed directory
      const affected = tabs.filter(
        (t) => t.path === p || t.path.startsWith(p + '/') || t.path.startsWith(p + '\\')
      );
      for (const tab of affected) {
        notify(`"${tab.name}" was deleted externally`);
        tabs = tabs.filter((t) => t.id !== tab.id);
        if (activeTabId === tab.id) {
          const next = tabs[0] ?? null;
          activeTabId = next?.id ?? null;
          if (next) {
            updateCode(next.code, { updateDiagram: true });
          } else {
            updateCode('', { updateDiagram: true });
          }
        }
      }
      thumbnailCache.invalidate(p);
    }
  }
};
