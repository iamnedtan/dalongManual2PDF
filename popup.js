// Popup UI. All the real work happens in the service worker / offscreen
// document, so closing this window mid-export doesn't cancel the download.

const statusEl = document.getElementById('status');
const exportEl = document.getElementById('export');
const noteEl = document.getElementById('note');
const gotoEl = document.getElementById('goto');

let targetTabId = null;

function setStatus(text, { error = false } = {}) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', error);
}

function setNote(text) {
  noteEl.textContent = text || '';
  noteEl.hidden = !text;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'progress' || exportEl.hidden) return;
  if (message.stage === 'fetching') {
    setStatus(`Downloading images… ${message.done}/${message.total}`);
  } else if (message.stage === 'assembling') {
    setStatus('Building the PDF…');
  }
});

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    setStatus('No active tab.', { error: true });
    return;
  }
  targetTabId = tab.id;

  const response = await chrome.runtime.sendMessage({
    target: 'background',
    type: 'inspect',
    tabId: tab.id,
  });

  if (!response?.ok && response?.infoUrl) {
    setStatus(response.error);
    gotoEl.hidden = false;
    gotoEl.focus();
    gotoEl.addEventListener('click', async () => {
      await chrome.tabs.update(targetTabId, { url: response.infoUrl });
      window.close();
    });
    return;
  }

  if (!response?.ok) {
    setStatus(response?.error || 'Something went wrong.', { error: true });
    return;
  }

  const noun = response.count === 1 ? 'manual image' : 'manual images';
  setStatus(`Found ${response.count} ${noun} (${response.displayName}).`);
  setNote(`Saves as ${response.filename}`);
  exportEl.hidden = false;
  exportEl.focus();
}

exportEl.addEventListener('click', async () => {
  exportEl.disabled = true;
  setNote('You can close this popup — the download continues.');
  setStatus('Downloading images…');

  let response;
  try {
    response = await chrome.runtime.sendMessage({
      target: 'background',
      type: 'startExport',
      tabId: targetTabId,
    });
  } catch (error) {
    response = { ok: false, error: error.message };
  }

  if (!response?.ok) {
    setStatus(response?.error || 'The export failed.', { error: true });
    setNote('');
    exportEl.disabled = false;
    return;
  }

  const pages = response.pageCount === 1 ? '1 page' : `${response.pageCount} pages`;
  setStatus(`Saved ${response.filename} (${pages}).`);
  setNote('');
});

init().catch((error) => setStatus(error.message, { error: true }));
