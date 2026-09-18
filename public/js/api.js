async function parseResponse(response) {
  const type = response.headers.get('content-type') || '';
  if (type.includes('application/json')) return response.json();
  const text = await response.text();
  return text ? { error: text } : {};
}

export async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options,
  });
  const body = await parseResponse(response);
  if (!response.ok) throw new Error(body?.error || `Request failed with status ${response.status}`);
  return body;
}

export function getStatus() {
  return requestJson('/api/status');
}

export function getFiles() {
  return requestJson('/api/files');
}

export function syncFiles({ force = false } = {}) {
  const query = force ? '?force=1' : '';
  return requestJson(`/api/sync${query}`, {
    method: 'POST',
    headers: { 'x-cryox-request': '1' },
  });
}

export function removeFile(id) {
  return requestJson(`/api/files/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'x-cryox-request': '1' },
  });
}
