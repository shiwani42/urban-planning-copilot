import { NextResponse } from "next/server";

const STORAGE_ERROR_RE =
  /ENOENT|EACCES|EPERM|EROFS|store\.json|persist|write-probe|workspace storage/i;

export function apiJson<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function apiError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

function statusForError(message: string): number {
  if (/not found/i.test(message)) return 404;
  if (STORAGE_ERROR_RE.test(message)) return 503;
  return 400;
}

/** Run a route handler and always return a JSON body — never an empty/truncated response. */
export async function runApiHandler<T>(
  handler: () => Promise<T>,
  options?: { successStatus?: number }
): Promise<NextResponse> {
  try {
    const result = await handler();
    return apiJson(result, options?.successStatus ?? 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return apiError(message, statusForError(message));
  }
}
