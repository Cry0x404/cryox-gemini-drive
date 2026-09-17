export const STORAGE_MARKER = '[CRYOX_GEMINI_DRIVE_FILE_V1]';

const TOKEN_RE = /[A-Za-z0-9_-]{20,16384}/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME_RE = /^[\w.+-]+\/[\w.+-]+$/i;

function cleanName(value) {
  return String(value || '')
    .replace(/[\\/\x00-\x1f\x7f]+/g, '_')
    .trim()
    .slice(0, 180);
}

export function normalizeVaultRecord(value) {
  if (!value || typeof value !== 'object') return null;

  const id = String(value.id || '').trim();
  const name = cleanName(value.name);
  const handle = String(value.handle || '').trim().slice(0, 8192);
  const size = Number(value.size);
  const uploadedAt = Number(value.uploadedAt);
  const type = String(value.type || 'application/octet-stream').trim().slice(0, 120);
  const conversationId = String(value.conversationId || '').trim().slice(0, 512);
  const vaultName = cleanName(value.vaultName || '');
  const storageFormat = String(value.storageFormat || '').trim().slice(0, 64);
  const envelopeSize = Number(value.envelopeSize || 0);

  if (!UUID_RE.test(id) || !name || !handle) return null;
  if (!Number.isFinite(size) || size < 0) return null;
  if (!Number.isFinite(uploadedAt) || uploadedAt < 0) return null;
  if (!MIME_RE.test(type)) return null;
  if (envelopeSize && (!Number.isFinite(envelopeSize) || envelopeSize < 0)) return null;

  return {
    id,
    name,
    handle,
    size,
    uploadedAt,
    type,
    ...(conversationId ? { conversationId } : {}),
    ...(vaultName ? { vaultName } : {}),
    ...(storageFormat ? { storageFormat } : {}),
    ...(envelopeSize ? { envelopeSize } : {}),
  };
}

export function encodeVaultRecord(record) {
  const normalized = normalizeVaultRecord(record);
  if (!normalized) throw new TypeError('Vault record is invalid.');
  return Buffer.from(JSON.stringify(normalized), 'utf8').toString('base64url');
}

export function decodeVaultRecord(text) {
  const source = String(text || '');
  const index = source.indexOf(STORAGE_MARKER);
  if (index < 0) return null;

  const tail = source.slice(index + STORAGE_MARKER.length).trim();
  const token = (tail.match(TOKEN_RE) || [])[0];
  if (!token) return null;

  try {
    return normalizeVaultRecord(JSON.parse(Buffer.from(token, 'base64url').toString('utf8')));
  } catch {
    return null;
  }
}
