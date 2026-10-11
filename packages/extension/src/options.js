import { loadSettings, saveSettings } from './settings.js';

async function initOptions() {
  const checkbox = document.getElementById('neutralize');
  const status = document.getElementById('status');
  const settings = await loadSettings();
  checkbox.checked = settings.neutralize;
  checkbox.addEventListener('change', async () => {
    await saveSettings({ neutralize: checkbox.checked });
    status.textContent = 'Saved.';
  });
}

initOptions().catch(() => {
  document.getElementById('status').textContent = 'Settings could not be loaded.';
});
