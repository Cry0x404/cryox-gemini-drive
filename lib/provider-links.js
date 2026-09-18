function mapOutsideCodeFences(input, transform) {
  const source = String(input || '');
  let output = '';
  let plainStart = 0;
  let codeStart = -1;
  let cursor = 0;
  let fenceCharacter = '';
  let fenceLength = 0;

  while (cursor < source.length) {
    const newline = source.indexOf('\n', cursor);
    const lineEnd = newline === -1 ? source.length : newline + 1;
    const line = source.slice(cursor, newline === -1 ? source.length : newline).replace(/\r$/, '');

    if (codeStart === -1) {
      const open = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
      if (open && !(open[2][0] === '`' && open[3].includes('`'))) {
        output += transform(source.slice(plainStart, cursor));
        codeStart = cursor;
        fenceCharacter = open[2][0];
        fenceLength = open[2].length;
      }
    } else {
      const close = /^( {0,3})(`+|~+)[ \t]*$/.exec(line);
      if (close && close[2][0] === fenceCharacter && close[2].length >= fenceLength) {
        output += source.slice(codeStart, lineEnd);
        codeStart = -1;
        plainStart = lineEnd;
      }
    }

    cursor = lineEnd;
  }

  if (codeStart !== -1) output += source.slice(codeStart);
  else output += transform(source.slice(plainStart));
  return output;
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function unwrapGoogleRedirect(rawUrl) {
  const source = decodeEntities(rawUrl).trim();
  try {
    const parsed = new URL(source);
    if (!/^https?:$/i.test(parsed.protocol)) return '';
    const host = parsed.hostname.toLowerCase();
    if ((host === 'google.com' || host === 'www.google.com') && parsed.pathname === '/url') {
      const target = parsed.searchParams.get('q') || parsed.searchParams.get('url');
      if (target) {
        const decoded = new URL(target);
        if (/^https?:$/i.test(decoded.protocol)) return decoded.href;
      }
    }
    return parsed.href;
  } catch {
    return '';
  }
}

function sanitizeLinksInProse(input) {
  let source = String(input || '');
  source = source
    .replace(
      /\[([^\]\n]*)\]\(\s*(?:lmdx|qwen|gemini|file|blob):[^)\s]*\s*\)/gi,
      (_whole, label) => String(label || '').trim(),
    )
    .replace(/(?:lmdx|qwen|gemini):\/\/[^\s)\]}>"']+/gi, '');

  source = source.replace(
    /\[([^\]\n]+)\]\((https?:\/\/(?:www\.)?google\.com\/url\?[^\s)]+)\)/gi,
    (_whole, label, url) => {
      const target = unwrapGoogleRedirect(url);
      return target && !/^https?:\/\/(?:www\.)?google\.com\/url\?/i.test(target)
        ? `[${label}](${target})`
        : String(label || '').trim();
    },
  );

  return source.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');
}

export function sanitizeProviderLinks(input) {
  return mapOutsideCodeFences(input, sanitizeLinksInProse).trim();
}
