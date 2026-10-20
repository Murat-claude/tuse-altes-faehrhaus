// Reine Logik ohne Abhängigkeiten: läuft in Deno (Edge Functions), Node (Tests) und im Browser.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateReservation(body) {
  const errors = {};
  const b = body && typeof body === 'object' ? body : {};
  const str = (v) => (typeof v === 'string' ? v.trim() : '');

  if (str(b.website) !== '') errors.spam = 'spam'; // Honeypot-Feld muss leer bleiben
  const name = str(b.name);
  if (name.length < 2 || name.length > 80) errors.name = 'Bitte Namen angeben.';
  const email = str(b.email).toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 120) errors.email = 'Bitte gültige E-Mail angeben.';
  const phone = str(b.phone);
  if (!/^[0-9+()\/\-\s]{5,30}$/.test(phone)) errors.phone = 'Bitte gültige Telefonnummer angeben.';
  const guests = Number(b.guests);
  if (!Number.isInteger(guests) || guests < 1 || guests > 50) errors.guests = 'Bitte Personenzahl wählen.';
  const date = str(b.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + 'T00:00:00Z'))) errors.date = 'Bitte Datum wählen.';
  const time = str(b.time);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) errors.time = 'Bitte Uhrzeit wählen.';
  const note = str(b.note);
  if (note.length > 500) errors.note = 'Anmerkung ist zu lang (max. 500 Zeichen).';
  if (b.consent !== true && b.consent !== 'true' && b.consent !== 'on') errors.consent = 'Bitte Datenschutz bestätigen.';

  return { ok: Object.keys(errors).length === 0, errors, data: { name, email, phone, guests, date, time, note } };
}

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function formatDateDe(date) {
  const d = new Date(date + 'T12:00:00Z');
  return new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
}

// ---------- iCalendar (.ics) ----------
const icsEscape = (t) => String(t ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

function fold(line) {
  // Zeilen höchstens 75 Oktette, Fortsetzung mit Leerzeichen (UTF-8-sicher)
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  let len = 0;
  for (const ch of line) {
    const l = enc.encode(ch).length;
    if (len + l > (out.length === 0 ? 75 : 74)) { out.push(cur); cur = ''; len = 0; }
    cur += ch; len += l;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function stamp(dateStr, timeStr, addMinutes = 0) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, hh, mm + addMinutes));
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}T${p(t.getUTCHours())}${p(t.getUTCMinutes())}00`;
}

const VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:Europe/Berlin',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];

/** @param {Record<string, any>} o */
export function buildICS({ uid, summary, description, location, date, time, durationMinutes = 120, organizerEmail, attendeeEmail, attendeeName, method = 'REQUEST', sequence = 0, now = new Date() }) {
  const nowStamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TUSE Altes Faehrhaus//Reservierung//DE', 'CALSCALE:GREGORIAN', `METHOD:${method}`,
    ...VTIMEZONE,
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${nowStamp}`,
    `SEQUENCE:${sequence}`,
    `DTSTART;TZID=Europe/Berlin:${stamp(date, time)}`,
    `DTEND;TZID=Europe/Berlin:${stamp(date, time, durationMinutes)}`,
    `SUMMARY:${icsEscape(summary)}`,
    description ? `DESCRIPTION:${icsEscape(description)}` : null,
    location ? `LOCATION:${icsEscape(location)}` : null,
    organizerEmail ? `ORGANIZER;CN=${icsEscape('TUSÊ Altes Fährhaus')}:mailto:${organizerEmail}` : null,
    attendeeEmail ? `ATTENDEE;CN=${icsEscape(attendeeName || attendeeEmail)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:${attendeeEmail}` : null,
    `STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Erinnerung: Tischreservierung', 'TRIGGER:-PT2H', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean);
  return lines.map(fold).join('\r\n') + '\r\n';
}

// ---------- E-Mail-Texte ----------
const wrap = (inner) => `<!doctype html><html lang="de"><body style="margin:0;background:#1b1510;font-family:Georgia,serif;color:#f1e6d0"><div style="max-width:560px;margin:0 auto;padding:28px"><div style="text-align:center;letter-spacing:.2em;color:#c9a96e;font-size:22px">TUSÊ<br><span style="font-size:11px;letter-spacing:.35em">ALTES FÄHRHAUS</span></div><div style="background:#2a2118;border:1px solid #6b5636;border-radius:6px;padding:24px;margin-top:20px;line-height:1.55">${inner}</div></div></body></html>`;

/** @param {Record<string, any>} o */
export function guestMail({ r, settings, cancelUrl, cancelled = false, pending = false }) {
  const when = `${formatDateDe(r.date)}, ${r.time.slice(0, 5)} Uhr`;
  const summaryHtml = `<p style="margin:0 0 14px"><strong style="color:#e2c48e">${esc(when)}</strong><br>${esc(r.guests)} ${r.guests === 1 ? 'Person' : 'Personen'} · auf den Namen ${esc(r.name)}</p>`;
  if (cancelled) {
    return {
      subject: `Stornierung: ${when}`,
      html: wrap(`<h2 style="margin-top:0;color:#e2c48e">Ihre Reservierung wurde storniert</h2>${summaryHtml}<p>Wir würden uns freuen, Sie ein anderes Mal bei uns zu begrüßen.</p>`),
      text: `Ihre Reservierung wurde storniert.\n${when}, ${r.guests} Personen\n\n${settings.restaurant_name}`,
    };
  }
  const head = pending ? 'Wir haben Ihre Anfrage erhalten' : 'Ihr Tisch ist reserviert';
  const lead = pending ? 'Wir bestätigen Ihre Reservierung in Kürze per E-Mail.' : 'Wir freuen uns auf Ihren Besuch.';
  const cancelBlock = cancelUrl ? `<p style="font-size:13px;color:#b3a58f">Falls Sie nicht kommen können: <a style="color:#c9a96e" href="${esc(cancelUrl)}">Reservierung stornieren</a>.</p>` : '';
  return {
    subject: `${pending ? 'Anfrage erhalten' : 'Reservierung bestätigt'}: ${when}`,
    html: wrap(`<h2 style="margin-top:0;color:#e2c48e">${head}</h2>${summaryHtml}<p>${lead} Die Kalender-Einladung finden Sie im Anhang.</p>${r.note ? `<p style="font-size:13px;color:#b3a58f">Ihre Anmerkung: ${esc(r.note)}</p>` : ''}${cancelBlock}<p style="font-size:13px;color:#b3a58f">${esc(settings.restaurant_name)} · ${esc(settings.restaurant_address)}</p>`),
    text: `${head}\n${when}, ${r.guests} Personen, ${r.name}\n${lead}\n${cancelUrl ? `\nStornieren: ${cancelUrl}\n` : ''}\n${settings.restaurant_name}, ${settings.restaurant_address}`,
  };
}

/** @param {Record<string, any>} o */
export function restaurantMail({ r, settings, adminUrl, event = 'neu' }) {
  const when = `${formatDateDe(r.date)}, ${r.time.slice(0, 5)} Uhr`;
  const label = event === 'storniert' ? 'Stornierung' : 'Neue Reservierung';
  return {
    subject: `${label}: ${when} · ${r.guests} Pers. · ${r.name}`,
    html: wrap(`<h2 style="margin-top:0;color:#e2c48e">${label}</h2><p><strong>${esc(when)}</strong><br>${esc(r.guests)} Personen</p><p>${esc(r.name)}<br>${esc(r.phone)}<br>${esc(r.email)}</p>${r.note ? `<p>Anmerkung: ${esc(r.note)}</p>` : ''}${adminUrl ? `<p><a style="color:#c9a96e" href="${esc(adminUrl)}">Im Kalender öffnen</a></p>` : ''}`),
    text: `${label}\n${when}, ${r.guests} Personen\n${r.name}, ${r.phone}, ${r.email}\n${r.note ? 'Anmerkung: ' + r.note + '\n' : ''}${adminUrl || ''}`,
  };
}
