import type {
  BuildRecord,
  FileNode,
  BibKeyEntry,
  LabelEntry,
  LatexEnvironment,
  ProjectIndex,
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

/**
 * Fetch with instance-session auth attached.
 *
 * Shared by request() and any caller that needs the raw Response (PDF blobs,
 * ad-hoc endpoints). Reuses the single token bootstrap; retries once with a
 * fresh token when the server session has expired (401).
 */
function mergeAuthHeaders(init: RequestInit | undefined, token: string | null): Record<string, string> {
  const out: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) };
  if (init?.body && !out['Content-Type']) out['Content-Type'] = 'application/json';
  if (token) out['x-latex-studio-token'] = token;
  return out;
}

export async function authedFetch(url: string, init?: RequestInit): Promise<Response> {
  await fetchInstanceToken();
  let res = await fetch(url, { ...init, headers: mergeAuthHeaders(init, instanceToken) });
  // Session expired (server restarted → new token): re-bootstrap once.
  if (res.status === 401) {
    tokenPromise = null;
    instanceToken = null;
    await fetchInstanceToken();
    res = await fetch(url, { ...init, headers: mergeAuthHeaders(init, instanceToken) });
  }
  return res;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await authedFetch(url, init);
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

  // ---- Project Index (V0.2) ----
  index: () => request<ProjectIndex & { version?: number }>('/api/index'),
  refreshIndex: () =>
    request<{
        filesParsed: number;
        cacheHits: number;
        durationMs: number;
        index: ProjectIndex & { version?: number };
      }>('/api/index/refresh', { method: 'POST' }),
  updateIndexBuffer: (path: string, content: string) =>
    request<ProjectIndex & { version?: number }>('/api/index/update', {
      method: 'POST',
      body: JSON.stringify({ path, content }),
    }),

  /** Binary-safe URL for image/pdf preview (auth via session cookie). */
  rawFileUrl: (path: string) => `/api/file/raw?path=${encodeURIComponent(path)}`,

  synctexForward: (buildId: string, file: string, line: number, column = 0) =>
    request<{ page: number; x?: number; y?: number }>(
      `/api/build/${encodeURIComponent(buildId)}/synctex/forward`,
      { method: 'POST', body: JSON.stringify({ file, line, column }) }
    ),

  synctexDiagnostics: (buildId: string) =>
    request<import('@latex-studio/shared').SynctexDiagnostics>(
      `/api/build/${encodeURIComponent(buildId)}/synctex/diagnostics`
    ),

  writingChecks: () =>
    request<{ diagnostics: import('@latex-studio/shared').WritingDiagnostic[] }>(
      '/api/writing-checks'
    ),

  templates: () =>
    request<{
      templates: { id: string; name: string; description?: string; mainFile: string }[];
    }>('/api/templates'),

  createFromTemplate: (id: string, targetDir: string) =>
    request<{ ok: boolean; path: string; name: string; mainFile: string }>(
      '/api/templates/create',
      { method: 'POST', body: JSON.stringify({ id, targetDir }) }
    ),

  recentProjects: () =>
    request<{ recents: { path: string; name: string; lastOpened: number }[] }>(
      '/api/workspace/recent'
    ),

  synctexInverse: (buildId: string, page: number, x: number, y: number) =>
    request<{ file: string; line: number; column?: number }>(
      `/api/build/${encodeURIComponent(buildId)}/synctex/inverse`,
      { method: 'POST', body: JSON.stringify({ page, x, y }) }
    ),

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
