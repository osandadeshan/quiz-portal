import { expect } from "@playwright/test";
import { AdminApi, QuizInput } from "../api/AdminApi";
import { ParticipantApi, TakePayload } from "../api/ParticipantApi";
import { MailApi, Invitation } from "../api/MailApi";
import { ADMIN } from "../support/env";
import { apiQuiz, PARTICIPANT_PASSWORD_RE, QUESTION_ORDER } from "../data/api";

/**
 * Multi-request building blocks for API specs (each used inside a documented
 * step). They assert every response on the way, so a broken precondition fails
 * at the step that caused it.
 */

/** Sign in, then load the dashboard (which also gives the new session its CSRF token). */
export async function signInAdmin(admin: AdminApi, email = ADMIN.email, password = ADMIN.password) {
  const res = await admin.signIn(email, password);
  expect(res.status, `sign-in as ${email}`).toBe(302);
  expect(res.location).toBe("/admin");
  const dash = await admin.dashboard();
  expect(dash.status).toBe(200);
  expect(admin.heading(dash)).toBe("Quizzes");
  return dash;
}

export async function createQuiz(admin: AdminApi, title: string, extra: Partial<QuizInput> = {}): Promise<number> {
  const res = await admin.createQuiz(apiQuiz(title, extra));
  expect(res.status, res.text).toBe(200);
  const { redirect } = res.json<{ redirect: string }>();
  expect(redirect).toMatch(/^\/admin\/quizzes\/\d+\?tab=participants$/);
  // Like the builder, go to the new quiz (this also shows and uses up the one-time "created" message).
  const page = await admin.get(redirect);
  expect(page.status).toBe(200);
  expect(admin.heading(page)).toBe(title);
  expect(admin.flashes(page).success).toEqual(["Quiz created. Invite participants whenever you're ready."]);
  return admin.quizIdFrom(res);
}

/** Invite one address and read the single invitation email it received. */
export async function inviteOne(admin: AdminApi, quizId: number, email: string, quizTitle: string): Promise<Invitation> {
  const res = await admin.invite(quizId, email);
  expect(res.status).toBe(302);
  expect(res.location).toBe(`/admin/quizzes/${quizId}?tab=participants`);
  return readInvitation(email, quizTitle);
}

export async function readInvitation(email: string, quizTitle: string): Promise<Invitation> {
  const mails = await MailApi.invitationsTo(email);
  expect(mails, `invitation emails to ${email}`).toHaveLength(1);
  const [inv] = mails;
  expect(inv.subject).toBe(`You're invited to take "${quizTitle}"`);
  expect(inv.to).toBe(email);
  expect(inv.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  expect(inv.password).toMatch(PARTICIPANT_PASSWORD_RE);
  return inv;
}

/** Sign in with the link's password and press Start; returns the take page's quiz data. */
export async function signInAndStart(p: ParticipantApi, password: string): Promise<TakePayload> {
  const open = await p.openLink();
  expect(open.status).toBe(200);
  const signIn = await p.signIn(password);
  expect(signIn.status, p.loginError(signIn)).toBe(302);
  expect(signIn.location).toBe(p.base);
  const toStart = await p.http.follow(signIn);
  expect(toStart.status).toBe(302);
  expect(toStart.location).toBe(`${p.base}/start`);
  const startPage = await p.openStart();
  expect(startPage.status).toBe(200);
  const start = await p.start();
  expect(start.status).toBe(302);
  expect(start.location).toBe(`${p.base}/take`);
  const take = await p.openTake();
  expect(take.status).toBe(200);
  return p.takePayload(take);
}

type Pick = [question: { text: string }, options: readonly string[]];

/** Answers keyed by question id, from question/option texts. */
export const answersFor = (payload: TakePayload, picks: Pick[]) =>
  Object.fromEntries(picks.map(([q, opts]) => ParticipantApi.pick(payload, q.text, [...opts])));

export const allCorrect = (payload: TakePayload) => answersFor(payload, QUESTION_ORDER.map((q) => [q, q.correct] as Pick));
export const allEmpty = (payload: TakePayload) => answersFor(payload, QUESTION_ORDER.map((q) => [q, []] as Pick));

export async function submit(p: ParticipantApi, answers: Record<string, number[]>) {
  const res = await p.submit(answers);
  expect(res.status, res.text).toBe(200);
  expect(res.json()).toEqual({ redirect: `${p.base}/result` });
  return res;
}
