import { loadSettings, saveSettings } from './settings.js';

async function initOptions() {
  const neutralize = document.getElementById('neutralize');
  const markInbox = document.getElementById('markInbox');
  const status = document.getElementById('status');
  const settings = await loadSettings();
  neutralize.checked = settings.neutralize;
  markInbox.checked = settings.markInbox;
  const save = async () => {
    await saveSettings({ neutralize: neutralize.checked, markInbox: markInbox.checked });
    status.textContent = 'Saved.';
  };
  neutralize.addEventListener('change', save);
  markInbox.addEventListener('change', save);
}

initOptions().catch(() => {
  document.getElementById('status').textContent = 'Settings could not be loaded.';
});
