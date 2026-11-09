import { request } from "@playwright/test";
import { MAILBOX_URL } from "../support/env";
import { httpLog } from "./HttpSession";

/**
 * The disposable inbox (Mailpit) through its REST API, for API tests: read the
 * invitation a participant received and pull out their link and password.
 */
export interface Invitation {
  subject: string;
  to: string;
  text: string;
  token: string;
  password: string;
}

export class MailApi {
  /** Waits for exactly `count` emails to `email` and returns them, newest first. */
  static async invitationsTo(email: string, count = 1, timeoutMs = 10_000): Promise<Invitation[]> {
    const ctx = await request.newContext({ baseURL: MAILBOX_URL });
    try {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const res = await ctx.get(`/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
        const list = (await res.json()) as { messages: { ID: string }[] };
        if (list.messages.length >= count || Date.now() > deadline) {
          const out: Invitation[] = [];
          for (const m of list.messages) {
            const msg = (await (await ctx.get(`/api/v1/message/${m.ID}`)).json()) as { Subject: string; To: { Address: string }[]; Text: string };
            const link = /personal link: \S*\/q\/([A-Za-z0-9_-]+)/.exec(msg.Text);
            const pw = /with this password: ([A-Za-z0-9]+)/.exec(msg.Text);
            out.push({
              subject: msg.Subject,
              to: msg.To.map((t) => t.Address).join(", "),
              text: msg.Text,
              token: link?.[1] ?? "",
              password: pw?.[1] ?? "",
            });
          }
          httpLog.push({
            who: "mailbox",
            method: "GET",
            path: `${MAILBOX_URL}/api/v1/search?query=to:"${email}"`,
            status: res.status(),
            contentType: "application/json",
            responseBody: out.map((m) => `"${m.subject}" to ${m.to}: link …/q/${m.token}, password ${m.password}`).join("\n") || "(no emails)",
          });
          return out;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    } finally {
      await ctx.dispose();
    }
  }
}
