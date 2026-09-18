const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function summarizeFiles(files) {
  const safeFiles = Array.isArray(files) ? files : [];
  const totalSize = safeFiles.reduce((total, file) => total + Math.max(0, Number(file?.size) || 0), 0);
  const readyCount = safeFiles.reduce((total, file) => total + (file?.downloadReady === false ? 0 : 1), 0);
  return {
    count: safeFiles.length,
    totalSize,
    readyCount,
  };
}

export function filterFiles(files, { query = '', view = 'all', now = Date.now() } = {}) {
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase('en-US');
  const threshold = Number(now) - RECENT_WINDOW_MS;

  return (Array.isArray(files) ? files : []).filter((file) => {
    if (normalizedQuery && !String(file?.name || '').toLocaleLowerCase('en-US').includes(normalizedQuery)) return false;
    if (view === 'recent') return Number(file?.uploadedAt) >= threshold;
    if (view === 'available') return file?.downloadReady !== false;
    return true;
  });
}

export function sortFiles(files, sort = 'newest') {
  const next = [...(Array.isArray(files) ? files : [])];
  if (sort === 'oldest') return next.sort((left, right) => Number(left?.uploadedAt || 0) - Number(right?.uploadedAt || 0));
  if (sort === 'name') return next.sort((left, right) => String(left?.name || '').localeCompare(String(right?.name || ''), 'en', { sensitivity: 'base', numeric: true }));
  if (sort === 'size') return next.sort((left, right) => Number(right?.size || 0) - Number(left?.size || 0));
  return next.sort((left, right) => Number(right?.uploadedAt || 0) - Number(left?.uploadedAt || 0));
}

export function viewLabel(view) {
  if (view === 'recent') return 'Recent';
  if (view === 'available') return 'Ready to download';
  return 'All files';
}
