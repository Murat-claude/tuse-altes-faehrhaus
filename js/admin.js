(function () {
  'use strict';
  var C = window.TUSE_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var DOW = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  var KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  var DAYNAME = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

  if (!C.supabaseUrl || !C.supabaseAnonKey || !window.supabase) {
    document.body.textContent = 'Supabase ist nicht konfiguriert (js/config.js).';
    return;
  }
  var sb = window.supabase.createClient(C.supabaseUrl, C.supabaseAnonKey);

  var state = { month: firstOfMonth(new Date()), selected: iso(new Date()), res: [], closed: {}, settings: null };

  function iso(d) { var t = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return t.toISOString().slice(0, 10); }
  function firstOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function say(text, ok) { var m = $('msg'); m.className = 'form-msg ' + (ok ? 'ok' : 'err'); m.textContent = text || ''; }

  /* ---------- Login ---------- */
  function showLogin() { $('login').hidden = false; $('app').hidden = true; }
  function showApp() { $('login').hidden = true; $('app').hidden = false; loadAll(); }
  $('do-login').addEventListener('click', function () {
    $('login-msg').textContent = '';
    sb.auth.signInWithPassword({ email: $('em').value.trim(), password: $('pw').value }).then(function (r) {
      if (r.error) $('login-msg').textContent = 'Anmeldung fehlgeschlagen.'; else showApp();
    });
  });
  $('pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('do-login').click(); });
  $('logout').addEventListener('click', function () { sb.auth.signOut().then(showLogin); });
  sb.auth.getSession().then(function (r) { if (r.data.session) showApp(); else showLogin(); });

  /* ---------- Daten ---------- */
  function loadAll() {
    var from = iso(new Date(state.month.getFullYear(), state.month.getMonth() - 1, 20));
    var to = iso(new Date(state.month.getFullYear(), state.month.getMonth() + 2, 10));
    Promise.all([
      sb.from('reservations').select('*').gte('date', from).lte('date', to).order('date').order('time'),
      sb.from('closed_days').select('*').gte('day', from).lte('day', to),
      sb.from('settings').select('*').eq('id', 1).single()
    ]).then(function (r) {
      if (r[0].error) { say('Laden fehlgeschlagen: ' + r[0].error.message, false); return; }
      state.res = r[0].data || [];
      state.closed = {}; (r[1].data || []).forEach(function (c) { state.closed[c.day] = c.reason || true; });
      state.settings = r[2].data; fillSettings();
      renderCal(); renderDay();
    });
  }
  $('reload').addEventListener('click', loadAll);
  setInterval(function () { if (!$('app').hidden) loadAll(); }, 60000);

  /* ---------- Kalender ---------- */
  function renderCal() {
    var m = state.month, cal = $('cal'); cal.textContent = '';
    $('month').textContent = m.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    DOW.forEach(function (d) { cal.appendChild(el('div', 'dow', d)); });
    var lead = (m.getDay() + 6) % 7, days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate(), today = iso(new Date());
    for (var i = 0; i < lead; i++) cal.appendChild(el('div', 'day empty'));
    for (var d = 1; d <= days; d++) {
      var key = iso(new Date(m.getFullYear(), m.getMonth(), d));
      var active = state.res.filter(function (r) { return r.date === key && r.status !== 'storniert'; });
      var guests = active.reduce(function (s, r) { return s + r.guests; }, 0);
      var b = el('button', 'day' + (key === today ? ' today' : '') + (key === state.selected ? ' sel' : '') + (state.closed[key] ? ' closed' : ''));
      b.type = 'button'; b.appendChild(el('span', 'n', String(d)));
      if (active.length) b.appendChild(el('span', 'c', active.length + ' Res. · ' + guests + ' P.'));
      else if (state.closed[key]) b.appendChild(el('span', 'c', 'gesperrt'));
      (function (k) { b.addEventListener('click', function () { state.selected = k; renderCal(); renderDay(); }); })(key);
      cal.appendChild(b);
    }
  }
  $('prev').addEventListener('click', function () { state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1); loadAll(); });
  $('next').addEventListener('click', function () { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1); loadAll(); });
  $('today').addEventListener('click', function () { state.month = firstOfMonth(new Date()); state.selected = iso(new Date()); loadAll(); });

  /* ---------- Tagesliste ---------- */
  function renderDay() {
    var d = new Date(state.selected + 'T12:00:00');
    $('day-title').textContent = d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    $('close-day').textContent = state.closed[state.selected] ? 'Sperre aufheben' : 'Tag sperren';
    var rows = state.res.filter(function (r) { return r.date === state.selected; });
    var act = rows.filter(function (r) { return r.status !== 'storniert'; });
    $('day-sum').textContent = act.length ? act.length + ' Reservierungen · ' + act.reduce(function (s, r) { return s + r.guests; }, 0) + ' Gäste' : 'Keine Reservierungen.';
    var list = $('list'); list.textContent = '';
    rows.forEach(function (r) {
      var c = el('div', 'res ' + r.status), top = el('div', 'top');
      top.appendChild(el('span', 't', r.time.slice(0, 5) + ' Uhr · ' + r.guests + (r.guests === 1 ? ' Person' : ' Personen')));
      top.appendChild(el('span', 'badge ' + r.status, { bestaetigt: 'bestätigt', neu: 'neu', storniert: 'storniert' }[r.status]));
      c.appendChild(top);
      c.appendChild(el('div', null, r.name));
      var contact = el('div', 'small');
      var tel = el('a', null, r.phone); tel.href = 'tel:' + r.phone.replace(/[^0-9+]/g, '');
      var mail = el('a', null, r.email); mail.href = 'mailto:' + r.email;
      contact.appendChild(tel); contact.appendChild(document.createTextNode(' · ')); contact.appendChild(mail); c.appendChild(contact);
      if (r.note) c.appendChild(el('div', 'small', 'Anmerkung: ' + r.note));
      var acts = el('div', 'acts');
      if (r.status !== 'bestaetigt') acts.appendChild(actionBtn('Bestätigen', r, 'bestaetigt'));
      if (r.status !== 'storniert') acts.appendChild(actionBtn('Stornieren', r, 'storniert'));
      c.appendChild(acts); list.appendChild(c);
    });
  }
  function actionBtn(label, r, status) {
    var b = el('button', 'btn btn-small' + (status === 'storniert' ? ' btn-ghost' : ''), label); b.type = 'button';
    b.addEventListener('click', function () {
      if (status === 'storniert' && !confirm('Reservierung von ' + r.name + ' stornieren? Der Gast bekommt eine E-Mail.')) return;
      b.disabled = true; say('', true);
      sb.functions.invoke('set-status', { body: { id: r.id, status: status } }).then(function (res) {
        if (res.error || !res.data || !res.data.ok) { say('Das hat nicht geklappt.', false); b.disabled = false; return; }
        say(res.data.mail ? 'Gespeichert, der Gast wurde per E-Mail informiert.' : 'Gespeichert (E-Mail konnte nicht gesendet werden).', true);
        loadAll();
      });
    });
    return b;
  }
  $('close-day').addEventListener('click', function () {
    var d = state.selected, q = state.closed[d] ? sb.from('closed_days').delete().eq('day', d) : sb.from('closed_days').insert({ day: d, reason: 'gesperrt' });
    q.then(function (r) { if (r.error) say('Fehler: ' + r.error.message, false); else loadAll(); });
  });

  /* ---------- Einstellungen ---------- */
  function fillSettings() {
    var s = state.settings; if (!s) return;
    $('s-email').value = s.restaurant_email || ''; $('s-cap').value = s.capacity; $('s-party').value = s.max_party; $('s-dur').value = s.duration_minutes; $('s-auto').checked = !!s.auto_confirm;
    var h = $('hours'); h.textContent = '';
    KEYS.forEach(function (k, i) {
      var row = el('div', 'hours'); row.appendChild(el('span', null, DOW[i]));
      var inp = document.createElement('input'); inp.id = 'h-' + k; inp.setAttribute('aria-label', DAYNAME[i]);
      inp.value = (s.opening[k] || []).map(function (w) { return w[0] + '-' + w[1]; }).join(', ');
      row.appendChild(inp); h.appendChild(row);
    });
  }
  function parseHours(txt) {
    var out = [];
    String(txt || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (part) {
      var m = part.match(/^([01]?\d|2[0-3]):([0-5]\d)\s*-\s*([01]?\d|2[0-3]):([0-5]\d)$/);
      if (!m) throw new Error('Ungültige Zeit: ' + part);
      var p = function (h, mi) { return ('0' + h).slice(-2) + ':' + mi; };
      out.push([p(m[1], m[2]), p(m[3], m[4])]);
    });
    return out;
  }
  $('save').addEventListener('click', function () {
    var opening = {};
    try { KEYS.forEach(function (k) { opening[k] = parseHours($('h-' + k).value); }); } catch (e) { say(e.message, false); return; }
    sb.from('settings').update({
      restaurant_email: $('s-email').value.trim(), capacity: parseInt($('s-cap').value, 10), max_party: parseInt($('s-party').value, 10),
      duration_minutes: parseInt($('s-dur').value, 10), auto_confirm: $('s-auto').checked, opening: opening
    }).eq('id', 1).then(function (r) { say(r.error ? 'Fehler: ' + r.error.message : 'Einstellungen gespeichert.', !r.error); if (!r.error) loadAll(); });
  });
})();
