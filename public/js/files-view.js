import { removeFile } from './api.js';
import { elements, createElement, showToast } from './dom.js';
import { filterFiles, sortFiles, summarizeFiles, viewLabel } from './file-model.js';
import { fileExtension, formatBytes, formatDate } from './format.js';
import { fileIconMarkup, moreIconMarkup } from './icons.js';

let files = [];
let query = '';
let view = 'all';
let sort = 'newest';
let sessionLive = false;
let loading = true;

function visibleFiles() {
  return sortFiles(filterFiles(files, { query, view }), sort);
}

function closeMenus() {
  document.querySelectorAll('.context-menu').forEach((menu) => menu.remove());
  document.querySelectorAll('.more-button[aria-expanded="true"]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
}

function downloadFile(file) {
  closeMenus();
  if (file.downloadReady === false) {
    showToast('This legacy file does not expose a reliable download handle. Upload it once with this version to repair availability.', 6000);
    return;
  }

  const anchor = document.createElement('a');
  anchor.href = `/api/files/${encodeURIComponent(file.id)}/download`;
  anchor.download = String(file.name || '');
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function positionContextMenu(menu, trigger) {
  const rect = trigger.getBoundingClientRect();
  const width = 190;
  const gap = 6;
  const right = Math.max(8, window.innerWidth - rect.right);
  menu.style.right = `${right}px`;
  menu.style.left = 'auto';
  menu.style.top = `${Math.min(window.innerHeight - 120, rect.bottom + gap)}px`;
  menu.style.width = `${width}px`;
}

function createContextMenu(file, trigger) {
  closeMenus();
  trigger.setAttribute('aria-expanded', 'true');

  const menu = createElement('div', { className: 'context-menu', attributes: { role: 'menu' } });
  const download = createElement('button', { type: 'button', attributes: { role: 'menuitem' } });
  download.append(createElement('span', { text: 'Download' }), createElement('small', { text: 'Enter' }));
  const remove = createElement('button', {
    text: 'Remove from vault',
    type: 'button',
    dataset: { danger: 'true' },
    attributes: { role: 'menuitem' },
  });

  download.addEventListener('click', () => downloadFile(file));
  remove.addEventListener('click', async () => {
    closeMenus();
    const approved = window.confirm(`Remove "${file.name}" from Cryox Drive? The historical Gemini attachment will remain unchanged.`);
    if (!approved) return;

    try {
      await removeFile(file.id);
      files = files.filter((candidate) => candidate.id !== file.id);
      renderFiles();
      showToast('File removed from this vault.');
    } catch (error) {
      showToast(error.message, 5000);
    }
  });

  menu.append(download, remove);
  document.body.append(menu);
  positionContextMenu(menu, trigger);
  window.requestAnimationFrame(() => download.focus());
}

function createFileRow(file) {
  const row = createElement('div', {
    className: 'file-row file-grid',
    attributes: { tabindex: '0', role: 'row' },
    dataset: { id: file.id },
  });

  const nameCell = createElement('div', { className: 'file-name-cell', attributes: { role: 'cell' } });
  const glyph = createElement('span', { className: 'file-glyph' });
  glyph.innerHTML = fileIconMarkup(file);

  const copy = createElement('span', { className: 'file-copy' });
  copy.append(createElement('span', { className: 'file-name', text: file.name }));
  const extension = fileExtension(file.name);
  if (extension) copy.append(createElement('span', { className: 'file-extension', text: extension }));
  nameCell.append(glyph, copy);

  const status = createElement('div', {
    className: 'file-status',
    text: file.downloadReady === false ? 'Legacy' : 'Ready',
    attributes: { role: 'cell' },
    dataset: { state: file.downloadReady === false ? 'limited' : 'ready' },
  });
  const modified = createElement('div', { className: 'file-meta', text: formatDate(file.uploadedAt), attributes: { role: 'cell' } });
  const size = createElement('div', { className: 'file-meta', text: formatBytes(file.size), attributes: { role: 'cell' } });
  const actions = createElement('div', { className: 'row-actions', attributes: { role: 'cell' } });
  const moreButton = createElement('button', {
    className: 'more-button',
    type: 'button',
    attributes: {
      'aria-label': `Actions for ${file.name}`,
      'aria-expanded': 'false',
      'aria-haspopup': 'menu',
    },
  });
  moreButton.innerHTML = moreIconMarkup();
  actions.append(moreButton);

  row.append(nameCell, status, modified, size, actions);
  row.addEventListener('dblclick', (event) => {
    if (!event.target.closest('button')) downloadFile(file);
  });
  row.addEventListener('keydown', (event) => {
    if (event.target === row && event.key === 'Enter') downloadFile(file);
  });
  moreButton.addEventListener('click', (event) => {
    event.stopPropagation();
    createContextMenu(file, moreButton);
  });

  return row;
}

function updateSummary(visible) {
  const summary = summarizeFiles(files);
  const readyLabel = summary.count ? `${summary.readyCount} of ${summary.count}` : '0 files';
  elements.summaryFileCount.textContent = String(summary.count);
  elements.summaryTotalSize.textContent = formatBytes(summary.totalSize);
  elements.summaryAvailability.textContent = readyLabel;
  elements.allFilesCount.textContent = String(summary.count);
  elements.visibleFileCount.textContent = `${visible.length} ${visible.length === 1 ? 'item' : 'items'}`;
  elements.currentViewLabel.textContent = viewLabel(view);

  if (summary.count) {
    elements.fileSummary.textContent = `${summary.count} ${summary.count === 1 ? 'file' : 'files'} · ${formatBytes(summary.totalSize)} stored`;
  } else {
    elements.fileSummary.textContent = sessionLive ? 'Gemini is connected. Uploads are encrypted locally before transfer.' : 'Connect Gemini to upload files or recover existing vault records.';
  }

  if (sessionLive) {
    elements.emptyStateTitle.textContent = 'No files yet';
    elements.emptyStateMessage.textContent = 'Upload a file to add it to this vault. Encryption happens locally before Gemini receives the payload.';
    elements.emptyUploadButton.textContent = 'Upload files';
  } else {
    elements.emptyStateTitle.textContent = 'Connect Gemini to continue';
    elements.emptyStateMessage.textContent = 'Cryox Drive needs a local Gemini Web session before it can upload files or recover vault records.';
    elements.emptyUploadButton.textContent = 'Set up session';
  }
}

function updateViewButtons() {
  for (const button of elements.viewButtons) {
    const active = button.dataset.view === view;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}

export function renderFiles() {
  const visible = visibleFiles();
  elements.fileList.replaceChildren(...visible.map(createFileRow));
  elements.clearSearchButton.hidden = !query;
  elements.loadingState.hidden = !loading;
  elements.fileList.hidden = loading || files.length === 0 || visible.length === 0;
  elements.emptyState.hidden = loading || files.length !== 0;
  elements.noResultsState.hidden = loading || !(files.length > 0 && visible.length === 0);
  updateViewButtons();
  updateSummary(visible);
}

export function setFiles(nextFiles) {
  files = Array.isArray(nextFiles) ? nextFiles : [];
  loading = false;
  renderFiles();
}

export function addFile(file) {
  if (!file?.id) return;
  files = [file, ...files.filter((candidate) => candidate.id !== file.id)];
  loading = false;
  renderFiles();
}

export function setSearchQuery(value) {
  query = String(value || '');
  renderFiles();
}

export function setView(nextView) {
  if (!['all', 'recent', 'available'].includes(nextView)) return;
  view = nextView;
  renderFiles();
}

export function setSort(nextSort) {
  if (!['newest', 'oldest', 'name', 'size'].includes(nextSort)) return;
  sort = nextSort;
  renderFiles();
}

export function setSessionLive(value) {
  sessionLive = Boolean(value);
  renderFiles();
}

export function installFileViewEvents() {
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.context-menu') && !event.target.closest('.more-button')) closeMenus();
  });
  window.addEventListener('resize', closeMenus);
  window.addEventListener('scroll', closeMenus, { capture: true, passive: true });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenus();
  });
}
