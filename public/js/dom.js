export const elements = {
  connectionLabel: document.querySelector('#connectionLabel'),
  sessionIndicator: document.querySelector('#sessionIndicator'),
  sessionSetupButton: document.querySelector('#sessionSetupButton'),
  sessionDialog: document.querySelector('#sessionDialog'),
  verifySessionButton: document.querySelector('#verifySessionButton'),
  fileSummary: document.querySelector('#fileSummary'),
  currentViewLabel: document.querySelector('#currentViewLabel'),
  refreshButton: document.querySelector('#refreshButton'),
  uploadButton: document.querySelector('#uploadButton'),
  searchInput: document.querySelector('#searchInput'),
  clearSearchButton: document.querySelector('#clearSearchButton'),
  sortSelect: document.querySelector('#sortSelect'),
  vaultSurface: document.querySelector('#vaultSurface'),
  fileList: document.querySelector('#fileList'),
  loadingState: document.querySelector('#loadingState'),
  emptyState: document.querySelector('#emptyState'),
  emptyStateTitle: document.querySelector('#emptyStateTitle'),
  emptyStateMessage: document.querySelector('#emptyStateMessage'),
  emptyUploadButton: document.querySelector('#emptyUploadButton'),
  emptySetupButton: document.querySelector('#emptySetupButton'),
  noResultsState: document.querySelector('#noResultsState'),
  fileInput: document.querySelector('#fileInput'),
  dropZone: document.querySelector('#dropZone'),
  uploadPanel: document.querySelector('#uploadPanel'),
  uploadTitle: document.querySelector('#uploadTitle'),
  uploadItems: document.querySelector('#uploadItems'),
  closeUploadPanelButton: document.querySelector('#closeUploadPanelButton'),
  toast: document.querySelector('#toast'),
  allFilesCount: document.querySelector('#allFilesCount'),
  summaryFileCount: document.querySelector('#summaryFileCount'),
  summaryTotalSize: document.querySelector('#summaryTotalSize'),
  summaryAvailability: document.querySelector('#summaryAvailability'),
  visibleFileCount: document.querySelector('#visibleFileCount'),
  viewButtons: [...document.querySelectorAll('[data-view]')],
};

for (const [name, element] of Object.entries(elements)) {
  if (Array.isArray(element)) {
    if (!element.length) throw new Error(`Required UI elements are missing: ${name}`);
    continue;
  }
  if (!element) throw new Error(`Required UI element is missing: ${name}`);
}

let toastTimer = null;

export function showToast(message, duration = 3200) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = String(message || '');
  elements.toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, duration);
}

export function createElement(tag, options = {}) {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = String(options.text);
  if (options.type) element.type = options.type;
  if (options.dataset) {
    for (const [key, value] of Object.entries(options.dataset)) element.dataset[key] = String(value);
  }
  if (options.attributes) {
    for (const [key, value] of Object.entries(options.attributes)) element.setAttribute(key, String(value));
  }
  return element;
}
