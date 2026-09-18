import { elements, createElement, showToast } from './dom.js';
import { snapshotFiles } from './file-selection.js';

let activeUploads = 0;

function createUploadItem(file) {
  const item = createElement('div', { className: 'upload-item', dataset: { state: 'uploading' } });
  const line = createElement('div', { className: 'upload-item__line' });
  const name = createElement('div', { className: 'upload-item__name', text: file.name });
  const state = createElement('div', { className: 'upload-item__state', text: 'Preparing' });
  const progress = createElement('div', { className: 'upload-progress' });
  const bar = document.createElement('span');
  progress.append(bar);
  line.append(name, state);
  item.append(line, progress);
  elements.uploadItems.prepend(item);
  return { item, state, bar };
}

function uploadFile(file) {
  return new Promise((resolve) => {
    const view = createUploadItem(file);
    const request = new XMLHttpRequest();
    request.open('POST', '/api/upload');
    request.responseType = 'json';
    request.setRequestHeader('x-cryox-request', '1');
    request.setRequestHeader('x-file-size', String(file.size));
    request.setRequestHeader('x-file-name', encodeURIComponent(file.name));
    request.setRequestHeader('x-file-type', encodeURIComponent(file.type || 'application/octet-stream'));

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percentage = Math.max(1, Math.min(92, Math.round((event.loaded / event.total) * 92)));
      view.bar.style.width = `${percentage}%`;
      view.state.textContent = `${percentage}%`;
    };

    request.upload.onload = () => {
      view.bar.style.width = '96%';
      view.state.textContent = 'Persisting to Gemini';
    };

    request.onload = () => {
      if (request.status >= 200 && request.status < 300 && request.response?.file) {
        view.item.dataset.state = 'done';
        view.bar.style.width = '100%';
        view.state.textContent = 'Complete';
        resolve({ ok: true, file: request.response.file });
        return;
      }

      view.item.dataset.state = 'error';
      view.state.textContent = request.response?.error || `Failed (${request.status})`;
      resolve({ ok: false, file: null });
    };

    request.onerror = () => {
      view.item.dataset.state = 'error';
      view.state.textContent = 'Network error';
      resolve({ ok: false, file: null });
    };

    request.send(file);
  });
}

export async function uploadFiles(fileList, { isSessionLive, refreshSession, onUploaded } = {}) {
  const files = snapshotFiles(fileList);
  if (!files.length) return;

  let live = Boolean(isSessionLive?.());
  if (!live && refreshSession) live = Boolean(await refreshSession());
  if (!live) {
    showToast('Connect a valid Gemini session before uploading files.', 5000);
    return;
  }

  const empty = files.find((file) => file.size <= 0);
  if (empty) {
    showToast(`${empty.name} is empty and cannot be uploaded.`, 5000);
    return;
  }

  elements.uploadPanel.hidden = false;
  activeUploads += files.length;
  elements.uploadTitle.textContent = files.length === 1 ? 'Uploading 1 file' : `Uploading ${files.length} files`;

  let completed = 0;
  for (const file of files) {
    const result = await uploadFile(file);
    activeUploads -= 1;
    if (result.ok) {
      completed += 1;
      onUploaded?.(result.file);
    }
  }

  elements.uploadTitle.textContent = activeUploads
    ? `Uploading ${activeUploads} ${activeUploads === 1 ? 'file' : 'files'}`
    : `${completed} of ${files.length} completed`;
}

export function canCloseUploadPanel() {
  return activeUploads === 0;
}
