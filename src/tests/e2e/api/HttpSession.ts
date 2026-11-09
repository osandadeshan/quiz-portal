import { APIRequestContext, APIResponse, request } from "@playwright/test";
import { parse, HTMLElement } from "node-html-parser";
import { APP_URL } from "../support/env";

/**
 * One HTTP "browser" for API tests: its own cookie jar (session), CSRF token and
 * exchange log. Redirects are never followed automatically, so tests can assert
 * the exact status and Location of every response; use follow() to go on.
 *
 * Every exchange is appended to `httpLog`, and ScenarioSteps attaches the ones
 * made during a step to that Allure step (instead of a screenshot).
 */
export interface HttpExchange {
  who: string;
  method: string;
  path: string;
  requestBody?: string;
  status: number;
  location?: string;
  contentType?: string;
  responseBody: string;
}

export const httpLog: HttpExchange[] = [];

export class HttpResult {
  private parsed?: HTMLElement;
  constructor(
    readonly status: number,
    readonly headers: Record<string, string>,
    readonly text: string
  ) {}

  /** Redirect target as a path (e.g. "/admin/login"), or undefined. */
  get location(): string | undefined {
    const loc = this.headers["location"];
    return loc ? loc.replace(APP_URL, "") : undefined;
  }
  get contentType(): string {
    return this.headers["content-type"] || "";
  }
  json<T = Record<string, unknown>>(): T {
    return JSON.parse(this.text) as T;
  }
  get html(): HTMLElement {
    return (this.parsed ??= parse(this.text));
  }
}

const clip = (s: string, n = 1500) => (s.length > n ? `${s.slice(0, n)}… (${s.length} characters)` : s);

export class HttpSession {
  private csrf = "";

  private constructor(
    private readonly ctx: APIRequestContext,
    /** Shown in the step's HTTP log, e.g. "admin" or "participant John". */
    readonly who: string
  ) {}

  /** Every session not yet disposed; the `api` fixture disposes leftovers after each test. */
  static readonly openSessions = new Set<HttpSession>();

  static async open(who: string): Promise<HttpSession> {
    const s = new HttpSession(await request.newContext({ baseURL: APP_URL }), who);
    HttpSession.openSessions.add(s);
    return s;
  }

  async dispose() {
    HttpSession.openSessions.delete(this);
    await this.ctx.dispose();
  }

  /**
   * A copy of this session as it is right now (cookies + CSRF token), like the
   * same page still open in a second tab, or a form about to be sent twice.
   */
  async fork(who: string): Promise<HttpSession> {
    const copy = new HttpSession(await request.newContext({ baseURL: APP_URL, storageState: await this.ctx.storageState() }), who);
    copy.csrf = this.csrf;
    HttpSession.openSessions.add(copy);
    return copy;
  }

  /** Cookies this session's browser would send to the app. */
  async cookies() {
    return (await this.ctx.storageState()).cookies;
  }

  /** The CSRF token from the last HTML page this session loaded. */
  get csrfToken(): string {
    return this.csrf;
  }

  async get(path: string, opts: { accept?: string } = {}): Promise<HttpResult> {
    const headers: Record<string, string> = {};
    if (opts.accept) headers["Accept"] = opts.accept;
    return this.record("GET", path, undefined, await this.ctx.get(path, { maxRedirects: 0, headers }));
  }

  /** Form POST (like a browser form). Sends this session's CSRF token unless `csrf` overrides it. */
  async postForm(path: string, form: Record<string, string>, opts: { csrf?: string | null } = {}): Promise<HttpResult> {
    const body = { ...form };
    const token = opts.csrf === undefined ? this.csrf : opts.csrf;
    if (token !== null) body._csrf = token;
    const res = await this.ctx.post(path, { form: body, maxRedirects: 0 });
    return this.record("POST", path, new URLSearchParams(body).toString(), res);
  }

  /** JSON POST (like the app's fetch calls), with the X-CSRF-Token header unless `csrf` overrides it. */
  async postJson(path: string, data: unknown, opts: { csrf?: string | null } = {}): Promise<HttpResult> {
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    const token = opts.csrf === undefined ? this.csrf : opts.csrf;
    if (token !== null) headers["X-CSRF-Token"] = token;
    const raw = typeof data === "string" ? data : JSON.stringify(data);
    const res = await this.ctx.post(path, { data: raw, headers, maxRedirects: 0 });
    return this.record("POST", path, raw, res);
  }

  /** GET the Location of a redirect. */
  async follow(res: HttpResult): Promise<HttpResult> {
    if (!res.location) throw new Error(`Expected a redirect, got HTTP ${res.status}`);
    return this.get(res.location);
  }

  private async record(method: string, path: string, requestBody: string | undefined, res: APIResponse): Promise<HttpResult> {
    const headers = res.headers();
    const text = await res.text();
    const result = new HttpResult(res.status(), headers, text);
    if ((headers["content-type"] || "").includes("text/html")) {
      const token = result.html.querySelector('meta[name="csrf-token"]')?.getAttribute("content");
      if (token) this.csrf = token;
    }
    const isHtml = (headers["content-type"] || "").includes("text/html");
    httpLog.push({
      who: this.who,
      method,
      path,
      requestBody: requestBody && clip(requestBody, 600),
      status: result.status,
      location: result.location,
      contentType: headers["content-type"],
      responseBody: isHtml ? `<title>${result.html.querySelector("title")?.text.trim() ?? ""}</title> (HTML page, ${text.length} characters)` : clip(text),
    });
    return result;
  }
}

export function formatExchanges(list: HttpExchange[]): string {
  return list
    .map((x, i) =>
      [
        `#${i + 1} [${x.who}] ${x.method} ${x.path}`,
        x.requestBody ? `    request:  ${x.requestBody}` : "",
        `    response: HTTP ${x.status}${x.location ? ` → ${x.location}` : ""}${x.contentType ? `  (${x.contentType})` : ""}`,
        `              ${x.responseBody.replace(/\n/g, "\n              ")}`,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");
}
