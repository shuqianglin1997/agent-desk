const crypto = require('node:crypto');
const { normalizeInventory } = require('../domain/inventory');

const INVENTORY_CHUNK_SCHEMA_VERSION = 1;
const DEFAULT_CHUNK_BYTES = 192 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_CHUNKS = 128;

function encodeInventoryChunks(inventoryValue, options = {}) {
  const inventory = normalizeInventory(inventoryValue);
  const bytes = Buffer.from(JSON.stringify(inventory));
  if (bytes.length > MAX_TOTAL_BYTES) throw new Error('inventory-too-large');
  const chunkBytes = clampInteger(options.chunkBytes, 32 * 1024, 256 * 1024, DEFAULT_CHUNK_BYTES);
  const total = Math.max(1, Math.ceil(bytes.length / chunkBytes));
  if (total > MAX_CHUNKS) throw new Error('inventory-too-many-chunks');
  const transferId = String(options.transferId || crypto.randomUUID());
  const checksum = crypto.createHash('sha256').update(bytes).digest('base64url');
  const chunks = [];
  for (let index = 0; index < total; index += 1) {
    chunks.push({
      schemaVersion: INVENTORY_CHUNK_SCHEMA_VERSION,
      transferId,
      deviceId: inventory.deviceId,
      revision: inventory.revision,
      index,
      total,
      bytesTotal: bytes.length,
      checksum,
      data: bytes.subarray(index * chunkBytes, (index + 1) * chunkBytes).toString('base64url')
    });
  }
  return chunks;
}

class InventoryAssembler {
  constructor(options = {}) {
    this.maxTransfers = clampInteger(options.maxTransfers, 1, 32, 4);
    this.transfers = new Map();
  }

  accept(value) {
    const chunk = normalizeChunk(value);
    let transfer = this.transfers.get(chunk.transferId);
    if (!transfer) {
      while (this.transfers.size >= this.maxTransfers) this.transfers.delete(this.transfers.keys().next().value);
      transfer = {
        deviceId: chunk.deviceId,
        revision: chunk.revision,
        total: chunk.total,
        bytesTotal: chunk.bytesTotal,
        checksum: chunk.checksum,
        chunks: new Map()
      };
      this.transfers.set(chunk.transferId, transfer);
    }
    if (
      transfer.deviceId !== chunk.deviceId
      || transfer.revision !== chunk.revision
      || transfer.total !== chunk.total
      || transfer.bytesTotal !== chunk.bytesTotal
      || transfer.checksum !== chunk.checksum
    ) {
      this.transfers.delete(chunk.transferId);
      throw new Error('inventory-chunk-metadata-mismatch');
    }
    transfer.chunks.set(chunk.index, Buffer.from(chunk.data, 'base64url'));
    if (transfer.chunks.size !== transfer.total) {
      return { complete: false, transferId: chunk.transferId, index: chunk.index };
    }
    const buffers = [];
    for (let index = 0; index < transfer.total; index += 1) {
      const buffer = transfer.chunks.get(index);
      if (!buffer) return { complete: false, transferId: chunk.transferId, index: chunk.index };
      buffers.push(buffer);
    }
    const bytes = Buffer.concat(buffers);
    this.transfers.delete(chunk.transferId);
    if (bytes.length !== transfer.bytesTotal) throw new Error('inventory-chunk-size-mismatch');
    const checksum = crypto.createHash('sha256').update(bytes).digest('base64url');
    if (checksum !== transfer.checksum) throw new Error('inventory-chunk-checksum');
    let inventory;
    try { inventory = normalizeInventory(JSON.parse(bytes.toString('utf8'))); } catch (_error) {
      throw new Error('inventory-chunk-payload-invalid');
    }
    return { complete: true, transferId: chunk.transferId, index: chunk.index, inventory };
  }

  clear() {
    this.transfers.clear();
  }
}

function normalizeChunk(value = {}) {
  if (value.schemaVersion !== INVENTORY_CHUNK_SCHEMA_VERSION) throw new Error('inventory-chunk-version');
  const total = positiveInteger(value.total, 'total');
  if (total > MAX_CHUNKS) throw new Error('inventory-chunk-count');
  const index = nonNegativeInteger(value.index, 'index');
  if (index >= total) throw new Error('inventory-chunk-index');
  const bytesTotal = nonNegativeInteger(value.bytesTotal, 'bytesTotal');
  if (bytesTotal > MAX_TOTAL_BYTES) throw new Error('inventory-too-large');
  const data = String(value.data || '');
  if (!/^[A-Za-z0-9_-]*$/.test(data) || data.length > 400 * 1024) throw new Error('inventory-chunk-data');
  return {
    schemaVersion: INVENTORY_CHUNK_SCHEMA_VERSION,
    transferId: requiredText(value.transferId, 'transferId', 128),
    deviceId: requiredText(value.deviceId, 'deviceId', 128),
    revision: nonNegativeInteger(value.revision, 'revision'),
    index,
    total,
    bytesTotal,
    checksum: requiredText(value.checksum, 'checksum', 128),
    data
  };
}

function requiredText(value, field, limit) {
  const text = String(value || '').trim();
  if (!text) throw new TypeError(`${field} is required`);
  return text.slice(0, limit);
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new TypeError(`${field} is invalid`);
  return number;
}

function nonNegativeInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${field} is invalid`);
  return number;
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}

module.exports = {
  INVENTORY_CHUNK_SCHEMA_VERSION,
  DEFAULT_CHUNK_BYTES,
  MAX_TOTAL_BYTES,
  encodeInventoryChunks,
  InventoryAssembler,
  normalizeChunk
};
