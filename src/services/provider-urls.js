export function safeGoogleDownloadUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    if (url.port && url.port !== '443') return '';

    const host = url.hostname.toLowerCase();
    const allowed = host === 'googleusercontent.com'
      || host.endsWith('.googleusercontent.com')
      || host === 'usercontent.google.com'
      || host.endsWith('.usercontent.google.com')
      || host === 'content-push.googleapis.com'
      || host === 'push.clients6.google.com'
      || host.endsWith('.googleapis.com')
      || host.endsWith('.ggpht.com');

    return allowed ? url.href : '';
  } catch {
    return '';
  }
}

export function collectGoogleUrls(node, output = [], depth = 0) {
  if (depth > 12 || node == null || output.length >= 32) return output;

  if (typeof node === 'string') {
    const direct = safeGoogleDownloadUrl(node);
    if (direct && !output.includes(direct)) output.push(direct);

    const matches = node.match(/https:\/\/[^\\s"'<>\\\]]+/g) || [];
    for (const match of matches) {
      const normalized = match.replace(/\\\//g, '/').replace(/\\u0026/g, '&');
      const url = safeGoogleDownloadUrl(normalized);
      if (url && !output.includes(url)) output.push(url);
      if (output.length >= 32) break;
    }
    return output;
  }

  if (Array.isArray(node)) {
    for (const child of node) collectGoogleUrls(child, output, depth + 1);
  } else if (typeof node === 'object') {
    for (const child of Object.values(node)) collectGoogleUrls(child, output, depth + 1);
  }

  return output;
}
