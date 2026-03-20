import type { Pot, CaptureResult } from './types.js';

async function apiRequest<T>(
  path: string,
  options: RequestInit,
  token: string,
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const status = response.status;
    if (status === 401) throw new ApiError(401, 'Token invalid — check Settings');
    if (status === 429) {
      const retryAfter = response.headers.get('Retry-After') ?? '60';
      throw new ApiError(429, `Rate limited — try again in ${retryAfter}s`);
    }
    const text = await response.text().catch(() => 'Unknown error');
    throw new ApiError(status, `API error ${status}: ${text}`);
  }

  return response.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function listPots(endpoint: string, token: string): Promise<Pot[]> {
  const result = await apiRequest<{ pots: Pot[] }>(
    `${endpoint}/pots`,
    { method: 'GET' },
    token,
  );
  return result.pots ?? [];
}

export interface SelectionPayload {
  pot_id: string;
  text: string;
  source_url: string;
  source_title: string;
  source_context?: Record<string, unknown>;
  client_capture_id: string;
}

export async function captureSelection(
  endpoint: string,
  token: string,
  payload: SelectionPayload,
): Promise<CaptureResult> {
  return apiRequest<CaptureResult>(
    `${endpoint}/ext/capture/selection`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pot_id: payload.pot_id,
        text: payload.text,
        capture_method: 'extension_selection',
        source_url: payload.source_url,
        source_title: payload.source_title,
        source_context: payload.source_context,
        client_capture_id: payload.client_capture_id,
      }),
    },
    token,
  );
}

export interface PagePayload {
  pot_id: string;
  link_url: string;
  link_title: string;
  content_text?: string;
  client_capture_id: string;
}

export async function capturePage(
  endpoint: string,
  token: string,
  payload: PagePayload,
): Promise<CaptureResult> {
  return apiRequest<CaptureResult>(
    `${endpoint}/ext/capture/page`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pot_id: payload.pot_id,
        link_url: payload.link_url,
        link_title: payload.link_title,
        content_text: payload.content_text,
        capture_method: 'extension_page',
        client_capture_id: payload.client_capture_id,
      }),
    },
    token,
  );
}

export async function captureImage(
  endpoint: string,
  token: string,
  formData: FormData,
): Promise<CaptureResult> {
  // No Content-Type header — browser sets it with boundary for multipart
  const result = await apiRequest<CaptureResult & { ok?: boolean; error?: string }>(
    `${endpoint}/ext/capture/image`,
    {
      method: 'POST',
      body: formData,
    },
    token,
  );
  // Backend returns { ok: false, error: '...' } on validation failures (200 status)
  if (result.ok === false) {
    throw new ApiError(400, result.error ?? 'Image capture failed');
  }
  return result;
}

export async function uploadAsset(
  endpoint: string,
  token: string,
  potId: string,
  formData: FormData,
): Promise<CaptureResult> {
  const result = await apiRequest<CaptureResult & { ok?: boolean; error?: string }>(
    `${endpoint}/pots/${potId}/assets`,
    {
      method: 'POST',
      body: formData,
    },
    token,
  );
  if (result.ok === false) {
    throw new ApiError(400, result.error ?? 'Asset upload failed');
  }
  return result;
}

export async function bootstrap(
  endpoint: string,
  bootstrapToken: string,
): Promise<{ ok: boolean; token?: string }> {
  const response = await fetch(`${endpoint}/ext/auth/bootstrap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bootstrap_token: bootstrapToken }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown error');
    return { ok: false };
  }

  const data = (await response.json()) as { token?: string };
  return { ok: true, token: data.token };
}

export async function rotateToken(
  endpoint: string,
  token: string,
): Promise<{ ok: boolean; token?: string }> {
  try {
    const data = await apiRequest<{ token?: string }>(
      `${endpoint}/ext/auth/rotate`,
      { method: 'POST' },
      token,
    );
    return { ok: true, token: data.token };
  } catch {
    return { ok: false };
  }
}

export async function checkHealth(endpoint: string): Promise<boolean> {
  try {
    const response = await fetch(`${endpoint}/health`, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}
