// POST /functions/v1/reserve  – nimmt eine Reservierung entgegen, prüft Kapazität, sendet E-Mails mit Kalender-Einladung.
import { admin, cors, json } from '../_shared/common.ts';
import { sendMail, toBase64 } from '../_shared/mail.ts';
import { validateReservation, buildICS, guestMail, restaurantMail } from '../_shared/logic.js';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { ok: false, error: 'method_not_allowed' }, 405);

  let body: unknown;
  try { body = await req.json(); } catch { return json(req, { ok: false, error: 'invalid_json' }, 400); }
  const v = validateReservation(body);
  if (v.errors.spam) return json(req, { ok: true }); // Bots bekommen scheinbar Erfolg, es wird nichts gespeichert
  if (!v.ok) return json(req, { ok: false, error: 'validation', fields: v.errors }, 422);

  const db = admin();
  const { date, time, guests, name, email, phone, note } = v.data;
  const { data: r, error } = await db.rpc('book_table', { p_date: date, p_time: time, p_guests: guests, p_name: name, p_email: email, p_phone: phone, p_note: note || null });
  if (error) {
    if (String(error.message).includes('slot_unavailable')) return json(req, { ok: false, error: 'slot_unavailable' }, 409);
    console.error('book_table', error);
    return json(req, { ok: false, error: 'server' }, 500);
  }

  const { data: settings } = await db.from('settings').select('*').eq('id', 1).single();
  const siteUrl = Deno.env.get('SITE_URL') ?? '';
  const cancelUrl = siteUrl ? `${siteUrl.replace(/\/$/, '')}/storno.html?token=${r.token}` : '';
  const pending = r.status === 'neu';
  const ics = buildICS({
    uid: r.ics_uid, summary: `Tisch bei ${settings.restaurant_name} (${r.guests} Pers.)`, description: `Reservierung auf den Namen ${r.name}.${r.note ? ' Anmerkung: ' + r.note : ''}`,
    location: `${settings.restaurant_name}, ${settings.restaurant_address}`, date: r.date, time: r.time.slice(0, 5), durationMinutes: settings.duration_minutes,
    organizerEmail: settings.restaurant_email || undefined, attendeeEmail: r.email, attendeeName: r.name,
  });
  const attachments = [{ filename: 'reservierung.ics', content: toBase64(ics), content_type: 'text/calendar; method=REQUEST; charset=utf-8' }];

  const g = guestMail({ r, settings, cancelUrl, pending });
  const guestRes = await sendMail({ to: r.email, ...g, replyTo: settings.restaurant_email || undefined, attachments });
  let restRes: { ok: boolean } = { ok: true };
  if (settings.restaurant_email) {
    const m = restaurantMail({ r, settings, adminUrl: siteUrl ? `${siteUrl.replace(/\/$/, '')}/admin.html` : undefined });
    restRes = await sendMail({ to: settings.restaurant_email, ...m, replyTo: r.email, attachments });
  }
  if (!guestRes.ok || !restRes.ok) console.error('mail', guestRes, restRes);
  return json(req, { ok: true, id: r.id, status: r.status, mail: guestRes.ok });
});
