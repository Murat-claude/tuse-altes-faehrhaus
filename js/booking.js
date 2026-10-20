// Buchungs-Anbindung: lädt freie Zeiten aus Supabase und sendet Reservierungen an die Edge Function "reserve".
// Wird automatisch aktiv, sobald js/config.js eine supabaseUrl enthält. Ohne Konfiguration bleibt der Demo-Modus.
(function () {
  'use strict';
  var C = window.TUSE_CONFIG || {};
  if (!C.supabaseUrl || !C.supabaseAnonKey) return;
  var form = document.getElementById('form-res');
  if (!form) return;

  var dateEl = form.elements.date, timeEl = form.elements.time, guestsEl = form.elements.guests;
  var msg = form.querySelector('.form-msg');
  var btn = form.querySelector('button[type="submit"]');
  var MAX_PARTY = C.maxParty || 12;

  // Honeypot gegen Spam-Bots (für Menschen unsichtbar)
  if (!form.elements.website) {
    var hp = document.createElement('input');
    hp.type = 'text'; hp.name = 'website'; hp.tabIndex = -1; hp.autocomplete = 'off'; hp.setAttribute('aria-hidden', 'true');
    hp.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;opacity:0';
    form.appendChild(hp);
  }

  function say(text, ok) { if (!msg) return; msg.className = 'form-msg ' + (ok ? 'ok' : 'err'); msg.textContent = text; }
  function headers() { return { 'Content-Type': 'application/json', apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + C.supabaseAnonKey }; }

  var seq = 0;
  function loadSlots() {
    var date = dateEl.value, guests = parseInt(guestsEl.value, 10) || 2, mine = ++seq;
    timeEl.textContent = '';
    if (!date) return;
    if (guests > MAX_PARTY) { var o = document.createElement('option'); o.value = ''; o.textContent = 'Für größere Gruppen bitte unten „Feiern" nutzen'; timeEl.appendChild(o); return; }
    var wait = document.createElement('option'); wait.textContent = 'Lade freie Zeiten …'; wait.value = ''; timeEl.appendChild(wait);
    fetch(C.supabaseUrl + '/rest/v1/rpc/get_slots', { method: 'POST', headers: headers(), body: JSON.stringify({ p_date: date, p_guests: guests }) })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (slots) {
        if (mine !== seq) return;
        timeEl.textContent = '';
        var free = slots.filter(function (s) { return s.available; });
        if (free.length === 0) {
          var n = document.createElement('option'); n.value = ''; n.textContent = slots.length ? 'Leider ausgebucht' : 'An diesem Tag geschlossen'; timeEl.appendChild(n);
          return;
        }
        free.forEach(function (s, i) { var o = document.createElement('option'); o.value = s.slot; o.textContent = s.slot + ' Uhr'; if (i === 0) o.selected = true; timeEl.appendChild(o); });
      })
      .catch(function () { if (mine === seq) { timeEl.textContent = ''; var e = document.createElement('option'); e.value = ''; e.textContent = 'Zeiten konnten nicht geladen werden'; timeEl.appendChild(e); } });
  }
  dateEl.addEventListener('change', loadSlots);
  guestsEl.addEventListener('change', loadSlots);
  loadSlots();

  // Capture-Phase, damit der Demo-Handler aus app.js nicht zusätzlich läuft.
  document.addEventListener('submit', function (ev) {
    if (ev.target !== form) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    if (!form.checkValidity() || !timeEl.value) { form.reportValidity(); if (!timeEl.value) say('Bitte eine freie Uhrzeit wählen.', false); return; }
    var f = new FormData(form);
    var payload = { date: f.get('date'), time: f.get('time'), guests: parseInt(f.get('guests'), 10), name: f.get('name'), email: f.get('email'), phone: f.get('phone'), note: f.get('note') || '', consent: !!f.get('consent'), website: f.get('website') || '' };
    btn.disabled = true; say('Einen Moment …', true);
    fetch(C.supabaseUrl + '/functions/v1/reserve', { method: 'POST', headers: headers(), body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        if (res.body.ok) {
          var pending = res.body.status === 'neu';
          say(pending ? 'Danke! Wir haben Ihre Anfrage erhalten und bestätigen sie per E-Mail.' : 'Ihr Tisch ist reserviert. Die Bestätigung mit Kalender-Einladung ist unterwegs.', true);
          form.reset(); dateEl.value = payload.date; loadSlots();
        } else if (res.body.error === 'slot_unavailable') { say('Diese Zeit wurde gerade vergeben. Bitte wählen Sie eine andere.', false); loadSlots(); }
        else if (res.body.error === 'validation') { say('Bitte prüfen Sie Ihre Angaben: ' + Object.values(res.body.fields || {}).join(' '), false); }
        else say('Das hat leider nicht geklappt. Bitte versuchen Sie es erneut oder rufen Sie uns an.', false);
      })
      .catch(function () { say('Keine Verbindung. Bitte versuchen Sie es erneut.', false); })
      .then(function () { btn.disabled = false; });
  }, true);
})();
