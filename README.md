# TUSÊ Altes Fährhaus – Website (Pitch-Demo)

Statische Website (HTML/CSS/JS) mit Intro, blätterbarem Speisebuch, Reservierungs- und Event-Formular.

## Struktur
- `index.html`, `css/style.css`, `js/app.js` – Seite
- `data/menu.json` – Speisekarte (Quelle für Buch und Liste)
- `db/schema.sql` – Supabase-Tabellen (Reservierungen, Event-Anfragen) inkl. Row-Level-Security
- `js/config.js` – Supabase-URL und **anon**-Key eintragen (leer = Demo-Modus)
- `assets/hero.mp4` – optionales Hero-Video (fehlt es, wird der Farbverlauf gezeigt)

## Offene Punkte (vom Inhaber zu klären)
- Anschrift, genaue Öffnungszeiten, Telefonnummer
- Allergene/Zusatzstoffe je Gericht, Bestätigung der Kennzeichnung „vegetarisch" (`tags_verified` in `menu.json`)
- Nummern 172–199 der Karte (vermutlich Weinkarte) fehlen in der Vorlage
- Impressum und Datenschutz (Platzhalter)
- Fotos/Videos: eigene Aufnahmen oder freigegebene Bilder

Vorschau: `index.html` per Doppelklick öffnen (Speisekarte kommt aus `data/menu.js`, erzeugt mit `python3 scripts/build-menu-js.py` aus `data/menu.json`).
