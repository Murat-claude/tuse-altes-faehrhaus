import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReservation, buildICS, guestMail, restaurantMail, esc } from './logic.js';

const ok = { name: 'Max Muster', email: 'Max@Example.de', phone: '0171 1234567', guests: 4, date: '2026-11-07', time: '19:00', note: '', consent: true, website: '' };

test('gültige Reservierung', () => {
  const v = validateReservation(ok);
  assert.equal(v.ok, true);
  assert.equal(v.data.email, 'max@example.de');
});
test('ungültige Eingaben', () => {
  const v = validateReservation({ ...ok, name: 'A', email: 'x', phone: 'abc', guests: 0, date: '2026-13-45', time: '25:00', consent: false });
  assert.equal(v.ok, false);
  for (const k of ['name', 'email', 'phone', 'guests', 'date', 'time', 'consent']) assert.ok(v.errors[k], k);
});
test('Honeypot blockt Spam', () => assert.equal(validateReservation({ ...ok, website: 'http://spam' }).errors.spam, 'spam'));
test('HTML wird escaped', () => assert.equal(esc('<b>"x"&</b>'), '&lt;b&gt;&quot;x&quot;&amp;&lt;/b&gt;'));

test('ICS enthält Pflichtfelder und Zeitzone', () => {
  const ics = buildICS({ uid: 'abc@t', summary: 'Tisch für 4', description: 'Zeile 1\nZeile 2\; mit, Zeichen', location: 'Hamm', date: '2026-11-07', time: '19:00', organizerEmail: 'info@x.de', attendeeEmail: 'gast@x.de', attendeeName: 'Gast', now: new Date('2026-10-01T10:00:00Z') });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /METHOD:REQUEST/);
  assert.match(ics, /DTSTART;TZID=Europe\/Berlin:20261107T190000/);
  assert.match(ics, /DTEND;TZID=Europe\/Berlin:20261107T210000/);
  assert.match(ics, /DTSTAMP:20261001T100000Z/);
  assert.match(ics, /DESCRIPTION:Zeile 1\\nZeile 2\\; mit\\, Zeichen/);
  assert.match(ics, /UID:abc@t/);
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  for (const l of ics.split('\r\n')) assert.ok(new TextEncoder().encode(l).length <= 75, 'zu lange Zeile: ' + l);
});
test('ICS über Mitternacht und Storno', () => {
  const ics = buildICS({ uid: 'u', summary: 's', date: '2026-12-31', time: '23:00', durationMinutes: 120, method: 'CANCEL', sequence: 1, now: new Date('2026-10-01T10:00:00Z') });
  assert.match(ics, /DTEND;TZID=Europe\/Berlin:20270101T010000/);
  assert.match(ics, /METHOD:CANCEL/);
  assert.match(ics, /STATUS:CANCELLED/);
});
test('lange Zeilen mit Umlauten werden korrekt gefaltet', () => {
  const ics = buildICS({ uid: 'u', summary: 'Ä'.repeat(60), date: '2026-11-07', time: '19:00' });
  for (const l of ics.split('\r\n')) assert.ok(new TextEncoder().encode(l).length <= 75);
  const unfolded = ics.replace(/\r\n /g, '');
  assert.match(unfolded, new RegExp('SUMMARY:' + 'Ä'.repeat(60)));
});
test('E-Mails enthalten Daten und escapen Eingaben', () => {
  const r = { date: '2026-11-07', time: '19:00:00', guests: 4, name: '<script>x</script>', phone: '0171', email: 'a@b.de', note: 'Kinderstuhl' };
  const settings = { restaurant_name: 'TUSÊ Altes Fährhaus', restaurant_address: 'Hamm' };
  const g = guestMail({ r, settings, cancelUrl: 'https://x/cancel?token=1' });
  assert.match(g.subject, /Reservierung bestätigt/);
  assert.match(g.subject, /19:00 Uhr/);
  assert.ok(!g.html.includes('<script>'));
  assert.match(g.html, /Reservierung stornieren/);
  const rm = restaurantMail({ r, settings, adminUrl: 'https://x/admin.html' });
  assert.match(rm.subject, /Neue Reservierung/);
  assert.match(guestMail({ r, settings, cancelled: true }).subject, /Stornierung/);
});
