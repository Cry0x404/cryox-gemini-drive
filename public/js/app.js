import { getFiles, getStatus, syncFiles } from './api.js';
import { elements, showToast } from './dom.js';
import {
  addFile,
  installFileViewEvents,
  renderFiles,
  setFiles,
  setSearchQuery,
  setSessionLive,
  setSort,
  setView,
} from './files-view.js';
import { installSessionDialog, openSessionDialog } from './session-dialog.js';
import { snapshotFiles } from './file-selection.js';
import { canCloseUploadPanel, uploadFiles } from './upload.js';

const state = {
  configured: false,
  live: false,
};

function updateConnection(status) {
  state.configured = Boolean(status?.configured);
  state.live = Boolean(status?.live);
  setSessionLive(state.live);

  if (state.live) {
    elements.sessionIndicator.dataset.state = 'online';
    elements.connectionLabel.textContent = 'Connected';
    return;
  }

  if (state.configured) {
    elements.sessionIndicator.dataset.state = 'warning';
    elements.connectionLabel.textContent = 'Session unavailable';
    return;
  }

  elements.sessionIndicator.dataset.state = 'offline';
  elements.connectionLabel.textContent = 'Not configured';
}

async function loadStatus({ quiet = false } = {}) {
  try {
    const status = await getStatus();
    updateConnection(status);
    if (!quiet && status.configured && !status.live) showToast(status.sessionError || 'The configured Gemini session could not be verified.', 6000);
    return status;
  } catch (error) {
    updateConnection({ configured: false, live: false });
    elements.connectionLabel.textContent = 'Local server unavailable';
    if (!quiet) showToast(error.message, 5000);
    return null;
  }
}

async function loadFiles({ sync = false, force = false, quiet = false } = {}) {
  elements.refreshButton.disabled = true;
  try {
    const response = sync ? await syncFiles({ force }) : await getFiles();
    setFiles(response.files);
    if (sync && !quiet) {
      const scanned = Number(response.discovery?.scanned || 0);
      const discovered = Number(response.discovery?.discovered || 0);
      showToast(scanned ? `Scanned ${scanned} conversations and found ${discovered} vault records.` : 'Your vault is up to date.');
    }
    return response;
  } catch (error) {
    setFiles([]);
    if (!quiet) showToast(error.message, 5000);
    return null;
  } finally {
    elements.refreshButton.disabled = false;
  }
}

async function ensureSession() {
  if (state.live) return true;
  const status = await loadStatus({ quiet: true });
  if (status?.live) return true;
  openSessionDialog();
  return false;
}

async function openFilePicker() {
  if (!(await ensureSession())) return;
  elements.fileInput.click();
}

async function startUpload(fileList) {
  const files = snapshotFiles(fileList);
  if (!files.length) return;
  if (!(await ensureSession())) return;
  await uploadFiles(files, {
    isSessionLive: () => state.live,
    refreshSession: async () => Boolean((await loadStatus({ quiet: true }))?.live),
    onUploaded: addFile,
  });
  await loadStatus({ quiet: true });
}

function installEvents() {
  installFileViewEvents();
  installSessionDialog({
    onVerify: async () => await loadStatus({ quiet: true }),
  });

  elements.searchInput.addEventListener('input', () => setSearchQuery(elements.searchInput.value));
  elements.clearSearchButton.addEventListener('click', () => {
    elements.searchInput.value = '';
    setSearchQuery('');
    elements.searchInput.focus();
  });
  elements.sortSelect.addEventListener('change', () => setSort(elements.sortSelect.value));

  for (const button of elements.viewButtons) {
    button.addEventListener('click', () => setView(button.dataset.view));
  }

  elements.refreshButton.addEventListener('click', async () => {
    await loadStatus({ quiet: true });
    await loadFiles({ sync: true, force: true });
  });

  elements.uploadButton.addEventListener('click', openFilePicker);
  elements.emptyUploadButton.addEventListener('click', openFilePicker);
  elements.fileInput.addEventListener('change', () => {
    const selectedFiles = snapshotFiles(elements.fileInput.files);
    elements.fileInput.value = '';
    void startUpload(selectedFiles);
  });

  elements.closeUploadPanelButton.addEventListener('click', () => {
    if (canCloseUploadPanel()) elements.uploadPanel.hidden = true;
  });

  let dragDepth = 0;
  window.addEventListener('dragenter', (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    event.preventDefault();
    dragDepth += 1;
    elements.dropZone.hidden = false;
  });
  window.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    event.preventDefault();
  });
  window.addEventListener('dragleave', (event) => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) elements.dropZone.hidden = true;
  });
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    elements.dropZone.hidden = true;
    startUpload(event.dataTransfer?.files || []);
  });

  window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'u') {
      event.preventDefault();
      openFilePicker();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      elements.searchInput.focus();
      elements.searchInput.select();
    }
  });
}

installEvents();
renderFiles();
const status = await loadStatus({ quiet: true });
await loadFiles({ sync: Boolean(status?.live), quiet: true });
