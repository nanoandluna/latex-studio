import type {
  BuildRecord,
  FileNode,
  BibKeyEntry,
  LabelEntry,
  LatexEnvironment,
} from '@latex-studio/shared';

export interface ApiErrorShape {
  code: string;
  message: string;
}

// ---- instance-session bootstrap -------------------------------------------
// The server issues a per-process random token. Same-origin page loads also
// receive it as an HttpOnly cookie; the header path below covers the Vite dev
// proxy. Cross-origin pages can obtain neither (locked CORS + Host allow-list).
let instanceToken: string | null = null;
let tokenPromise: Promise<string | null> | null = null;

function fetchInstanceToken(): Promise<string | null> {
  if (!tokenPromise) {
    tokenPromise = fetch('/api/auth/token')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { token?: string } | null) => {
        instanceToken = j?.token ?? null;
        return instanceToken;
      })
      .catch(() => null);
  }
  return tokenPromise;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  await fetchInstanceToken();
  const headers: Record<string, string> = {
    ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    ...(instanceToken ? { 'x-latex-studio-token': instanceToken } : {}),
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  let res = await fetch(url, { ...init, headers });
  // Session expired (server restarted → new token): re-bootstrap once.
  if (res.status === 401) {
    tokenPromise = null;
    instanceToken = null;
    await fetchInstanceToken();
    res = await fetch(url, { ...init, headers });
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body as Partial<{ error: ApiErrorShape }> & Partial<ApiErrorShape>;
    const shaped: ApiErrorShape =
      (err as { error?: ApiErrorShape }).error ??
      ({ code: 'INTERNAL_ERROR', message: `${res.status} ${res.statusText}` } as ApiErrorShape);
    const e = new Error(shaped.message) as Error & { code?: string };
    e.code = shaped.code;
    throw e;
  }
  return body as T;
}

export const api = {
  health: () => request<{ ok: boolean; workspace: string | null }>('/api/health'),

  env: () => request<LatexEnvironment>('/api/env'),

  openWorkspace: (path: string) =>
    request<{ path: string; name: string; mainFile: string | null }>('/api/workspace/open', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  closeWorkspace: () => request<{ ok: boolean }>('/api/workspace/close', { method: 'POST' }),

  workspaceState: () =>
    request<
      | { open: false }
      | { open: true; path: string; name: string; mainFile: string | null }
    >('/api/workspace/state'),

  tree: () => request<FileNode>('/api/workspace/tree'),

  bibKeys: () => request<{ keys: BibKeyEntry[] }>('/api/workspace/bibkeys'),
  labels: () => request<{ labels: LabelEntry[] }>('/api/workspace/labels'),

  readFile: (path: string) =>
    request<{ path: string; content: string }>(
      `/api/file/read?path=${encodeURIComponent(path)}`
    ),

  saveFile: (path: string, content: string) =>
    request<{ ok: boolean }>('/api/file/save', {
      method: 'POST',
      body: JSON.stringify({ path, content }),
    }),

  createFile: (path: string, content = '') =>
    request<{ ok: boolean }>('/api/file/create', {
      method: 'POST',
      body: JSON.stringify({ path, type: 'file', content }),
    }),

  createDirectory: (path: string) =>
    request<{ ok: boolean }>('/api/file/create', {
      method: 'POST',
      body: JSON.stringify({ path, type: 'directory' }),
    }),

  deleteFile: (path: string) =>
    request<{ ok: boolean }>('/api/file/delete', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  renameFile: (from: string, to: string) =>
    request<{ ok: boolean }>('/api/file/rename', {
      method: 'POST',
      body: JSON.stringify({ from, to }),
    }),

  build: (mainFile: string, compiler: string) =>
    request<BuildRecord>('/api/build', {
      method: 'POST',
      body: JSON.stringify({ mainFile, compiler }),
    }),

  cancelBuild: (buildId: string) =>
    request<{ ok: boolean }>(`/api/build/${buildId}/cancel`, { method: 'POST' }),

  buildLog: (buildId: string) =>
    request<{ log: string }>(`/api/build/${buildId}/log`),
};
