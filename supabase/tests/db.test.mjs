import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
for (const r of ['anon','authenticated','service_role']) await db.exec(`create role ${r}`);
await db.exec(fs.readFileSync(new URL('../migrations/001_buchung.sql', import.meta.url),'utf8'));
// Datum in 3 Tagen
const day = (await db.query(`select (now() at time zone 'Europe/Berlin')::date + 3 as d`)).rows[0].d;
const d = new Date(day).toISOString().slice(0,10);
const slots = async (g=2) => (await db.query(`select * from get_slots($1::date,$2)`,[d,g])).rows;
let s = await slots();
console.log('Slots:', s.length, s[0], s.at(-1));
assert.equal(s.length, 10);                 // 17:00..21:30 alle 30 Min
assert.ok(s.every(x=>x.available && x.free===40));
// kleine Kapazität zum Testen
await db.exec(`update settings set capacity=10, duration_minutes=120`);
const book = (t,g) => db.query(`select * from book_table($1::date,$2,$3,'Max Muster','max@example.de','0171 1234567',null)`,[d,t,g]);
let r = (await book('18:00',6)).rows[0];
console.log('gebucht:', r.status, r.ics_uid.slice(-30));
assert.equal(r.status,'bestaetigt');
s = await slots(4);
const at = t=>s.find(x=>x.slot===t);
assert.equal(at('17:00').free, 4);          // 17:00 + 2h überlappt mit 18:00 -> Spitze 6
assert.ok(at('17:00').available);            // 4 Plätze frei, 4 Gäste ok
assert.equal((await slots(5)).find(x=>x.slot==='17:00').available, false);
assert.equal(at('19:30').free, 4);          // 19:30 liegt noch in 18:00–20:00
assert.equal(at('20:00').free, 10);         // Ende exklusiv: ab 20:00 wieder alles frei
await assert.rejects(book('18:30',5), /slot_unavailable/);   // 6+5 > 10
r = (await book('18:30',4)).rows[0];         // 6+4 = 10 ok
await assert.rejects(book('19:00',1), /slot_unavailable/);   // voll
// storniert gibt Plätze frei
await db.query(`update reservations set status='storniert' where id=$1`,[r.id]);
assert.equal((await slots(4)).find(x=>x.slot==='19:00').available, true);
// Großgruppe
await db.exec(`update settings set capacity=40`);
await assert.rejects(book('21:00',13), /slot_unavailable/);
// Sperrtag
await db.query(`insert into closed_days(day) values($1)`,[d]);
assert.equal((await slots()).length, 0);
// Vergangenheit
assert.equal((await db.query(`select * from get_slots(current_date - 1, 2)`)).rows.length, 0);
// Spätes Slot-Ende über Mitternacht
await db.exec(`delete from closed_days; update settings set max_party=50, opening='{"mon":[["22:00","23:30"]],"tue":[["22:00","23:30"]],"wed":[["22:00","23:30"]],"thu":[["22:00","23:30"]],"fri":[["22:00","23:30"]],"sat":[["22:00","23:30"]],"sun":[["22:00","23:30"]]}'`);
await book('23:00',20);
assert.equal((await slots(30)).find(x=>x.slot==='23:30').available, false); // 20 + 30 > 40
assert.equal((await slots(20)).find(x=>x.slot==='23:30').available, true);
console.log('ALLE SQL-TESTS OK');
