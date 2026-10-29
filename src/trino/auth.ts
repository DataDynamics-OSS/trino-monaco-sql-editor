/**
 * Auth helpers for connecting to Trino / Starburst.
 *
 * NOTE: On standard Trino and Starburst Enterprise, the query API
 * (`/v1/statement`) is authenticated with **Basic** (password authenticator)
 * or **Bearer** (JWT/OAuth) — the web-UI form-login cookie (`Trino-UI-Token`)
 * is NOT accepted there. So `basicAuth` / a Bearer token is the usual path.
 * `createStarburstFetch`'s `formLogin` mode exists only for deployments that
 * proxy the REST API behind the web-UI session.
 */

/** Build a `Basic …` Authorization header value (browser + node). */
export function basicAuth(user: string, password: string): string {
  const raw = `${user}:${password}`;
  const g = globalThis as {
    btoa?: (s: string) => string;
    Buffer?: { from(s: string, enc: string): { toString(enc: string): string } };
  };
  const b64 = g.btoa
    ? g.btoa(raw)
    : g.Buffer!.from(raw, "utf8").toString("base64");
  return "Basic " + b64;
}

export interface StarburstFetchOptions {
  /** Base URL or same-origin proxy prefix. */
  baseUrl: string;
  username: string;
  password: string;
  /**
   * Use the web-UI form login (`POST /ui/login`) + session cookie instead of
   * Basic auth. Only for clusters where `/v1/statement` accepts the UI cookie.
   * Default `false` (Basic auth — what standard Trino/Starburst requires).
   */
  formLogin?: boolean;
  /** Injectable fetch (defaults to global fetch). */
  fetch?: typeof fetch;
}

/**
 * Wrap `fetch` so every request to Trino carries credentials.
 *
 * - Default: injects a `Basic` Authorization header (recommended; verified
 *   against Starburst Enterprise's `/v1/statement`).
 * - `formLogin: true`: performs the web-UI form login once and relies on the
 *   session cookie (browsers manage it automatically with `credentials:
 *   "include"`; in Node the `Set-Cookie` is captured and replayed).
 */
export function createStarburstFetch(options: StarburstFetchOptions): typeof fetch {
  const baseFetch = options.fetch ?? globalThis.fetch;
  if (!baseFetch) throw new Error("No fetch available; pass options.fetch");
  const auth = basicAuth(options.username, options.password);

  let cookie = "";
  let loginPromise: Promise<void> | null = null;

  async function login(): Promise<void> {
    const body = new URLSearchParams({
      username: options.username,
      password: options.password,
      redirectPath: "",
    }).toString();
    const res = await baseFetch(`${options.baseUrl}/ui/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      redirect: "manual",
      credentials: "include",
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
  }

  const wrapped = async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> => {
    const headers = new Headers(init.headers);

    if (options.formLogin) {
      if (!loginPromise) loginPromise = login();
      await loginPromise;
      if (cookie && !headers.has("Cookie")) headers.set("Cookie", cookie); // node path
    } else if (!headers.has("Authorization")) {
      headers.set("Authorization", auth);
    }

    return baseFetch(input, {
      ...init,
      headers,
      credentials: init.credentials ?? "include",
    });
  };

  return wrapped as typeof fetch;
}
