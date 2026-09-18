import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { getVaultKey } from './vault-key.js';

const FORMAT_V1 = 'cryox-vault-v1';
const FORMAT_V2 = 'cryox-vault-v2';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let step = 0; step < 8; step += 1) {
      value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let value = 0xFFFFFFFF;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xFF] ^ (value >>> 8);
  return (value ^ 0xFFFFFFFF) >>> 0;
}

function zipStored(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.data);
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function unzipStored(buffer) {
  const entries = new Map();
  let endOffset = -1;
  const start = Math.max(0, buffer.length - 65557);

  for (let index = buffer.length - 22; index >= start; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      endOffset = index;
      break;
    }
  }

  if (endOffset < 0) throw new Error('Invalid Cryox vault archive.');

  const count = buffer.readUInt16LE(endOffset + 10);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  if (count > 16 || centralOffset >= buffer.length) throw new Error('Invalid Cryox vault directory.');

  let position = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (position + 46 > buffer.length || buffer.readUInt32LE(position) !== 0x02014b50) {
      throw new Error('Corrupt Cryox vault directory.');
    }

    const method = buffer.readUInt16LE(position + 10);
    const compressedSize = buffer.readUInt32LE(position + 20);
    const nameLength = buffer.readUInt16LE(position + 28);
    const extraLength = buffer.readUInt16LE(position + 30);
    const commentLength = buffer.readUInt16LE(position + 32);
    const localOffset = buffer.readUInt32LE(position + 42);
    const nameEnd = position + 46 + nameLength;
    if (nameEnd > buffer.length) throw new Error('Corrupt Cryox vault entry name.');

    const name = buffer.subarray(position + 46, nameEnd).toString('utf8');
    if (method !== 0) throw new Error('Unsupported Cryox vault compression.');
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error('Corrupt Cryox vault entry.');
    }

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) throw new Error('Truncated Cryox vault entry.');

    entries.set(name, Buffer.from(buffer.subarray(dataStart, dataEnd)));
    position = nameEnd + extraLength + commentLength;
  }

  return entries;
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function metadataAad(meta) {
  const authenticated = {
    format: FORMAT_V2,
    name: String(meta.name || 'file'),
    type: String(meta.type || 'application/octet-stream'),
    size: Number(meta.size || 0),
    sha256: String(meta.sha256 || ''),
    iv: String(meta.iv || ''),
  };
  return Buffer.from(JSON.stringify(authenticated), 'utf8');
}

export function sealVaultPayload(bytes, { name, type } = {}) {
  const source = Buffer.from(bytes);
  const iv = randomBytes(12);
  const meta = {
    format: FORMAT_V2,
    name: String(name || 'file'),
    type: String(type || 'application/octet-stream'),
    size: source.length,
    sha256: digest(source),
    iv: iv.toString('base64url'),
  };

  const cipher = createCipheriv('aes-256-gcm', getVaultKey(), iv);
  cipher.setAAD(metadataAad(meta));
  const payload = Buffer.concat([cipher.update(source), cipher.final()]);
  meta.tag = cipher.getAuthTag().toString('base64url');

  const archive = zipStored([
    { name: 'payload.bin', data: payload },
    { name: 'meta.json', data: Buffer.from(JSON.stringify(meta), 'utf8') },
  ]);

  return { archive, meta };
}

export function openVaultPayload(archiveBytes) {
  const entries = unzipStored(Buffer.from(archiveBytes));
  const payload = entries.get('payload.bin');
  const metaBytes = entries.get('meta.json');
  if (!payload || !metaBytes) throw new Error('Cryox vault payload is incomplete.');

  let meta;
  try {
    meta = JSON.parse(metaBytes.toString('utf8'));
  } catch {
    throw new Error('Cryox vault metadata is invalid.');
  }

  if (!isVaultFormat(meta?.format)) throw new Error('Unsupported Cryox vault format.');
  const iv = Buffer.from(String(meta.iv || ''), 'base64url');
  const tag = Buffer.from(String(meta.tag || ''), 'base64url');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Cryox vault cryptographic metadata is invalid.');

  const decipher = createDecipheriv('aes-256-gcm', getVaultKey(), iv);
  if (meta.format === FORMAT_V2) decipher.setAAD(metadataAad(meta));
  decipher.setAuthTag(tag);
  const bytes = Buffer.concat([decipher.update(payload), decipher.final()]);

  if (bytes.length !== Number(meta.size || -1)) throw new Error('Cryox vault size check failed.');
  if (digest(bytes) !== String(meta.sha256 || '')) throw new Error('Cryox vault integrity check failed.');
  return { bytes, meta };
}

export function isVaultFormat(value) {
  return value === FORMAT_V1 || value === FORMAT_V2;
}

export const VAULT_FORMAT = FORMAT_V2;
export const LEGACY_VAULT_FORMAT = FORMAT_V1;
