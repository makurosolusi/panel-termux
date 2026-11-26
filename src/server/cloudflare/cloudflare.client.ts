/** Cloudflare API v4 base URL (overridable for tests). */
export const CF_API_BASE = "https://api.cloudflare.com/client/v4";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 10_000;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;

/** Transport options; defaults suit production. */
export type CfClientOptions = { baseUrl?: string; timeoutMs?: number; retryDelayMs?: number };

/** Cloudflare v4 envelope (only the fields we read). */
type CfEnvelope<T> = {
  success: boolean;
  errors?: { code: number; message: string }[];
  result: T;
  result_info?: { page: number; total_pages: number };
};

/** Non-2xx or `success:false` reply; message names the operation and Cloudflare's code/message, never the token. */
export class CloudflareApiError extends Error {
  constructor(
    readonly op: string,
    readonly status: number,
    readonly cfCode: number | null,
    cfMessage: string,
  ) {
    super(`cloudflare ${op}: HTTP ${status}${cfCode !== null ? ` code ${cfCode}` : ""}: ${cfMessage}`);
  }
}

const retryable = (s: number) => s === HTTP_TOO_MANY_REQUESTS || s >= HTTP_SERVER_ERROR;

/** Minimal fetch wrapper: bearer auth, timeout per attempt, one retry on 429/5xx/network error. */
export function createCfClient(token: string, opts: CfClientOptions = {}) {
  const base = opts.baseUrl ?? CF_API_BASE;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  async function attempt(method: string, path: string, body: unknown): Promise<Response> {
    return fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  /** Calls `method path`; `op` labels errors (e.g. "create record sub.example.com"). */
  async function request<T>(op: string, method: string, path: string, body?: unknown): Promise<CfEnvelope<T>> {
    let res: Response | undefined;
    for (let tries = 0; !res; tries++) {
      try {
        res = await attempt(method, path, body);
      } catch (e) {
        // Network error or timeout: one retry, then surface with context.
        if (tries > 0) throw new Error(`cloudflare ${op}: request failed: ${(e as Error).message}`, { cause: e });
        await Bun.sleep(retryDelayMs);
        continue;
      }
      if (tries === 0 && retryable(res.status)) {
        const after = Number(res.headers.get("retry-after"));
        await Bun.sleep(after > 0 ? Math.min(after * 1000, MAX_RETRY_DELAY_MS) : retryDelayMs);
        res = undefined;
      }
    }
    let json: CfEnvelope<T> | null = null;
    try {
      json = (await res.json()) as CfEnvelope<T>;
    } catch {
      // Non-JSON body (e.g. proxy error page); reported below via the HTTP status.
    }
    if (!res.ok || !json?.success) {
      const err = json?.errors?.[0];
      throw new CloudflareApiError(op, res.status, err?.code ?? null, err?.message ?? res.statusText);
    }
    return json;
  }

  return { request };
}

/** Client returned by createCfClient. */
export type CfClient = ReturnType<typeof createCfClient>;
