// E-Mail-Versand über Resend (https://resend.com). Schlüssel kommt aus den Supabase-Secrets, nie aus dem Code.
export type Attachment = { filename: string; content: string; content_type: string };

export async function sendMail(opts: { to: string | string[]; subject: string; html: string; text: string; replyTo?: string; attachments?: Attachment[] }) {
  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('MAIL_FROM'); // z. B. 'TUSÊ Altes Fährhaus <reservierung@deine-domain.de>'
  if (!key || !from) return { ok: false, error: 'mail_not_configured' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text, reply_to: opts.replyTo, attachments: opts.attachments }),
  });
  if (!res.ok) return { ok: false, error: `resend_${res.status}`, detail: await res.text() };
  return { ok: true };
}

export const toBase64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
