import nodemailer from "nodemailer";

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const { GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return null;
  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
  return transporter;
}

export function isEmailConfigured() {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

/**
 * Sends an email via Gmail SMTP using an App Password (Google Account >
 * Security > 2-Step Verification > App Passwords). This is the practical
 * route for a small clinic — full Gmail API OAuth is overkill for sending
 * from one shared clinic mailbox.
 */
export async function sendEmail({ to, subject, html, attachments }) {
  const t = getTransporter();
  if (!t) {
    throw new Error(
      "Email is not configured. Add GMAIL_USER and GMAIL_APP_PASSWORD to backend/.env to enable this feature."
    );
  }
  return t.sendMail({
    from: `"Dr. Nishita's Clinic — Work Hub" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    html,
    attachments,
  });
}
