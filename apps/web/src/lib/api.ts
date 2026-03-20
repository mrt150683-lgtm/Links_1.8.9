/**
 * API client for Links backend
 * Proxied through Vite dev server at /api -> http://127.0.0.1:3000
 */

const API_BASE = '/api';

class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public response?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;

  // Only set Content-Type if there's a body
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  };

  if (options?.body) {
    headers['Content-Type'] = 'application/json';
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new ApiError(
        error.error || error.message || `HTTP ${response.status}`,
        response.status,
        error
      );
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError('Network error', 0, error);
  }
}

// Agent role types (018_pot_role)
export interface PotRoleData {
  role_ref: string | null;
  source: 'user' | 'builtin' | 'default';
  text: string;
  hash: string;
  updated_at: number | null;
  lint_warnings: string[];
}

export const api = {
  get: <T>(path: string) => request<T>(path),

  post: <T>(path: string, data?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    }),

  put: <T>(path: string, data: unknown) =>
    request<T>(path, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  patch: <T>(path: string, data: unknown) =>
    request<T>(path, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: <T>(path: string) =>
    request<T>(path, {
      method: 'DELETE',
    }),

  // Agent role helpers (018_pot_role)
  getPotRole: (potId: string) => request<PotRoleData>(`/pots/${potId}/role`),
  setPotRole: (potId: string, text: string) =>
    request<PotRoleData>(`/pots/${potId}/role`, {
      method: 'PUT',
      body: JSON.stringify({ text }),
    }),

  upload: async <T>(path: string, formData: FormData): Promise<T> => {
    const url = `${API_BASE}${path}`;
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      // Don't set Content-Type - browser will set it with boundary
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new ApiError(
        error.error || error.message || `HTTP ${response.status}`,
        response.status,
        error
      );
    }

    return response.json();
  },
};
