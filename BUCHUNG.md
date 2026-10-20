# Buchungssystem – Einrichtung

Gäste buchen auf der Website, das Restaurant bekommt eine E-Mail mit Kalender-Einladung (.ics) und verwaltet alles in `admin.html`.

```
Website (js/booking.js) ──► Edge Function "reserve" ──► Datenbank (Kapazitätsprüfung, atomar)
                                   └──► E-Mail an Gast + Restaurant (Resend), je mit .ics-Anhang
Admin  (admin.html) ──► Supabase (Login) ──► Kalender, Status ändern (Edge Function "set-status"), Tage sperren, Einstellungen
Gast   (storno.html) ──► Edge Function "cancel" (2 Schritte: ansehen, dann bestätigen)
```

## Einmalige Einrichtung (ca. 30 Minuten)

### 1. Supabase-Projekt
1. Projekt anlegen (Region Frankfurt/EU).
2. **Authentication → Providers → Email:** „Allow new users to sign up" **ausschalten**. Wichtig: Jeder angemeldete Nutzer darf alle Reservierungen sehen. Mitarbeiter legst du selbst unter **Authentication → Users → Add user** an.
3. SQL einspielen: `supabase/migrations/001_buchung.sql` im **SQL Editor** ausführen (oder `supabase db push`).
4. Unter **Project Settings → API** die Werte `Project URL` und `anon public` Key kopieren.

### 2. E-Mail (Resend)
1. Konto auf resend.com, Domain des Restaurants verifizieren (DNS-Einträge), API-Schlüssel erzeugen.
2. Absender, z. B. `TUSÊ Altes Fährhaus <reservierung@deine-domain.de>`.

### 3. Edge Functions deployen (Supabase CLI)
```
supabase login
supabase link --project-ref <PROJEKT-REF>
supabase secrets set RESEND_API_KEY=<schlüssel>            # nicht in den Chat/Code schreiben
supabase secrets set MAIL_FROM="TUSÊ Altes Fährhaus <reservierung@deine-domain.de>"
supabase secrets set SITE_URL=https://deine-website.de       # Basis für Stornolink und Admin-Link
supabase secrets set SITE_ORIGINS=https://deine-website.de   # erlaubte Herkunft (CORS)
supabase functions deploy reserve cancel set-status
```
`SUPABASE_URL`, `SUPABASE_ANON_KEY` und `SUPABASE_SERVICE_ROLE_KEY` setzt Supabase selbst.

### 4. Website verbinden
In `js/config.js` eintragen:
```js
window.TUSE_CONFIG = { supabaseUrl: "https://<PROJEKT-REF>.supabase.co", supabaseAnonKey: "<anon public key>", maxParty: 12 };
```
Nur den **anon**-Schlüssel, niemals `service_role`.

### 5. Restaurant einrichten
`admin.html` öffnen, anmelden, **Einstellungen**: E-Mail des Restaurants, Sitzplätze, Öffnungszeiten, Dauer pro Tisch.
Die Öffnungszeiten in der Datenbank sind **Platzhalter** (täglich 17:00–21:30) und müssen vom Inhaber bestätigt werden.

## So funktioniert die Kapazität
- Jede Reservierung belegt ihre Gäste für `duration_minutes` (Standard 120 Min.).
- Ein Zeitfenster ist frei, wenn auf der **ganzen Dauer** der neuen Reservierung genug Plätze frei sind.
- Gebucht wird in einer Datenbank-Transaktion mit Sperre pro Tag, zwei gleichzeitige Gäste können denselben letzten Platz nicht doppelt buchen.
- Gruppen über `max_party` (Standard 12) buchen nicht online, sondern fragen über „Feiern" an.
- Tage sperren: im Admin-Kalender auf den Tag klicken, „Tag sperren".

## Tests
`npm install && npm test` prüft die Datenbank-Logik (in-memory Postgres), Validierung, Kalender-Datei und E-Mail-Texte.
Nicht automatisch getestet: der echte Versand über Resend und das Deployment, das muss nach der Einrichtung einmal mit einer Testbuchung geprüft werden.

## Datenschutz (vom Inhaber/Anwalt prüfen lassen)
Gespeichert werden Name, E-Mail, Telefon, Anmerkung und Reservierungsdaten. Dienstleister: Supabase (Datenbank), Resend (E-Mail). Im Datenschutztext nennen, Auftragsverarbeitungsverträge abschließen, Löschfristen festlegen (z. B. Reservierungen 3 Monate nach dem Termin löschen).
