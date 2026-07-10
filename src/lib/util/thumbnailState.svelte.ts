interface ThumbnailEntry {
  svg: string;
  code: string;
}

const cache = new Map<string, ThumbnailEntry>();
let cacheVersion = $state(0);
let lastCreatedPath = $state<string | null>(null);

export const thumbnailCache = {
  get version() {
    return cacheVersion;
  },
  get lastCreated() {
    return lastCreatedPath;
  },
  setLastCreated(path: string) {
    lastCreatedPath = path;
  },
  get(path: string): ThumbnailEntry | undefined {
    // Read cacheVersion so any reactive context calling get() tracks cache changes
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    cacheVersion;
    return cache.get(path);
  },
  set(path: string, entry: ThumbnailEntry): void {
    cache.set(path, entry);
    cacheVersion++;
  },
  invalidate(path: string): void {
    cache.delete(path);
    cacheVersion++;
  },
  invalidateAll(): void {
    cache.clear();
    cacheVersion++;
  }
};
