import { readFileSync, renameSync, writeFileSync } from 'node:fs';

const oneOf = (...values) => value => values.includes(value);
const range = (min, max) => value => Number.isInteger(value) && value >= min && value <= max;
const bool = value => typeof value === 'boolean';
export const defaults = Object.freeze({
  close: 'exit', startupSize: 'remember', alwaysOnTop: true, opacity: 85,
  fps: 60, overlayFps: 30, autoQuality: true, overlayAutoQuality: true,
  budget: 'balanced',
  theme: 'state', completionAnimation: true,
  notifications: true, notifyCompleted: true, notifyApproval: true,
  notifyFailed: true, notifyConnection: true,
});
const validators = {
  close: oneOf('exit', 'tray'), startupSize: oneOf('remember', 'standard', 'compact'),
  opacity: range(25, 100), fps: oneOf(20, 30, 60), overlayFps: oneOf(20, 30, 60),
  budget: oneOf('balanced', 'main', 'overlay', 'power'),
  theme: oneOf('state', 'native', 'cyan', 'violet', 'amber'),
};

export function acceptsPreference(key, value) {
  return Object.hasOwn(defaults, key) && (validators[key] ?? bool)(value);
}

function rectangle(value) {
  const fields = ['x', 'y', 'width', 'height'];
  if (!fields.every(key => range(-100000, 100000)(value?.[key])) || value.width < 1 || value.height < 1) return;
  return Object.fromEntries(fields.map(key => [key, value[key]]));
}

export function readPreferences(file) {
  let saved;
  try { saved = JSON.parse(readFileSync(file, 'utf8')); } catch {}
  const preferences = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (acceptsPreference(key, saved?.[key])) preferences[key] = saved[key];
  }
  preferences.mainBounds = rectangle(saved?.mainBounds);
  preferences.overlayBounds = rectangle(saved?.overlayBounds);
  preferences.maximized = saved?.maximized === true;
  return preferences;
}

export function savePreferences(file, preferences) {
  const temporary = file + '.tmp';
  writeFileSync(temporary, JSON.stringify(preferences, null, 2) + '\n', { mode: 0o600 });
  renameSync(temporary, file);
}

export function visibleBounds(bounds, workArea, defaultSize, minimum) {
  const fit = (size, min, max) => Math.min(max, Math.max(min, size));
  const width = fit(bounds?.width ?? defaultSize.width, minimum.width, workArea.width);
  const height = fit(bounds?.height ?? defaultSize.height, minimum.height, workArea.height);
  return {
    width, height,
    x: fit(bounds?.x ?? Math.round(workArea.x + (workArea.width - width) / 2),
      workArea.x, workArea.x + workArea.width - width),
    y: fit(bounds?.y ?? Math.round(workArea.y + (workArea.height - height) / 2),
      workArea.y, workArea.y + workArea.height - height),
  };
}
