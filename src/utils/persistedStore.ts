// Generic localStorage-backed store for the mock service layer, so state
// (submissions, approvals, appraisals...) survives a page refresh instead
// of resetting to seed data every time.
//
// One real limitation: uploaded `File` objects are not JSON-serializable,
// so they're stripped before saving. After a reload, the record still shows
// its attachment name/upload date, but the original file bytes are gone —
// "Download document" won't be available for attachments uploaded in a
// previous session. A real backend would store the file itself and this
// limitation disappears.

export function loadStore<T>(key: string, seed: T[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T[];
  } catch {
    // corrupted/old data — fall back to seed
  }
  return seed;
}

export function saveStore<T extends object>(key: string, data: T[]) {
  try {
    const serializable = data.map((item) => {
      const { attachmentFile: _attachmentFile, ...rest } = item as T & { attachmentFile?: unknown };
      return rest;
    });
    localStorage.setItem(key, JSON.stringify(serializable));
  } catch {
    // storage full or unavailable — state just won't persist this time
  }
}
