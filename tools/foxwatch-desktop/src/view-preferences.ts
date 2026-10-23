import { customRef } from 'vue';

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

// Shared by staged and visible previews; asset-specific pan/camera poses stay local.
export function createViewPreferences(storage?: PreferenceStorage) {
  function preference<T extends string | number | boolean>(key: string, fallback: T, parse: (value: string) => T) {
    let initial = fallback;
    try {
      const saved = storage?.getItem(key);
      if (saved != null) initial = parse(saved);
    } catch { /* Inspection remains available when storage is unavailable. */ }
    // Persistence belongs to the shared preference, not the first preview's scope.
    return customRef<T>((track, trigger) => ({
      get() { track(); return initial; },
      set(current) {
        if (current === initial) return;
        initial = current;
        try { storage?.setItem(key, String(current)); } catch { /* Keep the in-memory preference. */ }
        trigger();
      },
    }));
  }
  function choice(key: string, fallback: string, choices: string[]) {
    return preference(key, fallback, value => choices.includes(value) ? value : fallback);
  }
  function percentage(key: string) {
    return preference(key, 50, value => value.trim() && Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : 50);
  }
  return {
    imageMode: choice('foxwatch.imageCompareMode', 'side', ['side', 'swipe', 'overlay', 'difference']),
    imageBackground: choice('foxwatch.imageBackground', 'checker', ['checker', 'dark', 'light']),
    swipePosition: percentage('foxwatch.swipePosition'),
    overlayOpacity: percentage('foxwatch.overlayOpacity'),
    modelMode: choice('foxwatch.modelCompareMode', 'both', ['both', 'before', 'after']),
    manifestMode: choice('foxwatch.manifestCompareMode', 'fields', ['fields', 'source']),
    manifestFilter: choice('foxwatch.manifestChangeType', 'all', ['all', 'added', 'removed', 'changed']),
    formattedJson: preference('foxwatch.formattedJson', true, value => value !== 'false'),
  };
}

let preferences: ReturnType<typeof createViewPreferences> | undefined;
export function useViewPreferences() {
  if (!preferences) {
    let storage: PreferenceStorage | undefined;
    try { storage = window.localStorage; } catch { /* Use session-only preferences. */ }
    preferences = createViewPreferences(storage);
  }
  return preferences;
}
