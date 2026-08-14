const crypto = require('node:crypto');

const ALLOWED_KINDS = new Set(['profile-directory', 'profile-executable']);

class PathSelectionRegistry {
  constructor(options = {}) {
    this.now = options.now || (() => Date.now());
    this.randomUUID = options.randomUUID || crypto.randomUUID;
    this.ttlMs = Math.max(30_000, Math.min(Number(options.ttlMs) || 5 * 60_000, 30 * 60_000));
    this.maxEntries = Math.max(4, Math.min(Number(options.maxEntries) || 32, 128));
    this.entries = new Map();
  }

  issue(input = {}) {
    this.prune();
    const kind = String(input.kind || '');
    const selectedPath = String(input.path || '').trim();
    if (!ALLOWED_KINDS.has(kind)) throw new Error('path-selection-kind-invalid');
    if (!selectedPath || selectedPath.includes('\0')) throw new Error('path-selection-invalid');
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      this.entries.delete(oldest);
    }
    const selectionId = this.randomUUID();
    this.entries.set(selectionId, {
      selectionId,
      kind,
      path: selectedPath,
      expiresAt: this.now() + this.ttlMs
    });
    return { selectionId, displayPath: selectedPath };
  }

  resolve(selectionId, expectedKind) {
    this.prune();
    const id = String(selectionId || '').trim();
    const entry = this.entries.get(id);
    if (!entry) throw new Error('path-selection-expired');
    if (entry.kind !== expectedKind) throw new Error('path-selection-purpose-mismatch');
    return entry.path;
  }

  consume(selectionIds = []) {
    for (const value of new Set(selectionIds.map((item) => String(item || '').trim()).filter(Boolean))) {
      this.entries.delete(value);
    }
  }

  prune() {
    const now = this.now();
    for (const [selectionId, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(selectionId);
    }
  }
}

module.exports = { PathSelectionRegistry, ALLOWED_KINDS };
