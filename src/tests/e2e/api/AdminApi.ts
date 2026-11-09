import { HTMLElement } from "node-html-parser";
import { HttpResult, HttpSession } from "./HttpSession";
import { parseCsv } from "../support/csv";

/**
 * Admin side of the app over plain HTTP: the API-test equivalent of the admin
 * page objects. Every HTML selector the API tests need lives here (or in the
 * other files in this folder), never in a spec.
 */
export interface QuizInput {
  title: string;
  description?: string;
  durationMinutes: number;
  shuffleOptions?: boolean;
  showResults?: "full" | "score" | "none";
  questions: { type: "single" | "yesno" | "multiple"; text: string; options: { text: string; correct: boolean }[] }[];
}

export interface Flashes {
  success: string[];
  warning: string[];
  error: string[];
  info: string[];
  /** One-time password shown after an owner resets an admin's password. */
  oneTimePassword?: string;
}

export interface ParticipantRow {
  name: string;
  email: string;
  status: string;
  emailNote: string;
}

export interface ResultRow {
  rank: number;
  name: string;
  email: string;
  percent: string;
  score: string;
  attemptPath: string;
}

export interface TeamRow {
  id: number | null;
  name: string;
  email: string;
  isOwner: boolean;
}

const text = (el: HTMLElement | null | undefined) => (el?.text ?? "").replace(/\s+/g, " ").trim();

export function readFlashes(page: HTMLElement): Flashes {
  const of = (kind: string) => page.querySelectorAll(`.alert-${kind} .alert-body`).map((e) => text(e));
  const oneTime = page.querySelector(".alert-info .alert-body code.mono");
  return { success: of("success"), warning: of("warning"), error: of("error"), info: of("info"), oneTimePassword: oneTime ? text(oneTime) : undefined };
}

export class AdminApi {
  constructor(readonly http: HttpSession) {}

  static async open(who = "admin") {
    return new AdminApi(await HttpSession.open(who));
  }

  /** The same browser state in a second tab (same cookies, same page token). */
  async fork(who: string) {
    return new AdminApi(await this.http.fork(who));
  }

  // ---------- Sign-in ----------
  openLogin() {
    return this.http.get("/admin/login");
  }
  /** POST the sign-in form (open the login page first so the session has a CSRF token). */
  async signIn(email: string, password: string): Promise<HttpResult> {
    if (!this.http.csrfToken) await this.openLogin();
    return this.http.postForm("/admin/login", { email, password });
  }
  loginError(res: HttpResult) {
    return text(res.html.querySelector(".alert-error .alert-body"));
  }
  openSetup() {
    return this.http.get("/admin/setup");
  }
  submitSetup(values: { name: string; email: string; password: string; confirm: string }) {
    return this.http.postForm("/admin/setup", values);
  }

  // ---------- Dashboard / quizzes ----------
  dashboard() {
    return this.http.get("/admin");
  }
  dashboardTitles(res: HttpResult): string[] {
    return res.html.querySelectorAll("a.quiz-card h3").map((e) => text(e));
  }
  /** POST /admin/quizzes as the builder does. `raw` sends the body as-is (for malformed input). */
  createQuiz(quiz: QuizInput | unknown, opts: { csrf?: string | null } = {}) {
    return this.http.postJson("/admin/quizzes", quiz, opts);
  }
  quizIdFrom(res: HttpResult): number {
    const m = /\/admin\/quizzes\/(\d+)/.exec(res.json<{ redirect: string }>().redirect || "");
    if (!m) throw new Error(`No quiz id in ${res.text}`);
    return Number(m[1]);
  }
  quiz(id: number, tab: "results" | "participants" | "questions" = "results") {
    return this.http.get(`/admin/quizzes/${id}?tab=${tab}`);
  }
  deleteQuiz(id: number) {
    return this.http.postForm(`/admin/quizzes/${id}/delete`, {});
  }
  invite(id: number, recipients: string) {
    return this.http.postForm(`/admin/quizzes/${id}/invite`, { recipients });
  }
  participants(page: HttpResult): ParticipantRow[] {
    // Participants tab: one row per invitation, each with an actions menu labelled with the email.
    return page.html
      .querySelectorAll("tr")
      .filter((tr) => tr.querySelector('summary[aria-label^="Actions for "]'))
      .map((tr) => ({
        name: text(tr.querySelector(".person-name")),
        email: text(tr.querySelector(".person-email")),
        status: text(tr.querySelector(".badge")),
        emailNote: text(tr.querySelector(".person .small")),
      }));
  }
  results(page: HttpResult): ResultRow[] {
    return page.html.querySelectorAll("tr[data-result-row]").map((tr) => ({
      rank: Number(text(tr.querySelector(".rank"))),
      name: text(tr.querySelector(".person-name")),
      email: text(tr.querySelector(".person-email")),
      percent: text(tr.querySelector(".score-num")),
      score: text(tr.querySelector(".score-cell .small")),
      attemptPath: tr.getAttribute("data-href") || "",
    }));
  }
  rankBadgeClasses(page: HttpResult): string[] {
    return page.html.querySelectorAll("tr[data-result-row] .rank").map((e) => e.getAttribute("class") || "");
  }
  /** Questions tab: the "<n> of <m> answered correctly" tooltip of each question's stat. */
  questionStats(page: HttpResult): string[] {
    return page.html.querySelectorAll(".q-stat").map((e) => e.getAttribute("title") || "");
  }
  async csv(id: number) {
    const res = await this.http.get(`/admin/quizzes/${id}/results.csv`);
    const body = res.text.replace(/^﻿/, "");
    return { res, hasBom: res.text.startsWith("﻿"), rows: res.status === 200 ? parseCsv(body) : [] };
  }
  attempt(path: string) {
    return this.http.get(path);
  }
  attemptHeading(res: HttpResult) {
    return text(res.html.querySelector("h1"));
  }

  // ---------- Team ----------
  team() {
    return this.http.get("/admin/team");
  }
  teamRows(page: HttpResult): TeamRow[] {
    return page.html
      .querySelectorAll("tbody tr")
      .filter((tr) => tr.querySelector(".person-email"))
      .map((tr) => {
        const action = tr.querySelector('form[action$="/password"]')?.getAttribute("action") || "";
        const id = /\/admin\/team\/(\d+)\//.exec(action);
        const nameEl = tr.querySelector(".person-name");
        return {
          id: id ? Number(id[1]) : null,
          name: (nameEl?.childNodes[0]?.text ?? "").trim(),
          email: text(tr.querySelector(".person-email")),
          isOwner: /\bOwner\b/.test(text(nameEl)),
        };
      });
  }
  canAddAdmins(page: HttpResult) {
    return page.html.querySelector('[data-open-dialog="add-admin"]') !== null;
  }
  addAdmin(values: { name: string; email: string; password: string }) {
    return this.http.postForm("/admin/team", values);
  }
  removeAdmin(id: number) {
    return this.http.postForm(`/admin/team/${id}/delete`, {});
  }
  resetAdminPassword(id: number) {
    return this.http.postForm(`/admin/team/${id}/password`, {});
  }

  // ---------- Any page ----------
  get(path: string) {
    return this.http.get(path);
  }
  heading(res: HttpResult) {
    return text(res.html.querySelector("h1"));
  }
  flashes(res: HttpResult) {
    return readFlashes(res.html);
  }
}
