export const DEFAULT_SETTINGS = Object.freeze({ neutralize: true, markInbox: true });

function storageArea() {
  try {
    return globalThis.chrome?.storage?.sync ?? null;
  } catch {
    return null;
  }
}

export async function loadSettings() {
  const area = storageArea();
  if (!area) return { ...DEFAULT_SETTINGS };
  try {
    const stored = await area.get(DEFAULT_SETTINGS);
    return { neutralize: stored.neutralize !== false, markInbox: stored.markInbox !== false };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings) {
  const area = storageArea();
  if (!area) return;
  await area.set({
    neutralize: Boolean(settings.neutralize),
    markInbox: Boolean(settings.markInbox),
  });
}

export function onSettingsChanged(callback) {
  try {
    globalThis.chrome?.storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName !== 'sync') return;
      const next = {};
      if (changes.neutralize) next.neutralize = changes.neutralize.newValue !== false;
      if (changes.markInbox) next.markInbox = changes.markInbox.newValue !== false;
      if (Object.keys(next).length > 0) callback(next);
    });
  } catch {
    return;
  }
}
