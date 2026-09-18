import { elements, showToast } from './dom.js';

export function openSessionDialog() {
  if (!elements.sessionDialog.open) elements.sessionDialog.showModal();
}

export function installSessionDialog({ onVerify } = {}) {
  elements.sessionSetupButton.addEventListener('click', openSessionDialog);
  elements.emptySetupButton.addEventListener('click', openSessionDialog);
  elements.verifySessionButton.addEventListener('click', async (event) => {
    event.preventDefault();
    elements.verifySessionButton.disabled = true;
    try {
      const status = await onVerify?.();
      if (status?.live) {
        elements.sessionDialog.close();
        showToast('Gemini session connected.');
      } else {
        showToast(status?.sessionError || 'Gemini session verification failed.', 6000);
      }
    } finally {
      elements.verifySessionButton.disabled = false;
    }
  });
}
