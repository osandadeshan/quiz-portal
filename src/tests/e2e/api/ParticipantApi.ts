import { HttpResult, HttpSession } from "./HttpSession";

/** What /q/<token>/take embeds for the quiz player (#quiz-data). */
export interface TakePayload {
  token: string;
  title: string;
  serverNow: number;
  deadline: number;
  questions: { id: number; type: string; text: string; options: { id: number; text: string }[] }[];
  answers: Record<string, number[]>;
}

const squash = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/**
 * A participant over plain HTTP, in their own session (like a private browser
 * window): the API-test equivalent of the participant page objects.
 */
export class ParticipantApi {
  constructor(
    readonly http: HttpSession,
    readonly token: string
  ) {}

  static async open(token: string, who: string) {
    return new ParticipantApi(await HttpSession.open(who), token);
  }

  get base() {
    return `/q/${this.token}`;
  }

  openLink() {
    return this.http.get(this.base);
  }
  /** POST the password form (opens the link first so the session has a CSRF token). */
  async signIn(password: string) {
    if (!this.http.csrfToken) await this.openLink();
    return this.http.postForm(this.base, { password });
  }
  loginError(res: HttpResult) {
    return squash(res.html.querySelector(".alert-error .alert-body")?.text);
  }
  heading(res: HttpResult) {
    return squash(res.html.querySelector("h1")?.text);
  }
  hasPasswordField(res: HttpResult) {
    return res.html.querySelector('input[name="password"][type="password"]') !== null;
  }
  openStart() {
    return this.http.get(`${this.base}/start`);
  }
  start() {
    return this.http.postForm(`${this.base}/start`, {});
  }
  openTake() {
    return this.http.get(`${this.base}/take`);
  }
  takePayload(res: HttpResult): TakePayload {
    const raw = res.html.querySelector("script#quiz-data")?.text;
    if (!raw) throw new Error("The take page has no #quiz-data payload");
    return JSON.parse(raw) as TakePayload;
  }
  /** Option ids for the given option texts of a question (looked up by question text). */
  static pick(payload: TakePayload, questionText: string, optionTexts: string[]): [string, number[]] {
    const q = payload.questions.find((x) => x.text === questionText);
    if (!q) throw new Error(`No question "${questionText}" in the take payload`);
    const ids = optionTexts.map((t) => {
      const o = q.options.find((x) => x.text === t);
      if (!o) throw new Error(`No option "${t}" in "${questionText}"`);
      return o.id;
    });
    return [String(q.id), ids];
  }
  saveAnswers(answers: Record<string, number[]>) {
    return this.http.postJson(`${this.base}/answers`, { answers });
  }
  ping() {
    return this.http.get(`${this.base}/ping`, { accept: "application/json" });
  }
  submit(answers: Record<string, number[]>) {
    return this.http.postJson(`${this.base}/submit`, { answers });
  }
  openResult() {
    return this.http.get(`${this.base}/result`);
  }
  readResult(res: HttpResult) {
    const h = res.html;
    return {
      heading: squash(h.querySelector("h1")?.text),
      percent: squash(h.querySelector(".ring-label .pct")?.text) || null,
      scoreLine: squash(h.querySelector(".ring-label .of")?.text) || null,
      reviewItems: h.querySelectorAll(".review-item").length,
      showsCorrectAnswers: /Correct answer/.test(res.text) || h.querySelectorAll(".review-opts").length > 0,
    };
  }
}
