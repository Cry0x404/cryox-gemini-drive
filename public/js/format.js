const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1000) return `${bytes} B`;
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1000)), BYTE_UNITS.length - 1);
  const amount = bytes / (1000 ** unitIndex);
  const digits = amount >= 10 || unitIndex === 0 ? 0 : 1;
  return `${amount.toFixed(digits)} ${BYTE_UNITS[unitIndex]}`;
}

export function formatDate(value) {
  const date = new Date(Number(value) || 0);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) return 'Unknown';

  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();

  if (sameDay) {
    return `Today, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

export function fileExtension(name) {
  const value = String(name || '');
  const index = value.lastIndexOf('.');
  if (index <= 0 || index === value.length - 1) return '';
  return value.slice(index + 1, index + 7).toUpperCase();
}
