const nodemailer = require("nodemailer");
const config = require("../config");

const configured = Boolean(config.smtp.host);

const transport = configured
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      // Reuse a few connections for big invite batches instead of one per email.
      // Not on serverless: a frozen instance would leave pooled sockets half-dead.
      pool: !config.serverless,
      maxConnections: 3,
    })
  : null;

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function inviteEmail({ name, quizTitle, questionCount, durationMinutes, link, password, email }) {
  const subject = `You're invited to take "${quizTitle}"`;
  const greeting = name ? `Hi ${name},` : "Hi,";
  const text = [
    greeting,
    "",
    `You have been invited to take the quiz "${quizTitle}".`,
    `${questionCount} question${questionCount === 1 ? "" : "s"} · ${durationMinutes} minute${durationMinutes === 1 ? "" : "s"}`,
    "",
    `1. Open your personal link: ${link}`,
    `2. Sign in with this password: ${password}`,
    "",
    "The timer starts only when you press “Start quiz”. When the time is up, your answers are submitted automatically.",
    "This link and password are for you only — please don't share them.",
    "",
    "Good luck!",
  ].join("\n");

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f5f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2433">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f8;padding:32px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e4e6ee">
  <tr><td style="background:#4f46e5;padding:22px 32px;color:#ffffff;font-size:15px;font-weight:600;letter-spacing:.2px">${esc(config.appName)}</td></tr>
  <tr><td style="padding:32px">
    <p style="margin:0 0 8px;font-size:15px">${esc(greeting)}</p>
    <h1 style="margin:0 0 6px;font-size:22px;line-height:1.3;color:#111827">You're invited to take “${esc(quizTitle)}”</h1>
    <p style="margin:0 0 24px;color:#5b6275;font-size:14px">${questionCount} question${questionCount === 1 ? "" : "s"} &nbsp;·&nbsp; ${durationMinutes} minute${durationMinutes === 1 ? "" : "s"}</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7fb;border:1px solid #e4e6ee;border-radius:10px;margin:0 0 24px">
      <tr><td style="padding:16px 20px">
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:#6b7280;margin-bottom:4px">Email</div>
        <div style="font-size:15px;margin-bottom:14px">${esc(email)}</div>
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:#6b7280;margin-bottom:4px">Your password</div>
        <div style="font-family:SFMono-Regular,Menlo,Consolas,monospace;font-size:20px;font-weight:600;letter-spacing:2px;color:#111827">${esc(password)}</div>
      </td></tr>
    </table>

    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px"><tr><td style="border-radius:8px;background:#4f46e5">
      <a href="${esc(link)}" style="display:inline-block;padding:13px 26px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px">Open quiz</a>
    </td></tr></table>

    <p style="margin:0 0 8px;font-size:14px;color:#374151"><strong>Before you start</strong></p>
    <ul style="margin:0 0 20px;padding-left:20px;font-size:14px;color:#4b5563;line-height:1.6">
      <li>The timer starts only when you press <strong>Start quiz</strong>.</li>
      <li>Your answers save automatically as you go.</li>
      <li>When time runs out, your answers are submitted automatically.</li>
    </ul>
    <p style="margin:0;font-size:12px;color:#8a90a2;line-height:1.5">This link and password are personal — please don't share them.<br>If the button doesn't work, paste this link into your browser:<br><a href="${esc(link)}" style="color:#4f46e5;word-break:break-all">${esc(link)}</a></p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  return { subject, text, html };
}

/**
 * Send an invitation. Resolves to { status: 'sent'|'failed'|'not_configured', error? }.
 * When SMTP isn't configured the email is printed to the console instead.
 */
async function sendInvite(to, details) {
  const msg = inviteEmail({ ...details, email: to });
  if (!configured) {
    console.log(`\n[mail:not-configured] To: ${to}\nSubject: ${msg.subject}\n${msg.text}\n`);
    return { status: "not_configured" };
  }
  try {
    await transport.sendMail({ from: config.smtp.from, to, subject: msg.subject, text: msg.text, html: msg.html });
    return { status: "sent" };
  } catch (err) {
    console.error("[mail] send failed", to, err.message);
    return { status: "failed", error: err.message };
  }
}

module.exports = { configured, sendInvite, inviteEmail };
