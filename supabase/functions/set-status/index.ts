// POST /functions/v1/set-status  { id, status }  – nur für eingeloggte Mitarbeiter (JWT wird geprüft).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { admin, cors, json } from '../_shared/common.ts';
import { sendMail, toBase64 } from '../_shared/mail.ts';
import { buildICS, guestMail } from '../_shared/logic.js';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { ok: false, error: 'method_not_allowed' }, 405);
  const auth = req.headers.get('Authorization') ?? '';
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user) return json(req, { ok: false, error: 'unauthorized' }, 401);

  const { id, status } = await req.json().catch(() => ({}));
  if (!id || !['bestaetigt', 'storniert', 'neu'].includes(status)) return json(req, { ok: false, error: 'validation' }, 422);
  const db = admin();
  const { data: r, error } = await db.from('reservations').update({ status }).eq('id', id).select().single();
  if (error || !r) return json(req, { ok: false, error: 'not_found' }, 404);
  const { data: settings } = await db.from('settings').select('*').eq('id', 1).single();

  let mail = false;
  if (status === 'storniert' || status === 'bestaetigt') {
    const cancelled = status === 'storniert';
    const ics = buildICS({ uid: r.ics_uid, summary: `Tisch bei ${settings.restaurant_name} (${r.guests} Pers.)`, location: `${settings.restaurant_name}, ${settings.restaurant_address}`, date: r.date, time: r.time.slice(0, 5), durationMinutes: settings.duration_minutes, method: cancelled ? 'CANCEL' : 'REQUEST', sequence: cancelled ? 1 : 0, attendeeEmail: r.email, attendeeName: r.name, organizerEmail: settings.restaurant_email || undefined });
    const siteUrl = Deno.env.get('SITE_URL') ?? '';
    const cancelUrl = siteUrl ? `${siteUrl.replace(/\/$/, '')}/storno.html?token=${r.token}` : '';
    const res = await sendMail({ to: r.email, ...guestMail({ r, settings, cancelUrl: cancelled || !cancelUrl ? undefined : cancelUrl, cancelled }), attachments: [{ filename: 'reservierung.ics', content: toBase64(ics), content_type: `text/calendar; method=${cancelled ? 'CANCEL' : 'REQUEST'}; charset=utf-8` }] });
    mail = res.ok;
  }
  return json(req, { ok: true, status, mail });
});
