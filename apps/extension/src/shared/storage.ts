import type { ExtSettings, CaptureStatus } from './types.js';

const DEFAULT_SETTINGS: ExtSettings = {
  endpoint: 'http://127.0.0.1:3000',
  token: null,
  defaultPotId: null,
  defaultPotName: null,
  appUrl: 'http://localhost:3001',
};

export async function getSettings(): Promise<ExtSettings> {
  const result = await chrome.storage.local.get([
    'endpoint',
    'token',
    'defaultPotId',
    'defaultPotName',
    'appUrl',
  ]);
  return {
    endpoint: (result.endpoint as string | undefined) ?? DEFAULT_SETTINGS.endpoint,
    token: (result.token as string | null | undefined) ?? null,
    defaultPotId: (result.defaultPotId as string | null | undefined) ?? null,
    defaultPotName: (result.defaultPotName as string | null | undefined) ?? null,
    appUrl: (result.appUrl as string | undefined) ?? DEFAULT_SETTINGS.appUrl,
  };
}

export async function saveSettings(settings: Partial<ExtSettings>): Promise<void> {
  await chrome.storage.local.set(settings);
}

export async function getLastStatus(): Promise<CaptureStatus | null> {
  const result = await chrome.storage.local.get('lastStatus');
  return (result.lastStatus as CaptureStatus | undefined) ?? null;
}

export async function saveLastStatus(status: CaptureStatus): Promise<void> {
  await chrome.storage.local.set({ lastStatus: status });
}

export async function clearToken(): Promise<void> {
  await chrome.storage.local.remove(['token', 'defaultPotId', 'defaultPotName']);
}
