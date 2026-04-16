import postmark from "postmark";
import { config } from "../config.js";
import type { BlogVersionDocument } from "../models/blogVersion.js";

interface MailResult {
  delivered: boolean;
  message: string;
}

function createClient(): postmark.ServerClient | null {
  if (!config.postmarkServerToken) {
    return null;
  }

  return new postmark.ServerClient(config.postmarkServerToken);
}

export async function sendApprovalEmail(blog: BlogVersionDocument): Promise<MailResult> {
  const client = createClient();
  const reviewUrl = `${config.clientUrl}/review/${blog._id}`;
  const recipient = blog.approval_email || config.approvalEmail;

  if (!client) {
    return {
      delivered: false,
      message: `Postmark is not configured. Review manually at ${reviewUrl}`
    };
  }

  await client.sendEmail({
    From: config.mailFrom,
    To: recipient,
    Subject: `Blog approval needed: ${blog.title}`,
    HtmlBody: `
      <div style="margin:0;padding:32px 16px;background:#f3f7fb;font-family:Segoe UI,Arial,sans-serif;color:#17324d;">
        <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #dbe5ef;border-radius:24px;overflow:hidden;box-shadow:0 18px 40px rgba(23,50,77,0.08);">
          <div style="padding:28px 32px;background:linear-gradient(135deg,#133d5d 0%,#245b7f 100%);color:#ffffff;">
            <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;opacity:0.82;">Zigme Blog Review</p>
            <h1 style="margin:0;font-size:28px;line-height:1.2;font-weight:700;">Blog approval request</h1>
          </div>

          <div style="padding:28px 32px;">
            <div style="display:inline-block;padding:8px 12px;border-radius:999px;background:#eef5f8;color:#163955;font-size:13px;font-weight:700;margin-bottom:18px;">
              ${blog.site}
            </div>

            <h2 style="margin:0 0 14px;font-size:26px;line-height:1.25;color:#17324d;">${blog.title}</h2>

            <p style="margin:0 0 22px;font-size:16px;line-height:1.7;color:#47627a;">
              ${blog.summary}
            </p>

            <div style="padding:18px;border-radius:18px;background:#f8fbfd;border:1px solid #e1ebf2;margin-bottom:24px;">
              <p style="margin:0;font-size:14px;line-height:1.7;color:#47627a;">
                Review this draft and decide whether it should be approved or regenerated.
              </p>
            </div>

            <a
              href="${reviewUrl}"
              style="display:inline-block;padding:14px 22px;border-radius:999px;background:#c07a1e;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;"
            >
              Open Review Page
            </a>

            <p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#60778d;">
              If the button does not work, open this link manually:<br />
              <a href="${reviewUrl}" style="color:#0b5a72;text-decoration:underline;word-break:break-all;">${reviewUrl}</a>
            </p>
          </div>
        </div>
      </div>
    `
  });

  return { delivered: true, message: `Approval email sent to ${recipient}` };
}
