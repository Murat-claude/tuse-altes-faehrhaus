// Stornierung durch den Gast (Link in der E-Mail führt auf storno.html der Website, die diese Funktion aufruft).
//   GET  /functions/v1/cancel?token=…   -> Reservierung anzeigen (nur Datum, Zeit, Personen, Status)
//   POST /functions/v1/cancel {token}   -> stornieren
// Absichtlich zwei Schritte: Mail-Scanner rufen Links automatisch auf und würden sonst ungewollt stornieren.
import { admin, cors, json } from '../_shared/common.ts';
import { sendMail, toBase64 } from '../_shared/mail.ts';
import { buildICS, guestMail, restaurantMail } from '../_shared/logic.js';

const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  const url = new URL(req.url);
  let token = url.searchParams.get('token') ?? '';
  if (req.method === 'POST') token = (await req.json().catch(() => ({}))).token ?? token;
  if (!TOKEN_RE.test(token)) return json(req, { ok: false, error: 'invalid_token' }, 400);

  const db = admin();
  const { data: r } = await db.from('reservations').select('*').eq('token', token).maybeSingle();
  if (!r) return json(req, { ok: false, error: 'not_found' }, 404);
  const view = { date: r.date, time: r.time.slice(0, 5), guests: r.guests, name: r.name, status: r.status };
  if (req.method === 'GET') return json(req, { ok: true, reservation: view });
  if (req.method !== 'POST') return json(req, { ok: false, error: 'method_not_allowed' }, 405);
  if (r.status === 'storniert') return json(req, { ok: true, reservation: view, already: true });

  const { data: settings } = await db.from('settings').select('*').eq('id', 1).single();
  await db.from('reservations').update({ status: 'storniert' }).eq('id', r.id);
  r.status = 'storniert';
  const ics = buildICS({ uid: r.ics_uid, summary: `Tisch bei ${settings.restaurant_name}`, date: r.date, time: r.time.slice(0, 5), durationMinutes: settings.duration_minutes, method: 'CANCEL', sequence: 1, attendeeEmail: r.email, organizerEmail: settings.restaurant_email || undefined });
  const att = [{ filename: 'storno.ics', content: toBase64(ics), content_type: 'text/calendar; method=CANCEL; charset=utf-8' }];
  await sendMail({ to: r.email, ...guestMail({ r, settings, cancelled: true }), attachments: att });
  if (settings.restaurant_email) await sendMail({ to: settings.restaurant_email, ...restaurantMail({ r, settings, event: 'storniert' }), attachments: att });
  return json(req, { ok: true, reservation: { ...view, status: 'storniert' } });
});
