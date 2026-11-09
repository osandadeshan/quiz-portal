/**
 * API tests: invitations, participant sign-in, one browser per link, autosave,
 * scoring and results visibility. Steps come from scenarios/api-scenarios.ts.
 * No selectors live here; HTML is read through the api/ objects.
 */
import { test, expect } from "../../fixtures/test";
import type { HttpResult } from "../../api/HttpSession";
import type { Invitation } from "../../api/MailApi";
import type { TakePayload } from "../../api/ParticipantApi";
import { MailApi } from "../../api/MailApi";
import { signInAdmin, createQuiz, inviteOne, signInAndStart, answersFor, allCorrect, allEmpty, submit } from "../../flows/api";
import { dbValue } from "../../support/db";
import { apiTitle, Q, QUESTION_ORDER, PARTICIPANT_PASSWORD_RE } from "../../data/api";
import { API_05, API_06, API_07, API_08, API_09, API_10 } from "../../scenarios/api-scenarios";

const scoreOf = (token: string) => dbValue<string>("SELECT score || '/' || max_score FROM invitations WHERE token=$1", [token]);

test.describe("API · participants", () => {
  test(API_05.testTitle, async ({ steps, api }) => {
    const admin = await api.admin();
    const title = apiTitle("API-05 Invitations");
    const people = [
      { name: "Smith, John", email: "api05.john@example.com" },
      { name: "Anna Lee", email: "api05.anna@example.com" },
      { name: "Api05 Ben", email: "api05.ben@example.com" },
    ];
    let quizId = 0;

    await steps.step(
      "setup",
      async () => {
        await signInAdmin(admin);
        quizId = await createQuiz(admin, title);
      },
      async () => expect(quizId).toBeGreaterThan(0)
    );

    let invite!: HttpResult;
    let page!: HttpResult;
    await steps.step(
      "invite",
      async () => {
        invite = await admin.invite(quizId, "Smith, John <api05.john@example.com>; Anna Lee <api05.anna@example.com>, api05.ben@example.com\nnot-an-email");
        page = await admin.http.follow(invite);
      },
      async () => {
        expect(invite.status).toBe(302);
        expect(invite.location).toBe(`/admin/quizzes/${quizId}?tab=participants`);
        const flash = admin.flashes(page);
        expect(flash.success).toEqual(["Invitation sent to 3 people."]);
        expect(flash.warning).toEqual(["Ignored invalid entries: not-an-email."]);
        expect(flash.error).toEqual([]);
      }
    );

    await steps.step(
      "list",
      async () => (page = await admin.quiz(quizId, "participants")),
      async () => {
        const rows = admin.participants(page);
        expect(rows.map((r) => ({ name: r.name, email: r.email })).sort((a, b) => a.email.localeCompare(b.email))).toEqual(
          [...people].sort((a, b) => a.email.localeCompare(b.email))
        );
        for (const r of rows) {
          expect(r.status, r.email).toBe("Not started");
          // Server-rendered date (the browser later rewrites it to local time), e.g. "Emailed Nov 9, 2026, 7:58 AM".
          expect(r.emailNote, r.email).toMatch(/^Emailed [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M$/);
        }
      }
    );

    const mail: Invitation[] = [];
    await steps.step(
      "emails",
      async () => {
        for (const p of people) mail.push(...(await MailApi.invitationsTo(p.email)));
      },
      async () => {
        expect(mail).toHaveLength(3);
        for (const [i, m] of mail.entries()) {
          expect(m.to).toBe(people[i].email);
          expect(m.subject).toBe(`You're invited to take "${title}"`);
          expect(m.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
          expect(m.password).toMatch(PARTICIPANT_PASSWORD_RE);
        }
        expect(new Set(mail.map((m) => m.token)).size).toBe(3);
        expect(new Set(mail.map((m) => m.password)).size).toBe(3);
      }
    );

    const opened: { res: HttpResult; heading: string; hasPassword: boolean }[] = [];
    await steps.step(
      "links",
      async () => {
        for (const [i, m] of mail.entries()) {
          const p = await api.participant(m.token, `participant ${people[i].name}`);
          const res = await p.openLink();
          opened.push({ res, heading: p.heading(res), hasPassword: p.hasPasswordField(res) });
        }
      },
      async () => {
        expect(opened).toHaveLength(3);
        for (const o of opened) {
          expect(o.res.status).toBe(200);
          expect(o.heading).toBe(title);
          expect(o.hasPassword).toBe(true);
        }
      }
    );
  });

  test(API_06.testTitle, async ({ steps, api }) => {
    const admin = await api.admin();
    const title = apiTitle("API-06 Sign-in");
    let quizId = 0;
    let inv!: Invitation;

    await steps.step("setup", async () => {
      await signInAdmin(admin);
      quizId = await createQuiz(admin, title);
    }, async () => expect(quizId).toBeGreaterThan(0));
    await steps.step("invite", async () => (inv = await inviteOne(admin, quizId, "api06.pat@example.com", title)), async () => expect(inv.token).not.toBe(""));

    const pat = await api.participant(inv.token, "participant Pat");
    let wrong!: HttpResult;
    await steps.step(
      "wrongPassword",
      async () => {
        await pat.openLink();
        wrong = await pat.signIn("wrong");
      },
      async () => {
        expect(wrong.status).toBe(401);
        expect(pat.loginError(wrong)).toBe("That password isn't right. Copy it exactly from your invitation email — it's case-sensitive.");
        expect(pat.hasPasswordField(wrong)).toBe(true);
      }
    );

    let signIn!: HttpResult;
    let toStart!: HttpResult;
    let startPage!: HttpResult;
    await steps.step(
      "signIn",
      async () => {
        signIn = await pat.signIn(inv.password);
        toStart = await pat.http.follow(signIn);
        startPage = await pat.openStart();
      },
      async () => {
        expect(signIn.status).toBe(302);
        expect(signIn.location).toBe(pat.base);
        expect(toStart.status).toBe(302);
        expect(toStart.location).toBe(`${pat.base}/start`);
        expect(startPage.status).toBe(200);
        expect(pat.heading(startPage)).toBe(title);
      }
    );

    let start!: HttpResult;
    await steps.step(
      "start",
      async () => (start = await pat.start()),
      async () => {
        expect(start.status).toBe(302);
        expect(start.location).toBe(`${pat.base}/take`);
      }
    );

    let take!: HttpResult;
    let payload!: TakePayload;
    await steps.step(
      "payload",
      async () => {
        take = await pat.openTake();
        payload = pat.takePayload(take);
      },
      async () => {
        expect(take.status).toBe(200);
        expect(payload.title).toBe(title);
        expect(payload.questions.map((q) => [q.type, q.text])).toEqual([
          ["single", Q.single.text],
          ["yesno", Q.yesno.text],
          ["multiple", Q.multiple.text],
        ]);
        for (const [i, q] of payload.questions.entries()) {
          expect([...q.options.map((o) => o.text)].sort()).toEqual([...QUESTION_ORDER[i].options].sort());
          for (const o of q.options) {
            expect(Object.keys(o).sort(), `${q.text} / ${o.text}`).toEqual(["id", "text"]);
            expect(typeof o.id).toBe("number");
          }
        }
        expect(payload.questions[1].options.map((o) => o.text)).toEqual(["Yes", "No"]);
        expect(take.text).not.toContain("is_correct");
        expect(take.text).not.toContain('"correct"');
        const msLeft = payload.deadline - payload.serverNow;
        expect(msLeft).toBeGreaterThan(4 * 60_000);
        expect(msLeft).toBeLessThanOrEqual(5 * 60_000);
      }
    );
  });

  test(API_07.testTitle, async ({ steps, api }) => {
    const admin = await api.admin();
    const title = apiTitle("API-07 One browser");
    let quizId = 0;
    let inv!: Invitation;

    await steps.step("setup", async () => {
      await signInAdmin(admin);
      quizId = await createQuiz(admin, title);
    }, async () => expect(quizId).toBeGreaterThan(0));
    await steps.step("invite", async () => (inv = await inviteOne(admin, quizId, "api07.sam@example.com", title)), async () => expect(inv.token).not.toBe(""));

    const device1 = await api.participant(inv.token, "Sam, device 1");
    const device2 = await api.participant(inv.token, "Sam, device 2");
    let ping1!: HttpResult;
    await steps.step(
      "first",
      async () => {
        await signInAndStart(device1, inv.password);
        ping1 = await device1.ping();
      },
      async () => {
        expect(ping1.status).toBe(200);
        expect(ping1.json()).toMatchObject({ ok: true });
      }
    );

    let second!: HttpResult;
    await steps.step(
      "second",
      async () => {
        await device2.openLink();
        second = await device2.signIn(inv.password);
      },
      async () => {
        expect(second.status).toBe(302);
        expect(second.location).toBe(device2.base);
      }
    );

    let outPing!: HttpResult;
    let outTake!: HttpResult;
    await steps.step(
      "firstOut",
      async () => {
        outPing = await device1.ping();
        outTake = await device1.openTake();
      },
      async () => {
        expect(outPing.status).toBe(401);
        expect(outPing.json()).toEqual({ error: "This link was opened in another browser.", redirect: `${device1.base}?elsewhere=1` });
        expect(outTake.status).toBe(302);
        expect(outTake.location).toBe(`${device1.base}?elsewhere=1`);
      }
    );

    let okPing!: HttpResult;
    let okTake!: HttpResult;
    await steps.step(
      "secondOk",
      async () => {
        okPing = await device2.ping();
        okTake = await device2.openTake();
      },
      async () => {
        expect(okPing.status).toBe(200);
        expect(okPing.json()).toMatchObject({ ok: true });
        expect(okTake.status).toBe(200);
      }
    );

    let page!: HttpResult;
    await steps.step(
      "adminSees",
      async () => (page = await admin.quiz(quizId, "participants")),
      async () => {
        const [row, ...others] = admin.participants(page);
        expect(others).toHaveLength(0);
        expect(row.email).toBe("api07.sam@example.com");
        expect(row.status).toBe("In progress");
        expect(row.emailNote).toContain("2 sign-ins");
        expect(await dbValue<number>("SELECT sign_in_count FROM invitations WHERE token=$1", [inv.token])).toBe(2);
      }
    );
  });

  test(API_08.testTitle, async ({ steps, api }) => {
    const admin = await api.admin();
    const title = apiTitle("API-08 Scoring");
    let quizId = 0;
    let inv!: Invitation;

    await steps.step("setup", async () => {
      await signInAdmin(admin);
      quizId = await createQuiz(admin, title);
    }, async () => expect(quizId).toBeGreaterThan(0));
    await steps.step("invite", async () => (inv = await inviteOne(admin, quizId, "api08.kim@example.com", title)), async () => expect(inv.token).not.toBe(""));

    const kim = await api.participant(inv.token, "participant Kim");
    let payload!: TakePayload;
    await steps.step("start", async () => (payload = await signInAndStart(kim, inv.password)), async () => expect(payload.questions).toHaveLength(3));

    let answers!: Record<string, number[]>;
    let save!: HttpResult;
    let reloaded!: TakePayload;
    await steps.step(
      "autosave",
      async () => {
        answers = answersFor(payload, [
          [Q.single, ["4"]],
          [Q.yesno, ["Yes"]],
          [Q.multiple, ["2"]],
        ]);
        save = await kim.saveAnswers(answers);
        reloaded = kim.takePayload(await kim.openTake());
      },
      async () => {
        expect(save.status).toBe(200);
        expect(save.json()).toMatchObject({ ok: true });
        expect(reloaded.answers).toEqual(answers);
      }
    );

    await steps.step("submit", () => submit(kim, answers), async () => expect(await dbValue("SELECT status FROM invitations WHERE token=$1", [inv.token])).toBe("submitted"));

    let result!: ReturnType<typeof kim.readResult>;
    let resultRes!: HttpResult;
    await steps.step(
      "result",
      async () => {
        resultRes = await kim.openResult();
        result = kim.readResult(resultRes);
      },
      async () => {
        expect(resultRes.status).toBe(200);
        expect(result.percent).toBe("67%");
        expect(result.scoreLine).toBe("2 of 3 correct");
        expect(result.reviewItems).toBe(3);
      }
    );

    let page!: HttpResult;
    await steps.step(
      "adminResults",
      async () => (page = await admin.quiz(quizId, "results")),
      async () => {
        const rows = admin.results(page);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ rank: 1, email: "api08.kim@example.com", percent: "67%", score: "2/3" });
        expect(admin.rankBadgeClasses(page)).toEqual(["rank rank-1"]);
        expect(await scoreOf(inv.token)).toBe("2/3");
      }
    );

    let again!: HttpResult;
    let lateSave!: HttpResult;
    await steps.step(
      "resubmit",
      async () => {
        again = await kim.submit(allCorrect(payload));
        lateSave = await kim.saveAnswers(allCorrect(payload));
      },
      async () => {
        expect(again.status).toBe(200);
        expect(again.json()).toEqual({ redirect: `${kim.base}/result` });
        expect(lateSave.status).toBe(409);
        expect(lateSave.json()).toEqual({ error: "This quiz has already been submitted.", redirect: `${kim.base}/result` });
        expect(await scoreOf(inv.token)).toBe("2/3");
        expect(kim.readResult(await kim.openResult()).percent).toBe("67%");
      }
    );
  });

  test(API_09.testTitle, async ({ steps, api }) => {
    const admin = await api.admin();
    const title = apiTitle("API-09 Cleared answers");
    let quizId = 0;
    let inv!: Invitation;

    await steps.step("setup", async () => {
      await signInAdmin(admin);
      quizId = await createQuiz(admin, title);
    }, async () => expect(quizId).toBeGreaterThan(0));
    await steps.step("invite", async () => (inv = await inviteOne(admin, quizId, "api09.lou@example.com", title)), async () => expect(inv.token).not.toBe(""));

    const lou = await api.participant(inv.token, "participant Lou");
    let payload!: TakePayload;
    await steps.step("start", async () => (payload = await signInAndStart(lou, inv.password)), async () => expect(payload.questions).toHaveLength(3));

    let save!: HttpResult;
    await steps.step(
      "autosave",
      async () => (save = await lou.saveAnswers(allCorrect(payload))),
      async () => {
        expect(save.status).toBe(200);
        expect(save.json()).toMatchObject({ ok: true });
      }
    );

    await steps.step("submit", () => submit(lou, allEmpty(payload)), async () => expect(await dbValue("SELECT status FROM invitations WHERE token=$1", [inv.token])).toBe("submitted"));

    let res!: HttpResult;
    await steps.step(
      "result",
      async () => (res = await lou.openResult()),
      async () => {
        expect(res.status).toBe(200);
        const r = lou.readResult(res);
        expect(r.percent).toBe("0%");
        expect(r.scoreLine).toBe("0 of 3 correct");
        expect(await scoreOf(inv.token)).toBe("0/3");
      }
    );
  });

  test(API_10.testTitle, async ({ steps, api }) => {
    const admin = await api.admin();
    const title = apiTitle("API-10 Confirmation only");
    let quizId = 0;
    let inv!: Invitation;

    await steps.step(
      "setup",
      async () => {
        await signInAdmin(admin);
        quizId = await createQuiz(admin, title, { showResults: "none" });
      },
      async () => expect(await dbValue("SELECT show_results FROM quizzes WHERE id=$1", [quizId])).toBe("none")
    );
    await steps.step("invite", async () => (inv = await inviteOne(admin, quizId, "api10.lee@example.com", title)), async () => expect(inv.token).not.toBe(""));

    const lee = await api.participant(inv.token, "participant Lee");
    let payload!: TakePayload;
    await steps.step("start", async () => (payload = await signInAndStart(lee, inv.password)), async () => expect(payload.questions).toHaveLength(3));
    await steps.step("submit", () => submit(lee, allCorrect(payload)), async () => expect(await scoreOf(inv.token)).toBe("3/3"));

    let res!: HttpResult;
    await steps.step(
      "result",
      async () => (res = await lee.openResult()),
      async () => {
        expect(res.status).toBe(200);
        const r = lee.readResult(res);
        expect(r.heading).toBe("Thanks, you're all done!");
        expect(r.percent).toBeNull();
        expect(r.scoreLine).toBeNull();
        expect(r.reviewItems).toBe(0);
        expect(r.showsCorrectAnswers).toBe(false);
        expect(res.text).not.toContain("3 of 3");
      }
    );

    let page!: HttpResult;
    await steps.step(
      "adminSees",
      async () => (page = await admin.quiz(quizId, "results")),
      async () => {
        const rows = admin.results(page);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ rank: 1, email: "api10.lee@example.com", percent: "100%", score: "3/3" });
      }
    );
  });
});
