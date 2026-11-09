/**
 * API tests: admin privacy and team roles. Steps come from
 * scenarios/api-scenarios.ts. No selectors live here.
 */
import { test, expect } from "../../fixtures/test";
import type { HttpResult } from "../../api/HttpSession";
import type { Invitation } from "../../api/MailApi";
import type { TeamRow } from "../../api/AdminApi";
import { signInAdmin, createQuiz, inviteOne, signInAndStart, allCorrect, submit } from "../../flows/api";
import { dbValue } from "../../support/db";
import { ADMIN } from "../../support/env";
import { apiTitle, API_PASSWORDS, ADMIN_RESET_PASSWORD_RE } from "../../data/api";
import { API_11, API_12 } from "../../scenarios/api-scenarios";

const ONLY_OWNER = "Only the owner of this Quiz Portal can add, remove or reset admins.";
const countAdmins = (email: string) => dbValue<number>("SELECT count(*)::int FROM admins WHERE email=$1", [email]);

test.describe("API · admins", () => {
  test(API_11.testTitle, async ({ steps, api }) => {
    const owner = await api.admin("owner");
    const title = apiTitle("API-11 Private quiz");
    let quizId = 0;
    let inv!: Invitation;

    await steps.step("setup", async () => {
      await signInAdmin(owner);
      quizId = await createQuiz(owner, title);
    }, async () => expect(quizId).toBeGreaterThan(0));
    await steps.step("invite", async () => (inv = await inviteOne(owner, quizId, "api11.zoe@example.com", title)), async () => expect(inv.token).not.toBe(""));

    const zoe = await api.participant(inv.token, "participant Zoe");
    await steps.step(
      "submit",
      async () => submit(zoe, allCorrect(await signInAndStart(zoe, inv.password))),
      async () => expect(await dbValue("SELECT score || '/' || max_score FROM invitations WHERE token=$1", [inv.token])).toBe("3/3")
    );
    const invitationId = await dbValue<number>("SELECT id FROM invitations WHERE token=$1", [inv.token]);

    let add!: HttpResult;
    let team!: HttpResult;
    await steps.step(
      "addAdmin",
      async () => {
        add = await owner.addAdmin({ name: "API Other Admin", email: "api11.other@example.com", password: API_PASSWORDS.other });
        team = await owner.team();
      },
      async () => {
        expect(add.status).toBe(302);
        expect(add.location).toBe("/admin/team");
        const row = owner.teamRows(team).find((r) => r.email === "api11.other@example.com");
        expect(row).toMatchObject({ name: "API Other Admin", isOwner: false });
      }
    );

    const other = await api.admin("other admin");
    let otherDash!: HttpResult;
    await steps.step(
      "otherSignIn",
      async () => (otherDash = await signInAdmin(other, "api11.other@example.com", API_PASSWORDS.other)),
      async () => {
        expect(otherDash.status).toBe(200);
        expect(other.dashboardTitles(otherDash)).not.toContain(title);
      }
    );

    const views: [string, HttpResult][] = [];
    await steps.step(
      "otherView",
      async () => {
        for (const path of [`/admin/quizzes/${quizId}`, `/admin/quizzes/${quizId}/edit`, `/admin/quizzes/${quizId}/results.csv`, `/admin/attempts/${invitationId}`]) {
          views.push([path, await other.get(path)]);
        }
      },
      async () => {
        for (const [path, res] of views) {
          expect(res.status, path).toBe(404);
          expect(res.text, path).not.toContain(title);
        }
        expect(other.heading(views[0][1])).toBe("Quiz not found");
        expect(other.heading(views[3][1])).toBe("Not found");
      }
    );

    const changes: [string, HttpResult][] = [];
    await steps.step(
      "otherChange",
      async () => {
        changes.push(["delete", await other.deleteQuiz(quizId)]);
        changes.push(["invite", await other.invite(quizId, "api11.spy@example.com")]);
        changes.push(["reset", await other.http.postForm(`/admin/invitations/${invitationId}/reset`, {})]);
      },
      async () => {
        for (const [what, res] of changes) expect(res.status, what).toBe(404);
        expect((await owner.quiz(quizId)).status).toBe(200);
        expect(await dbValue("SELECT score || '/' || max_score FROM invitations WHERE token=$1", [inv.token])).toBe("3/3");
        expect(await dbValue<number>("SELECT count(*)::int FROM invitations WHERE email='api11.spy@example.com'")).toBe(0);
      }
    );
  });

  test(API_12.testTitle, async ({ steps, api }) => {
    const owner = await api.admin("owner");
    const max = await api.admin("Max");

    await steps.step(
      "setup",
      async () => {
        await signInAdmin(owner);
        const add = await owner.addAdmin({ name: "API Max", email: "api12.max@example.com", password: API_PASSWORDS.max });
        expect(add.status).toBe(302);
        expect(add.location).toBe("/admin/team");
        await signInAdmin(max, "api12.max@example.com", API_PASSWORDS.max);
      },
      async () => expect(await countAdmins("api12.max@example.com")).toBe(1)
    );

    let ownerRows: TeamRow[] = [];
    let ownerCanAdd = false;
    let maxCanAdd = true;
    await steps.step(
      "roles",
      async () => {
        const ownerTeam = await owner.team();
        ownerRows = owner.teamRows(ownerTeam);
        ownerCanAdd = owner.canAddAdmins(ownerTeam);
        maxCanAdd = max.canAddAdmins(await max.team());
      },
      async () => {
        const me = ownerRows.find((r) => r.email === ADMIN.email);
        expect(me).toMatchObject({ name: ADMIN.name, isOwner: true });
        expect(ownerRows.find((r) => r.email === "api12.max@example.com")).toMatchObject({ name: "API Max", isOwner: false });
        expect(ownerCanAdd).toBe(true);
        expect(maxCanAdd).toBe(false);
        expect(await dbValue("SELECT role FROM admins WHERE email=$1", [ADMIN.email])).toBe("owner");
        expect(await dbValue("SELECT role FROM admins WHERE email=$1", ["api12.max@example.com"])).toBe("admin");
      }
    );
    const ownerId = await dbValue<number>("SELECT id FROM admins WHERE email=$1", [ADMIN.email]);
    const maxId = ownerRows.find((r) => r.email === "api12.max@example.com")?.id ?? 0;

    let remove!: HttpResult;
    let removePage!: HttpResult;
    await steps.step(
      "removeOwner",
      async () => {
        remove = await max.removeAdmin(ownerId!);
        removePage = await max.http.follow(remove);
      },
      async () => {
        expect(remove.status).toBe(302);
        expect(remove.location).toBe("/admin/team");
        expect(max.flashes(removePage).error).toEqual([ONLY_OWNER]);
        expect(await countAdmins(ADMIN.email)).toBe(1);
      }
    );

    let addTry!: HttpResult;
    let addPage!: HttpResult;
    await steps.step(
      "addAdmin",
      async () => {
        addTry = await max.addAdmin({ name: "Sneaky", email: "api12.sneaky@example.com", password: API_PASSWORDS.sneaky });
        addPage = await max.http.follow(addTry);
      },
      async () => {
        expect(addTry.status).toBe(302);
        expect(addTry.location).toBe("/admin/team");
        expect(max.flashes(addPage).error).toEqual([ONLY_OWNER]);
        expect(await countAdmins("api12.sneaky@example.com")).toBe(0);
      }
    );

    let newPassword = "";
    let reset!: HttpResult;
    await steps.step(
      "reset",
      async () => {
        expect(maxId).toBeGreaterThan(0);
        reset = await owner.resetAdminPassword(maxId);
        newPassword = owner.flashes(await owner.http.follow(reset)).oneTimePassword ?? "";
      },
      async () => {
        expect(reset.status).toBe(302);
        expect(reset.location).toBe("/admin/team");
        expect(newPassword).toMatch(ADMIN_RESET_PASSWORD_RE);
      }
    );

    let stale!: HttpResult;
    await steps.step(
      "signedOut",
      async () => (stale = await max.dashboard()),
      async () => {
        expect(stale.status).toBe(302);
        expect(stale.location).toBe("/admin/login");
      }
    );

    const maxAgain = await api.admin("Max (new sign-in)");
    let old!: HttpResult;
    await steps.step(
      "oldPassword",
      async () => (old = await maxAgain.signIn("api12.max@example.com", API_PASSWORDS.max)),
      async () => {
        expect(old.status).toBe(401);
        expect(maxAgain.loginError(old)).toBe("That email and password don't match. Check them and try again.");
      }
    );

    let fresh!: HttpResult;
    await steps.step(
      "newPassword",
      async () => (fresh = await maxAgain.signIn("api12.max@example.com", newPassword)),
      async () => {
        expect(fresh.status).toBe(302);
        expect(fresh.location).toBe("/admin");
      }
    );
  });
});
