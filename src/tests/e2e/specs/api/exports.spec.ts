/**
 * API tests: CSV export and page rendering / error pages. Steps come from
 * scenarios/api-scenarios.ts. No selectors live here.
 */
import { test, expect } from "../../fixtures/test";
import type { HttpResult } from "../../api/HttpSession";
import type { Invitation } from "../../api/MailApi";
import type { ParticipantApi } from "../../api/ParticipantApi";
import { signInAdmin, createQuiz, inviteOne, readInvitation, signInAndStart, answersFor, allCorrect, submit } from "../../flows/api";
import { dbValue } from "../../support/db";
import { apiTitle, csvFilename, CSV_HEADER, Q } from "../../data/api";
import { API_13, API_14 } from "../../scenarios/api-scenarios";

test.describe("API · exports and pages", () => {
  test(API_13.testTitle, async ({ steps, api }) => {
    const admin = await api.admin();
    const title = apiTitle("API-13 CSV export");
    let quizId = 0;

    await steps.step("setup", async () => {
      await signInAdmin(admin);
      quizId = await createQuiz(admin, title);
    }, async () => expect(quizId).toBeGreaterThan(0));

    let invite!: HttpResult;
    let eve!: Invitation;
    let ray!: Invitation;
    await steps.step(
      "invite",
      async () => {
        invite = await admin.invite(quizId, "=SUM(1+1) <api13.eve@example.com>\nRay Chen <api13.ray@example.com>");
        eve = await readInvitation("api13.eve@example.com", title);
        ray = await readInvitation("api13.ray@example.com", title);
      },
      async () => {
        expect(invite.status).toBe(302);
        expect(eve.token).not.toBe(ray.token);
        expect(eve.password).not.toBe(ray.password);
      }
    );

    await steps.step(
      "answer",
      async () => {
        const e = await api.participant(eve.token, "participant Eve");
        await submit(e, allCorrect(await signInAndStart(e, eve.password)));
        const r = await api.participant(ray.token, "participant Ray");
        const payload = await signInAndStart(r, ray.password);
        await submit(r, answersFor(payload, [[Q.single, Q.single.correct], [Q.yesno, ["No"]], [Q.multiple, ["4"]]]));
      },
      async () => {
        expect(await dbValue("SELECT score || '/' || max_score FROM invitations WHERE token=$1", [eve.token])).toBe("3/3");
        expect(await dbValue("SELECT score || '/' || max_score FROM invitations WHERE token=$1", [ray.token])).toBe("1/3");
      }
    );

    let csv!: Awaited<ReturnType<typeof admin.csv>>;
    await steps.step(
      "export",
      async () => (csv = await admin.csv(quizId)),
      async () => {
        expect(csv.res.status).toBe(200);
        expect(csv.res.contentType).toBe("text/csv; charset=utf-8");
        expect(csv.res.headers["content-disposition"]).toBe(`attachment; filename="${csvFilename(title)}"`);
        expect(csv.hasBom).toBe(true);
      }
    );

    await steps.step(
      "rows",
      async () => (csv = await admin.csv(quizId)),
      async () => {
        const [header, ...rows] = csv.rows;
        expect(header).toEqual(CSV_HEADER);
        expect(rows).toHaveLength(2);
        const [first, second] = rows;
        expect([first[0], first[1], first[2], first[3], first[4], first[5], first[8]]).toEqual(["1", "'=SUM(1+1)", "api13.eve@example.com", "3", "3", "100%", "no"]);
        expect([second[0], second[1], second[2], second[3], second[4], second[5], second[8]]).toEqual(["2", "Ray Chen", "api13.ray@example.com", "1", "3", "33%", "no"]);
        for (const r of rows) {
          // Submitted seconds after starting: "<n>s" (formatDuration).
          expect(r[6], "time taken").toMatch(/^\d{1,2}s$/);
          expect(r[7], "submitted at").toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
        }
      }
    );
  });

  test(API_14.testTitle, async ({ steps, api }) => {
    const admin = await api.admin();
    const title = apiTitle("API-14 Pages");
    let quizId = 0;
    let inv!: Invitation;
    let ida!: ParticipantApi;

    await steps.step("setup", async () => {
      await signInAdmin(admin);
      quizId = await createQuiz(admin, title);
    }, async () => expect(quizId).toBeGreaterThan(0));
    await steps.step("invite", async () => (inv = await inviteOne(admin, quizId, "api14.ida@example.com", title)), async () => expect(inv.token).not.toBe(""));
    await steps.step(
      "submit",
      async () => {
        ida = await api.participant(inv.token, "participant Ida");
        await submit(ida, allCorrect(await signInAndStart(ida, inv.password)));
      },
      async () => expect(await dbValue("SELECT status FROM invitations WHERE token=$1", [inv.token])).toBe("submitted")
    );
    const invitationId = await dbValue<number>("SELECT id FROM invitations WHERE token=$1", [inv.token]);

    const pages: [string, HttpResult][] = [];
    await steps.step(
      "adminPages",
      async () => {
        for (const path of [
          "/admin",
          `/admin/quizzes/${quizId}?tab=results`,
          `/admin/quizzes/${quizId}?tab=participants`,
          `/admin/quizzes/${quizId}?tab=questions`,
          `/admin/quizzes/${quizId}/edit`,
          "/admin/quizzes/new",
          "/admin/team",
          "/admin/account",
          `/admin/attempts/${invitationId}`,
        ]) {
          pages.push([path, await admin.get(path)]);
        }
      },
      async () => {
        expect(pages).toHaveLength(9);
        for (const [path, res] of pages) {
          expect(res.status, path).toBe(200);
          expect(res.contentType, path).toMatch(/^text\/html/);
          expect(admin.heading(res), path).not.toBe("");
        }
        const questionsTab = pages.find(([p]) => p.endsWith("tab=questions"))![1];
        expect(admin.questionStats(questionsTab)).toEqual(["1 of 1 answered correctly", "1 of 1 answered correctly", "1 of 1 answered correctly"]);
      }
    );

    let result!: HttpResult;
    let link!: HttpResult;
    await steps.step(
      "participantPages",
      async () => {
        result = await ida.openResult();
        link = await ida.openLink();
      },
      async () => {
        expect(result.status).toBe(200);
        expect(ida.readResult(result).percent).toBe("100%");
        expect(link.status).toBe(302);
        expect(link.location).toBe(`${ida.base}/result`);
      }
    );

    const missing: [string, HttpResult][] = [];
    await steps.step(
      "notFound",
      async () => {
        missing.push(["Page not found", await admin.get("/no-such-page")]);
        missing.push(["Link not valid", await admin.get("/q/not-a-real-token")]);
        missing.push(["Quiz not found", await admin.get("/admin/quizzes/999999")]);
      },
      async () => {
        for (const [heading, res] of missing) {
          expect(res.status, heading).toBe(404);
          expect(admin.heading(res)).toBe(heading);
        }
      }
    );
  });
});
