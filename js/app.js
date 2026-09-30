(function () {
  "use strict";
  var CFG = window.TUSE_CONFIG || {};
  var eur = function (n) { return n.toFixed(2).replace(".", ",") + " €"; };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* ---------- Intro ---------- */
  var intro = document.getElementById("intro");
  function closeIntro() {
    if (!intro || intro.classList.contains("done")) return;
    intro.classList.add("done");
    try { sessionStorage.setItem("tuse-intro", "1"); } catch (e) {}
    setTimeout(function () { intro.remove(); }, 1000);
  }
  var seen = false;
  try { seen = sessionStorage.getItem("tuse-intro") === "1"; } catch (e) {}
  if (intro) {
    if (seen) intro.remove();
    else {
      document.getElementById("skip-intro").addEventListener("click", closeIntro);
      setTimeout(closeIntro, 7200);
    }
  }

  /* ---------- Reservierungsformular: Zeiten & Personen ---------- */
  var timeSel = document.querySelector('#form-res select[name="time"]');
  var guestSel = document.querySelector('#form-res select[name="guests"]');
  for (var h = 17; h <= 21; h++) {
    ["00", "30"].forEach(function (m) {
      if (h === 21 && m === "30") return;
      var t = h + ":" + m, o = el("option", null, t + " Uhr"); o.value = t; timeSel.appendChild(o);
    });
  }
  for (var g = 1; g <= 12; g++) {
    var o = el("option", null, g + (g === 1 ? " Person" : " Personen")); o.value = g; if (g === 2) o.selected = true; guestSel.appendChild(o);
  }
  var today = new Date(); today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  var iso = today.toISOString().slice(0, 10);
  document.querySelectorAll('input[type="date"]').forEach(function (d) { d.min = iso; });
  document.querySelector('#form-res input[name="date"]').value = iso;

  /* ---------- Formulare senden ---------- */
  function submitForm(form, table, mapper) {
    var msg = form.querySelector(".form-msg");
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      msg.className = "form-msg"; msg.textContent = "";
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var data = mapper(new FormData(form));
      var btn = form.querySelector('button[type="submit"]'); btn.disabled = true;
      if (!CFG.supabaseUrl || !CFG.supabaseAnonKey) {
        msg.className = "form-msg ok";
        msg.textContent = "Demo-Modus: Ihre Angaben wurden nicht gespeichert. Nach der Einrichtung wird die Anfrage hier bestätigt.";
        btn.disabled = false; return;
      }
      fetch(CFG.supabaseUrl + "/rest/v1/" + table, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: CFG.supabaseAnonKey, Authorization: "Bearer " + CFG.supabaseAnonKey, Prefer: "return=minimal" },
        body: JSON.stringify(data)
      }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        msg.className = "form-msg ok"; msg.textContent = "Vielen Dank! Wir haben Ihre Anfrage erhalten und melden uns zeitnah.";
        form.reset();
      }).catch(function () {
        msg.className = "form-msg err"; msg.textContent = "Das hat leider nicht geklappt. Bitte versuchen Sie es erneut oder rufen Sie uns an.";
      }).then(function () { btn.disabled = false; });
    });
  }
  submitForm(document.getElementById("form-res"), "reservations", function (f) {
    return { date: f.get("date"), time: f.get("time"), guests: parseInt(f.get("guests"), 10), name: f.get("name").trim(), email: f.get("email").trim(), phone: f.get("phone").trim(), note: (f.get("note") || "").trim() || null };
  });
  submitForm(document.getElementById("form-event"), "event_inquiries", function (f) {
    var gs = parseInt(f.get("guests"), 10);
    return { event_type: f.get("event_type"), date: f.get("date") || null, guests: isNaN(gs) ? null : gs, name: f.get("name").trim(), email: f.get("email").trim(), phone: (f.get("phone") || "").trim() || null, message: (f.get("message") || "").trim() || null };
  });

  /* ---------- Speisekarte ---------- */
  var MENU = null;
  function initMenu(m) {
    MENU = m;
    document.getElementById("menu-footer").textContent = (m.footer || []).join(" ");
    buildList(); buildBook();
  }
  if (window.TUSE_MENU) initMenu(window.TUSE_MENU);
  else fetch("data/menu.json").then(function (r) { return r.json(); }).then(initMenu).catch(function () {
    document.getElementById("book").textContent = "Die Speisekarte konnte nicht geladen werden.";
  });

  function itemLines(it) {
    var n = 1;
    if (it.desc) n += Math.ceil(it.desc.length / 56);
    if (it.variants && it.variants.length > 1) n += 1;
    if (it.addons) n += it.addons.length * 0.9;
    return n + 0.55;
  }
  function priceText(it) {
    if (it.variants) return it.variants.length === 1 ? eur(it.variants[0].price) : "";
    return eur(it.price);
  }
  function variantText(it) {
    if (!it.variants) return "";
    if (it.variants.length === 1) return "";
    return it.variants.map(function (v) { return v.label + " " + eur(v.price); }).join("  ·  ");
  }
  function nameText(it) {
    var t = it.name;
    if (it.variants && it.variants.length === 1) t += " (" + it.variants[0].label + ")";
    if (it.weight) t += " · " + it.weight;
    return t;
  }

  /* Liste */
  function buildList() {
    var tabs = document.getElementById("list-tabs"), body = document.getElementById("list-body");
    function show(cat, btn) {
      tabs.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-selected", b === btn ? "true" : "false"); });
      body.textContent = "";
      if (cat.note) body.appendChild(el("p", "cat-note", cat.note));
      cat.items.forEach(function (it) {
        var row = el("div", "list-item");
        var nm = el("div", "nm"); nm.appendChild(el("span", "nr", it.nr + ".")); nm.appendChild(document.createTextNode(nameText(it)));
        row.appendChild(nm); row.appendChild(el("div", "pr", priceText(it)));
        if (it.desc) row.appendChild(el("div", "ds", it.desc));
        var v = variantText(it); if (v) row.appendChild(el("div", "vr", v));
        if (it.addons) row.appendChild(el("div", "vr", it.addons.map(function (a) { return a.label + " +" + eur(a.price); }).join("  ·  ")));
        if (MENU.tags_verified && it.tags && it.tags.length) row.appendChild(el("div", "vr", it.tags.join(", ")));
        body.appendChild(row);
      });
    }
    MENU.categories.forEach(function (c, i) {
      var b = el("button", null, c.title); b.type = "button"; b.setAttribute("role", "tab");
      b.addEventListener("click", function () { show(c, b); });
      tabs.appendChild(b); if (i === 0) show(c, b);
    });
  }

  /* Buch */
  var flip = null;
  function buildBook() {
    var book = document.getElementById("book");
    var CAP = 36, pages = [];
    function page(cls) { var p = el("div", "page" + (cls ? " " + cls : "")); var inner = el("div", "inner"); p.appendChild(inner); return { p: p, inner: inner }; }

    var cover = page("cover"); cover.p.setAttribute("data-density", "hard");
    var logo = el("img"); logo.src = "assets/logo.png"; logo.alt = ""; cover.inner.appendChild(logo);
    cover.inner.appendChild(el("div", "t", "TUSÊ")); cover.inner.appendChild(el("div", "s", "ALTES FÄHRHAUS"));
    cover.inner.appendChild(el("div", "s", "SPEISEKARTE"));
    pages.push(cover);

    var cur = null, used = 0;
    MENU.categories.forEach(function (c) {
      var first = true;
      function head(newPage) {
        if (newPage || !cur) { cur = page(); pages.push(cur); used = 0; }
        var h = el("h4", null, c.title + (first ? "" : " (Forts.)"));
        if (used > 0) h.style.marginTop = "14px";
        cur.inner.appendChild(h);
        used += used > 0 ? 3.4 : 2.6;
        if (first && c.note) { cur.inner.appendChild(el("div", "note", c.note)); used += 1.4; }
        first = false;
      }
      var firstCost = itemLines(c.items[0]) + 3.4 + (c.note ? 1.4 : 0) + 1.2;
      head(!cur || used + firstCost > CAP);
      c.items.forEach(function (it) {
        var cost = itemLines(it);
        if (used + cost > CAP) { head(true); }
        used += cost;
        var row = el("div", "it");
        row.appendChild(el("b", null, it.nr + ". " + nameText(it)));
        row.appendChild(el("span", "p", priceText(it)));
        if (it.desc) row.appendChild(el("i", null, it.desc));
        var v = variantText(it); if (v) row.appendChild(el("span", "v", v));
        if (it.addons) row.appendChild(el("span", "v", it.addons.map(function (a) { return a.label + " +" + eur(a.price); }).join("  ·  ")));
        cur.inner.appendChild(row);
      });
    });

    var last = page(); last.inner.appendChild(el("h4", null, "Guten Appetit"));
    (MENU.footer || []).forEach(function (t) { last.inner.appendChild(el("div", "note", t)); });
    pages.push(last);
    if (pages.length % 2 === 1) { var back = page("cover"); back.p.setAttribute("data-density", "hard"); pages.push(back); }
    else { pages[pages.length - 1].p.setAttribute("data-density", "hard"); }
    pages.forEach(function (x, i) { book.appendChild(x.p); });

    var wrap = document.getElementById("book-view");
    var avail = Math.min(wrap.clientWidth || 360, 980);
    var portrait = avail < 700;
    var pw = portrait ? Math.min(avail, 420) : Math.min(Math.floor(avail / 2), 460);
    var ph = Math.round(pw * 560 / 380);
    book.style.width = (portrait ? pw : pw * 2) + "px";

    flip = new St.PageFlip(book, { width: pw, height: ph, size: "fixed", showCover: true, usePortrait: portrait, maxShadowOpacity: 0.5, mobileScrollSupport: false, flippingTime: 900 });
    book.style.setProperty("--u", (pw / 380).toFixed(4));
    flip.loadFromHTML(book.querySelectorAll(".page"));
    var info = document.getElementById("page-info");
    function upd() { info.textContent = "Seite " + (flip.getCurrentPageIndex() + 1) + " von " + flip.getPageCount(); }
    flip.on("flip", upd); upd();
    document.getElementById("prev").addEventListener("click", function () { flip.flipPrev(); });
    document.getElementById("next").addEventListener("click", function () { flip.flipNext(); });
  }

  /* Umschalter Buch / Liste */
  var tabBook = document.getElementById("tab-book"), tabList = document.getElementById("tab-list");
  function view(book) {
    document.getElementById("book-view").hidden = !book; document.getElementById("list-view").hidden = book;
    tabBook.setAttribute("aria-selected", book ? "true" : "false"); tabList.setAttribute("aria-selected", book ? "false" : "true");
  }
  tabBook.addEventListener("click", function () { view(true); });
  tabList.addEventListener("click", function () { view(false); });
})();
