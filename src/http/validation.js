const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function safeName(value) {
  return String(value || 'file')
    .replace(/[\\/\x00-\x1f\x7f]+/g, '_')
    .trim()
    .slice(0, 180) || 'file';
}

export function safeType(value) {
  const type = String(value || 'application/octet-stream').trim().slice(0, 120);
  return /^[\w.+-]+\/[\w.+-]+$/i.test(type) ? type : 'application/octet-stream';
}

export function decodeHeader(value, fallback = '') {
  try {
    return decodeURIComponent(String(value || fallback));
  } catch {
    throw Object.assign(new Error('Request metadata is not valid URI encoding.'), { kind: 'input' });
  }
}

export function requireUuid(value) {
  const id = String(value || '').trim();
  if (!UUID_RE.test(id)) throw Object.assign(new Error('Invalid file identifier.'), { kind: 'input' });
  return id;
}

export function contentDisposition(name) {
  const fallback = safeName(name).replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(safeName(name)).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
