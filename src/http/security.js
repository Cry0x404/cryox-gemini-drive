function hostnameFromHeader(value) {
  try {
    return new URL(`http://${String(value || '')}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isLoopbackHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

export function securityHeaders(_request, response, next) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('X-DNS-Prefetch-Control', 'off');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  );
  next();
}

export function localRequestGuard({ host }) {
  const localBinding = isLoopbackHostname(host);

  return (request, response, next) => {
    if (!localBinding) return next();

    const requestHost = String(request.headers.host || '').toLowerCase();
    const requestHostname = hostnameFromHeader(requestHost);
    if (!isLoopbackHostname(requestHostname)) {
      return response.status(421).json({ error: 'Request host is not allowed for the local-only server.' });
    }

    if (String(request.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') {
      return response.status(403).json({ error: 'Cross-site requests are not allowed.' });
    }

    const origin = String(request.headers.origin || '').trim();
    if (origin) {
      try {
        const parsedOrigin = new URL(origin);
        const originHostname = parsedOrigin.hostname.toLowerCase();
        if (
          parsedOrigin.protocol !== 'http:'
          || !isLoopbackHostname(originHostname)
          || parsedOrigin.host.toLowerCase() !== requestHost
        ) {
          return response.status(403).json({ error: 'Cross-origin requests are not allowed.' });
        }
      } catch {
        return response.status(403).json({ error: 'Invalid request origin.' });
      }
    }

    return next();
  };
}

export function mutationRequestGuard(request, response, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(request.method || '').toUpperCase())) return next();
  if (String(request.headers['x-cryox-request'] || '') === '1') return next();
  return response.status(403).json({ error: 'Missing local mutation request marker.' });
}

export function noStoreApiResponses(request, response, next) {
  if (request.path.startsWith('/api/')) response.setHeader('Cache-Control', 'no-store');
  next();
}
