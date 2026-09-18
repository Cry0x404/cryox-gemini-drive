export function snapshotFiles(fileList) {
  if (!fileList) return [];
  return Array.from(fileList).filter(Boolean);
}
