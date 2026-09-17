const ICONS = {
  file: '<svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 20 24" aria-hidden="true"><path d="M3.5 1.75h8l5 5v15.5h-13z"/><path d="M11.5 1.75v5h5"/></svg>',
  image: '<svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 20 24" aria-hidden="true"><path d="M3.5 1.75h8l5 5v15.5h-13z"/><path d="M11.5 1.75v5h5"/><circle cx="7.2" cy="11" r="1.2"/><path d="m5.5 18 3.2-3.3 2.1 2 1.8-1.8 2.1 3.1"/></svg>',
  archive: '<svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 20 24" aria-hidden="true"><path d="M3.5 1.75h8l5 5v15.5h-13z"/><path d="M11.5 1.75v5h5M8 4.5h2M8 7.5h2M8 10.5h2M8 13.5h2"/></svg>',
  code: '<svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 20 24" aria-hidden="true"><path d="M3.5 1.75h8l5 5v15.5h-13z"/><path d="M11.5 1.75v5h5M8 12l-2 2 2 2M12 12l2 2-2 2"/></svg>',
  document: '<svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 20 24" aria-hidden="true"><path d="M3.5 1.75h8l5 5v15.5h-13z"/><path d="M11.5 1.75v5h5M6.5 12h7M6.5 15h7M6.5 18h5"/></svg>',
  more: '<svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>',
};

function category(file) {
  const type = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (/(?:zip|rar|7z|tar|gzip|x-7z|x-rar)/.test(type) || /\.(?:zip|rar|7z|tar|gz|tgz)$/i.test(name)) return 'archive';
  if (/(?:json|javascript|typescript|xml|yaml|toml|css|html)/.test(type) || /\.(?:js|mjs|cjs|ts|tsx|jsx|json|html|css|py|rs|go|java|cpp|c|h|cs|php|rb|sh|ps1|yml|yaml|toml)$/i.test(name)) return 'code';
  if (/(?:pdf|text|word|officedocument|rtf)/.test(type) || /\.(?:pdf|txt|md|doc|docx|rtf)$/i.test(name)) return 'document';
  return 'file';
}

export function fileIconMarkup(file) {
  return ICONS[category(file)] || ICONS.file;
}

export function moreIconMarkup() {
  return ICONS.more;
}
