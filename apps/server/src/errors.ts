export const ERROR_CODES = {
  WORKSPACE_NOT_FOUND: 404,
  WORKSPACE_NOT_OPEN: 409,
  FILE_NOT_FOUND: 404,
  PATH_FORBIDDEN: 403,
  FORBIDDEN: 403,
  UNAUTHORIZED: 401,
  INVALID_FILE: 400,
  INVALID_ARGUMENT: 400,
  COMPILER_NOT_FOUND: 422,
  BUILD_FAILED: 500,
  BUILD_TIMEOUT: 504,
  BUILD_CANCELLED: 409,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class ApiError extends Error {
  code: ErrorCode;
  statusCode: number;

  constructor(code: ErrorCode, message: string, statusCode?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode ?? ERROR_CODES[code] ?? 500;
  }
}

/** Serialize any thrown error into the structured API shape. */
export function toErrorPayload(err: unknown): {
  error: { code: ErrorCode; message: string };
  statusCode: number;
} {
  if (err instanceof ApiError) {
    return { error: { code: err.code, message: err.message }, statusCode: err.statusCode };
  }
  if (isPathTraversalError(err)) {
    return { error: { code: 'PATH_FORBIDDEN', message: (err as Error).message }, statusCode: 403 };
  }
  const e = err as Error & { statusCode?: number; code?: string };
  if (e?.code === 'ENOENT') {
    // Do not echo filesystem paths to clients.
    return { error: { code: 'FILE_NOT_FOUND', message: 'File not found' }, statusCode: 404 };
  }
  // Unknown/internal errors: log the details server-side, return a generic
  // message so internal paths or stack details never reach the client.
  console.error('[latex-studio] unhandled error:', e ?? err);
  return {
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    statusCode: e?.statusCode ?? 500,
  };
}

export function isPathTraversalError(err: unknown): boolean {
  return err instanceof Error && err.name === 'PathTraversalError';
}
