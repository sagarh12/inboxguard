export const DEFAULT_SETTINGS = Object.freeze({ neutralize: true });

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
    return { ...DEFAULT_SETTINGS, neutralize: stored.neutralize !== false };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings) {
  const area = storageArea();
  if (!area) return;
  await area.set({ neutralize: Boolean(settings.neutralize) });
}

export function onSettingsChanged(callback) {
  try {
    globalThis.chrome?.storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName === 'sync' && changes.neutralize)
        callback({ neutralize: changes.neutralize.newValue !== false });
    });
  } catch {
    return;
  }
}
