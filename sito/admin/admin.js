// Admin di crochet by Alessia.
// Schermate semplici (home a riquadri → creazioni → modello…), si salva da solo a ogni modifica,
// "Annulla" torna indietro di un passo e "Versioni precedenti" ripristina com'era il sito ore o giorni fa.
// Legge e salva i contenuti da /api/contenuti; le foto vengono rimpicciolite qui (lato lungo 1600 px, JPEG) prima di caricarle.

const $ = (s) => document.querySelector(s);
let dati = null;        // i contenuti del sito
let storia = [];        // per "Annulla": le versioni di prima (JSON)
let ultimoRicorda = { chiave: "", t: 0 };
let attesa = [];        // recensioni lasciate dai clienti, da approvare

// ---------- piccoli aiuti ----------
function h(tag, attrs = {}, ...figli) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v ?? "";
    else if (k === "checked") el.checked = !!v;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  for (const f of figli.flat(Infinity)) if (f != null && f !== false) el.append(f);
  return el;
}
// come replaceChildren, ma salta i pezzi vuoti (false, null) invece di scriverli come testo
const metti = (el, ...f) => el.replaceChildren(...f.flat(Infinity).filter((x) => x != null && x !== false && x !== ""));
const leggi = (path) => path.split(".").reduce((o, k) => o?.[k], dati);
const src = (p) => (!p ? "" : p.startsWith("/") ? p : "/" + p);
const conta = (n, uno, tanti) => `${n} ${n === 1 ? uno : tanti}`;

// prima di ogni modifica tengo com'era, per "Annulla" (mentre si scrive in un campo, una sola volta ogni pochi secondi)
function ricorda(chiave = "") {
  const ora = Date.now();
  if (chiave && chiave === ultimoRicorda.chiave && ora - ultimoRicorda.t < 4000) { ultimoRicorda.t = ora; return; }
  ultimoRicorda = { chiave, t: ora };
  storia.push(JSON.stringify(dati));
  if (storia.length > 40) storia.shift();
  $("#annulla").hidden = false;
}
function scrivi(path, valore, chiave) {
  ricorda(chiave);
  const k = path.split(".");
  const ultimo = k.pop();
  k.reduce((o, x) => o[x], dati)[ultimo] = valore;
  programmaSalva(chiave ? 1500 : 0);
}
// per le modifiche "a mano" (sposta, togli, aggiungi): ricorda, cambia, salva subito e ridisegna
function cambia(fn, messaggio) {
  ricorda();
  fn();
  programmaSalva(0);
  disegna();
  if (messaggio) avviso(messaggio, true);
}

async function chiama(url, opzioni = {}) {
  const r = await fetch(url, { credentials: "same-origin", ...opzioni });
  const corpo = await r.json().catch(() => ({}));
  if (r.status === 401 && url !== "/api/login") mostraLogin();
  if (!r.ok) throw Object.assign(new Error(corpo.errore || "Qualcosa non ha funzionato, riprova."), { status: r.status });
  return corpo;
}

let timerAvviso;
function avviso(testo, conAnnulla = false) {
  const a = $("#avviso");
  a.replaceChildren(...[h("span", {}, testo), conAnnulla && h("button", { type: "button", onclick: () => { annulla(); a.hidden = true; } }, "Annulla")].filter(Boolean));
  a.hidden = false;
  clearTimeout(timerAvviso);
  timerAvviso = setTimeout(() => (a.hidden = true), conAnnulla ? 6000 : 3000);
}

// ---------- salvataggio automatico ----------
let timerSalva = null, salvando = false, daSalvare = false;
function statoSalva(testo, classe = "", riprova = false) {
  const s = $("#salvataggio");
  s.className = "salvataggio " + classe;
  s.replaceChildren(...[testo, riprova && h("button", { type: "button", onclick: () => programmaSalva(0) }, "Riprova")].filter(Boolean));
}
function programmaSalva(ms) {
  daSalvare = true;
  statoSalva("Salvo…", "in-corso");
  clearTimeout(timerSalva);
  timerSalva = setTimeout(salva, ms);
}
async function salva() {
  if (salvando) { timerSalva = setTimeout(salva, 400); return; }
  salvando = true;
  daSalvare = false;
  try {
    await chiama("/api/contenuti", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(dati) });
    if (!daSalvare) statoSalva("Tutto salvato");
  } catch (err) {
    daSalvare = true;
    statoSalva(err.status === 401 ? "Non salvato" : "Non salvato ·", "errore", err.status !== 401);
  }
  salvando = false;
}
function annulla() {
  if (!storia.length) return;
  dati = JSON.parse(storia.pop());
  ultimoRicorda = { chiave: "", t: 0 };
  $("#annulla").hidden = !storia.length;
  programmaSalva(0);
  disegna();
}
$("#annulla").addEventListener("click", annulla);
addEventListener("beforeunload", (e) => { if (daSalvare || salvando) e.preventDefault(); });

// ---------- campi ----------
function campo(label, path, { lungo = false, aiuto = "", tipo = "text", righe = 4, segnaposto = "", dopo = null } = {}) {
  const id = "c-" + path.replace(/\./g, "-");
  const attrs = { id, value: leggi(path), placeholder: segnaposto || false, oninput: (e) => { scrivi(path, e.target.value, path); dopo?.(e.target.value); } };
  const input = lungo ? h("textarea", { ...attrs, rows: righe }) : h("input", { ...attrs, type: tipo });
  return h("div", { class: "campo" }, h("label", { for: id }, label), input, aiuto && h("p", { class: "aiuto" }, aiuto));
}
function scelta(label, path, opzioni, dopo) {
  const id = "c-" + path.replace(/\./g, "-");
  return h("div", { class: "campo" }, h("label", { for: id }, label),
    h("select", { id, onchange: (e) => { scrivi(path, e.target.value); dopo?.(e.target.value); } },
      Object.entries(opzioni).map(([v, t]) => h("option", { value: v, selected: (leggi(path) || "") === v }, t))));
}

async function rimpicciolisci(file) {
  const bmp = await createImageBitmap(file);
  const scala = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = h("canvas", { width: Math.round(bmp.width * scala), height: Math.round(bmp.height * scala) });
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((ok, no) => canvas.toBlob((b) => (b ? ok(b) : no(new Error("Non riesco a leggere questa foto."))), "image/jpeg", 0.85));
}
async function carica(file) {
  const blob = await rimpicciolisci(file);
  const { url } = await chiama("/api/foto", { method: "POST", headers: { "content-type": "image/jpeg" }, body: blob });
  return url;
}
function scegliFile(multiple, fn) {
  const input = h("input", { type: "file", accept: "image/*", multiple, hidden: true, onchange: () => { fn([...input.files]); input.remove(); } });
  document.body.append(input);
  input.click();
}

// una foto sola (es. "Chi sono")
function fotoSingola(label, path) {
  const stato = h("p", { class: "aiuto" });
  return h("div", { class: "campo" }, h("span", { class: "etichetta" }, label),
    h("div", { style: "display:flex;gap:14px;align-items:center" },
      h("img", { src: src(leggi(path)) || "/foto/logo.jpg", alt: "", style: "width:110px;aspect-ratio:3/4;object-fit:cover;border-radius:16px;background:var(--crema)" }),
      h("div", {}, h("button", { type: "button", class: "btn chiaro", onclick: () => scegliFile(false, async ([f]) => {
        if (!f) return;
        stato.textContent = "Carico la foto…";
        try { const url = await carica(f); cambia(() => { const k = path.split("."); const u = k.pop(); k.reduce((o, x) => o[x], dati)[u] = url; }, "Foto cambiata"); }
        catch (err) { stato.textContent = err.message; }
      }) }, "Cambia foto"), stato)));
}

// ---------- finestra ----------
const finestra = $("#finestra");
function apriFinestra(titolo, ...contenuto) {
  metti($("#fin"), h("div", { class: "fin-top" }, h("h2", {}, titolo), h("button", { type: "button", class: "chiudi", "aria-label": "Chiudi", onclick: chiudiFinestra }, "✕")), ...contenuto);
  if (!finestra.open) finestra.showModal();
  $("#fin").scrollTop = 0;
}
const chiudiFinestra = () => finestra.close();
finestra.addEventListener("click", (e) => { if (e.target === finestra) chiudiFinestra(); });

// ---------- dati di comodo ----------
const modelli = () => leggi("lavori.lista") || [];
const categorie = () => leggi("lavori.categorie") || [];
const riquadri = () => leggi("lavori.riquadri") || [];
const nomeCat = (id) => categorie().find((k) => k.id === id)?.nome || "senza categoria";
const nomeModello = (m) => m.nome || "Modello senza nome";
const nuovoId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
// i riquadri in ordine, ognuno con le sue categorie; poi le categorie "a sé" (riquadro proprio sul sito)
function gruppi() {
  const g = riquadri().map((r) => ({ r, cat: categorie().filter((k) => k.riquadro === r.id) }));
  const ids = riquadri().map((r) => r.id);
  const sole = categorie().filter((k) => !ids.includes(k.riquadro));
  return { g, sole };
}
// elenco di modelli in ordine di riquadro/categoria, per scegliere dove spostare una foto
function elencoModelli(escludi, fn) {
  const { g, sole } = gruppi();
  const blocchi = [...g.flatMap(({ r, cat }) => cat.map((k) => [`${r.nome} · ${k.nome}`, k.id])), ...sole.map((k) => [k.nome, k.id])];
  return h("div", { class: "scegli-modello" }, blocchi.map(([titolo, id]) => {
    const suoi = modelli().map((m, i) => [m, i]).filter(([m, i]) => m.cat === id && i !== escludi);
    return suoi.length ? [h("h3", {}, titolo), suoi.map(([m, i]) => h("button", { type: "button", onclick: () => fn(i) },
      m.foto[0] ? h("img", { src: src(m.foto[0].src), alt: "" }) : h("span", { class: "vuota" }), h("span", {}, nomeModello(m), h("br"), h("small", { class: "aiuto" }, conta(m.foto.length, "foto", "foto")))))] : null;
  }));
}

// ---------- griglia di foto (modello, mercatini) ----------
// path = lista di { src, nota }; spostabile = si possono spostare in un altro modello (indice del modello)
function grigliaFoto(path, { max = 40, spostabile = null, copertina = "Copertina", nota = "Nota (facoltativa)", esempioNota = "Es. Cotone bordeaux, punto a rete" } = {}) {
  const box = h("div");
  let scelte = null; // null = non sto selezionando; altrimenti Set di indici
  const lista = () => leggi(path);

  const aggiungi = () => scegliFile(true, async (files) => {
    files = files.slice(0, max - lista().length);
    if (!files.length) return;
    let fatte = 0, errori = 0;
    const segnaposti = files.map(() => h("div", { class: "ft carico" }, "Carico…"));
    box.querySelector(".ft.aggiungi")?.before(...segnaposti);
    for (const [k, f] of files.entries()) {
      try {
        const url = await carica(f);
        ricorda();
        lista().push({ src: url, nota: "" });
        fatte++;
        segnaposti[k].replaceChildren(h("img", { src: url, alt: "" }));
        segnaposti[k].className = "ft";
      } catch (err) { errori++; segnaposti[k].textContent = "Non caricata"; }
    }
    programmaSalva(0);
    disegna();
    avviso(errori ? `${conta(fatte, "foto aggiunta", "foto aggiunte")}, ${errori} non riuscite` : conta(fatte, "foto aggiunta", "foto aggiunte"), !!fatte);
  });

  const sposta = (idx, dove, primaFoto) => {
    const modello = modelli()[dove];
    cambia(() => {
      const prese = [...idx].sort((a, b) => a - b).map((i) => lista()[i]);
      const restano = lista().filter((_, i) => !idx.has(i));
      lista().splice(0, lista().length, ...restano);
      if (primaFoto) modello.foto.unshift(...prese); else modello.foto.push(...prese);
    }, `${conta(idx.size, "foto spostata", "foto spostate")} in «${nomeModello(modello)}»`);
  };
  const chiediDove = (idx) => {
    const prima = h("input", { type: "checkbox", checked: true });
    apriFinestra(idx.size > 1 ? `Sposta ${idx.size} foto in…` : "Sposta la foto in…",
      h("label", { class: "interruttore", style: "margin-top:0" }, prima, h("span", {}, "Mettila come prima foto (copertina) del modello scelto")),
      elencoModelli(spostabile, (dove) => { chiudiFinestra(); scelte = null; sposta(idx, dove, prima.checked); }));
  };
  const elimina = (idx) => {
    if (!confirm(idx.size > 1 ? `Eliminare ${idx.size} foto?` : "Eliminare questa foto?")) return;
    chiudiFinestra();
    scelte = null;
    cambia(() => { const restano = lista().filter((_, i) => !idx.has(i)); lista().splice(0, lista().length, ...restano); }, conta(idx.size, "foto eliminata", "foto eliminate"));
  };
  const muovi = (i, d) => { cambia(() => { const l = lista(); [l[i], l[i + d]] = [l[i + d], l[i]]; }); dettaglio(i + d); };

  const dettaglio = (i) => {
    const f = lista()[i];
    const n = lista().length;
    apriFinestra(`Foto ${i + 1} di ${n}`,
      h("img", { class: "grande", src: src(f.src), alt: "" }),
      h("div", { class: "campo" }, h("label", { for: "nota-foto" }, nota),
        h("input", { id: "nota-foto", type: "text", value: f.nota, placeholder: esempioNota, oninput: (e) => { scrivi(`${path}.${i}.nota`, e.target.value, `${path}.${i}.nota`); } })),
      h("div", { class: "azioni" },
        i > 0 && h("button", { type: "button", class: "btn intera", onclick: () => { chiudiFinestra(); cambia(() => lista().unshift(...lista().splice(i, 1)), copertina ? "Ora è la copertina" : "Ora è la prima"); } }, copertina ? "⭐ Metti come copertina" : "⭐ Metti per prima"),
        h("button", { type: "button", class: "btn chiaro", disabled: i === 0, onclick: () => muovi(i, -1) }, "‹ Più avanti"),
        h("button", { type: "button", class: "btn chiaro", disabled: i === n - 1, onclick: () => muovi(i, 1) }, "Più indietro ›"),
        spostabile != null && h("button", { type: "button", class: "btn chiaro intera", onclick: () => chiediDove(new Set([i])) }, "⇄ Sposta in un altro modello"),
        h("button", { type: "button", class: "btn chiaro", onclick: () => scegliFile(false, async ([file]) => {
          if (!file) return;
          try { const url = await carica(file); cambia(() => (lista()[i].src = url), "Foto sostituita"); dettaglio(i); } catch (err) { alert(err.message); }
        }) }, "Sostituisci"),
        h("button", { type: "button", class: "btn rosso", onclick: () => elimina(new Set([i])) }, "Elimina")),
      h("p", { class: "aiuto", style: "text-align:center;margin-top:12px" }, "Le modifiche si salvano da sole."));
  };

  const disegnaGriglia = () => {
    const l = lista();
    metti(box,
      l.length > 1 && h("div", { style: "display:flex;justify-content:flex-end" },
        h("button", { type: "button", class: "pillola", onclick: () => { scelte = scelte ? null : new Set(); disegnaGriglia(); } }, scelte ? "Fine selezione" : "☑ Seleziona più foto")),
      h("div", { class: "griglia-foto" },
        l.map((f, i) => h("button", { type: "button", class: "ft" + (scelte?.has(i) ? " scelta" : ""), "aria-label": `Foto ${i + 1}`,
          onclick: () => { if (scelte) { scelte.has(i) ? scelte.delete(i) : scelte.add(i); disegnaGriglia(); } else dettaglio(i); } },
          h("img", { src: src(f.src), alt: "", loading: "lazy" }),
          i === 0 && copertina && h("span", { class: "cop" }, copertina),
          scelte && h("span", { class: "spunta" }, scelte.has(i) ? "✓" : ""),
          !scelte && h("span", { class: "num" }, i + 1))),
        !scelte && l.length < max && h("button", { type: "button", class: "ft aggiungi", onclick: aggiungi }, h("span", {}, "+"), "Aggiungi foto")),
      scelte && h("div", { class: "barra-scelta" },
        h("p", {}, scelte.size ? conta(scelte.size, "foto selezionata", "foto selezionate") : "Tocca le foto da selezionare"),
        spostabile != null && h("button", { type: "button", class: "btn", disabled: !scelte.size, onclick: () => chiediDove(scelte) }, "⇄ Sposta in…"),
        h("button", { type: "button", class: "btn", disabled: !scelte.size, onclick: () => elimina(scelte) }, "Elimina"),
        h("button", { type: "button", class: "btn chiaro", onclick: () => { scelte = null; disegnaGriglia(); } }, "Annulla")));
  };
  disegnaGriglia();
  return box;
}

// lista di voci con campi (eventi, recensioni, passi…)
function lista(path, { nome, max, nuova, campi, inCima = false, titolo, classe = null }) {
  const voci = leggi(path);
  const bottone = voci.length < max && h("button", { type: "button", class: "nuovo", onclick: () => cambia(() => (inCima ? voci.unshift(nuova()) : voci.push(nuova()))) }, `+ Aggiungi ${nome}`);
  return h("div", {}, inCima && bottone,
    voci.map((v, i) => h("div", { class: "voce" + (classe?.(v) ? " " + classe(v) : "") },
      h("div", { class: "voce-top" },
        h("strong", {}, titolo(v, i)),
        h("button", { type: "button", class: "mini", "aria-label": "Sposta su", disabled: i === 0, onclick: () => cambia(() => ([voci[i - 1], voci[i]] = [voci[i], voci[i - 1]])) }, "↑"),
        h("button", { type: "button", class: "mini", "aria-label": "Sposta giù", disabled: i === voci.length - 1, onclick: () => cambia(() => ([voci[i + 1], voci[i]] = [voci[i], voci[i + 1]])) }, "↓"),
        h("button", { type: "button", class: "mini via", "aria-label": "Togli", onclick: () => { if (confirm(`Togliere «${titolo(v, i)}»?`)) cambia(() => voci.splice(i, 1), "Tolto"); } }, "✕")),
      campi(`${path}.${i}`, v))),
    !inCima && bottone);
}

// ---------- schermate ----------
const SCHERMI = {
  "": { titolo: "Home", disegna: home },
  creazioni: { su: "", disegna: schermoCreazioni },
  modello: { su: "creazioni", disegna: schermoModello },
  riquadri: { su: "", disegna: schermoRiquadri },
  eventi: { su: "", disegna: schermoEventi },
  recensioni: { su: "", disegna: schermoRecensioni },
  mercatini: { su: "", disegna: schermoMercatini },
  testi: { su: "", disegna: schermoTesti },
  contatti: { su: "", disegna: schermoContatti },
  password: { su: "", disegna: schermoPassword },
  versioni: { su: "", disegna: schermoVersioni }
};
const rotta = () => { const [nome, arg] = location.hash.slice(1).split("/"); return SCHERMI[nome] ? { nome, arg } : { nome: "", arg: undefined }; };
const vai = (hash) => { location.hash = hash; };
let ultimaRotta = "";
function disegna() {
  if (!dati) return;
  const { nome, arg } = rotta();
  const s = SCHERMI[nome];
  const qui = location.hash;
  const y = qui === ultimaRotta ? scrollY : 0; // ridisegno la stessa schermata: resto dove ero
  $("#indietro").hidden = nome === "";
  $("#indietro").onclick = () => vai(s.su || "");
  $("#schermo").replaceChildren(h("div", { class: "schermo" }, s.disegna(arg)));
  scrollTo(0, y);
  ultimaRotta = qui;
}
addEventListener("hashchange", () => { chiudiFinestra(); disegna(); });

function home() {
  const prossimi = (leggi("eventi.lista") || []).filter((e) => (e.fine || e.data) >= oggi());
  const conFoto = modelli().filter((m) => m.foto.length);
  const voce = (hash, ico, titolo, testo, extra = {}) => h("button", { type: "button", class: extra.grande ? "grande" : false, onclick: () => vai(hash) },
    h("span", { class: "ico" }, ico), h("span", {}, h("b", {}, titolo), h("small", {}, testo)), extra.badge && h("span", { class: "badge" }, extra.badge));
  return [
    h("h1", {}, "Ciao Alessia 🧶"),
    h("p", { class: "sottotitolo" }, "Cosa vuoi fare? Ogni modifica si salva da sola e il sito si aggiorna subito."),
    h("div", { class: "menu" },
      voce("creazioni", "👜", "Le mie creazioni", `${conta(conFoto.length, "modello", "modelli")} · aggiungi, togli, cambia foto e copertine`, { grande: true }),
      voce("eventi", "📅", "Mercatini ed eventi", prossimi.length ? `Prossimo: ${prossimi[0].nome}` : "Aggiungi le prossime date"),
      voce("recensioni", "💬", "Recensioni", attesa.length ? conta(attesa.length, "nuova da approvare", "nuove da approvare") : `${(leggi("recensioni.lista") || []).length} sul sito`, { badge: attesa.length || null }),
      voce("riquadri", "🗂️", "Riquadri e categorie", "I grandi riquadri (Borse, Accessori…) e le loro copertine"),
      voce("mercatini", "📸", "Foto dei mercatini", "Le foto che scorrono in «Dove trovarmi»"),
      voce("testi", "✏️", "Testi del sito", "In alto, Chi sono, Su richiesta…"),
      voce("contatti", "📞", "Contatti e social", "WhatsApp, Instagram, TikTok"),
      voce("versioni", "↩️", "Versioni precedenti", "Hai sbagliato qualcosa? Torna a com'era"),
      voce("password", "🔒", "Password", "Cambia la password dell'admin")),
    h("div", { style: "text-align:center;margin-top:28px" }, h("button", { type: "button", class: "pillola", onclick: esci }, "Esci dall'admin"))
  ];
}

// --- creazioni ---
let cercato = "";
function schermoCreazioni() {
  const risultati = h("div");
  const { g, sole } = gruppi();
  const disegnaRisultati = () => {
    const q = cercato.trim().toLowerCase();
    const riga = (m, i, prec, succ) => h("div", { class: "riga" },
      h("button", { type: "button", class: "apri", onclick: () => vai("modello/" + i) },
        m.foto[0] ? h("img", { src: src(m.foto[0].src), alt: "", loading: "lazy" }) : h("span", { class: "vuota" }, "📷"),
        h("span", { class: "testo" }, h("b", {}, nomeModello(m)),
          h("small", {}, m.foto.length ? conta(m.foto.length, "foto", "foto") : "nessuna foto: non si vede", m.nascosto && h("span", { class: "tag" }, "nascosto")))),
      !q && h("div", { class: "frecce" },
        h("button", { type: "button", class: "mini", "aria-label": "Più in alto", disabled: prec == null, onclick: () => cambia(() => { const l = modelli(); [l[prec], l[i]] = [l[i], l[prec]]; }) }, "↑"),
        h("button", { type: "button", class: "mini", "aria-label": "Più in basso", disabled: succ == null, onclick: () => cambia(() => { const l = modelli(); [l[succ], l[i]] = [l[i], l[succ]]; }) }, "↓")));
    const righeCat = (k) => {
      const suoi = modelli().map((m, i) => [m, i]).filter(([m]) => m.cat === k.id && (!q || nomeModello(m).toLowerCase().includes(q)));
      return suoi.length || !q ? [h("h3", {}, `${k.nome} · ${suoi.length}`),
        h("div", { class: "righe" }, suoi.length ? suoi.map(([m, i], j) => riga(m, i, suoi[j - 1]?.[1], suoi[j + 1]?.[1])) : h("p", { class: "aiuto" }, "Ancora nessun modello qui."))] : null;
    };
    const blocchi = [...g.map(({ r, cat }) => [r.nome, cat]), ...sole.map((k) => [k.nome, [k]])]
      .map(([titolo, cat]) => { const dentro = cat.map(righeCat).filter(Boolean); return dentro.length ? h("div", { class: "gruppo" }, h("h2", {}, titolo), dentro) : null; });
    metti(risultati, ...blocchi.filter(Boolean), q && !blocchi.some(Boolean) ? h("p", { class: "aiuto", style: "margin-top:20px" }, "Nessun modello con questo nome.") : null);
  };
  disegnaRisultati();
  return [
    h("h1", {}, "Le mie creazioni"),
    h("p", { class: "sottotitolo" }, "Tocca un modello per cambiarne foto, nome e copertina. Con ↑ ↓ scegli quali si vedono per primi."),
    h("button", { type: "button", class: "btn largo", onclick: nuovoModello }, "+ Nuovo modello"),
    h("input", { type: "search", class: "cerca", placeholder: "🔍 Cerca un modello…", value: cercato, style: "margin-top:12px", oninput: (e) => { cercato = e.target.value; disegnaRisultati(); } }),
    risultati
  ];
}
function nuovoModello() {
  const { g, sole } = gruppi();
  apriFinestra("In che categoria?",
    h("p", { class: "aiuto", style: "margin-top:0" }, "Scegli dove mettere il nuovo modello (potrai cambiarla dopo)."),
    h("div", { class: "scegli-modello" }, [...g.map(({ r, cat }) => [r.nome, cat]), ...(sole.length ? [["Riquadri a sé", sole]] : [])].map(([titolo, cat]) => cat.length ? [h("h3", {}, titolo),
      cat.map((k) => h("button", { type: "button", style: "padding:12px 14px", onclick: () => {
        chiudiFinestra();
        ricorda();
        modelli().unshift({ cat: k.id, nome: "", testo: "", foto: [], nascosto: false });
        programmaSalva(0);
        vai("modello/0");
        setTimeout(() => $("#c-lavori-lista-0-nome")?.focus(), 50);
      } }, k.nome))] : null)));
}
function schermoModello(arg) {
  const i = Number(arg);
  const m = modelli()[i];
  if (!m) { setTimeout(() => vai("creazioni")); return h("p", {}, "Questo modello non c'è più."); }
  const p = `lavori.lista.${i}`;
  const titolo = h("h1", {}, nomeModello(m));
  const vecchioNome = { v: m.nome };
  const CAT = Object.fromEntries(categorie().map((k) => [k.id, k.nome]));
  return [
    titolo,
    h("p", { class: "sottotitolo" }, `${nomeCat(m.cat)} · ${conta(m.foto.length, "foto", "foto")}`),
    h("div", { class: "card" },
      h("h2", {}, "Foto"),
      h("p", { class: "aiuto" }, "La prima è la copertina. Tocca una foto per metterla come copertina, spostarla, cambiarla o eliminarla."),
      grigliaFoto(`${p}.foto`, { spostabile: i }),
      !m.foto.length && h("p", { class: "riquadro-aiuto" }, "Finché non aggiungi almeno una foto, questo modello non si vede sul sito.")),
    h("div", { class: "card" },
      h("h2", {}, "Informazioni"),
      campo("Nome del modello", `${p}.nome`, { segnaposto: "Es. Bauletto", dopo: (v) => {
        titolo.textContent = v || "Modello senza nome";
        // se era la copertina di un riquadro, la copertina segue il nuovo nome
        riquadri().forEach((r) => { if (r.copertina && r.copertina === vecchioNome.v) r.copertina = v; });
        vecchioNome.v = v;
      } }),
      scelta("Categoria", `${p}.cat`, CAT, () => disegna()),
      campo("Descrizione breve", `${p}.testo`, { segnaposto: "Es. Rigido e capiente, con manici e chiusura." }),
      h("label", { class: "interruttore" },
        h("input", { type: "checkbox", checked: !m.nascosto, onchange: (e) => { scrivi(`${p}.nascosto`, !e.target.checked); disegna(); avviso(e.target.checked ? "Ora si vede sul sito" : "Nascosto dal sito"); } }),
        h("span", {}, m.nascosto ? "Nascosto: sul sito non si vede (resta qui)" : "Si vede sul sito"))),
    h("div", { class: "zona-rossa" },
      h("button", { type: "button", class: "btn rosso largo", onclick: () => {
        if (!confirm(`Eliminare «${nomeModello(m)}» con tutte le sue ${m.foto.length} foto?`)) return;
        cambia(() => { modelli().splice(i, 1); riquadri().forEach((r) => { if (r.copertina === m.nome) r.copertina = ""; }); }, `«${nomeModello(m)}» eliminato`);
        vai("creazioni");
      } }, "Elimina questo modello"),
      h("p", { class: "aiuto", style: "text-align:center" }, "Se vuoi solo toglierlo per un po' dal sito, usa l'interruttore qui sopra."))
  ];
}

// --- riquadri e categorie ---
function schermoRiquadri() {
  const { g, sole } = gruppi();
  const opzRiquadri = () => ({ "": "Nessuno: riquadro a sé", ...Object.fromEntries(riquadri().map((r) => [r.id, r.nome || "Riquadro senza nome"])) });
  const scambia = (l, a, b) => cambia(() => ([l[a], l[b]] = [l[b], l[a]]));
  const rigaCat = (k, fratelli) => {
    const ic = categorie().indexOf(k);
    const pos = fratelli.indexOf(k);
    const n = modelli().filter((m) => m.cat === k.id).length;
    return h("div", { class: "voce" },
      h("div", { class: "voce-top" }, h("strong", {}, `${k.nome || "Categoria nuova"} · ${conta(n, "modello", "modelli")}`),
        h("button", { type: "button", class: "mini", "aria-label": "Più in alto", disabled: pos === 0, onclick: () => scambia(categorie(), ic, categorie().indexOf(fratelli[pos - 1])) }, "↑"),
        h("button", { type: "button", class: "mini", "aria-label": "Più in basso", disabled: pos === fratelli.length - 1, onclick: () => scambia(categorie(), ic, categorie().indexOf(fratelli[pos + 1])) }, "↓"),
        h("button", { type: "button", class: "mini via", "aria-label": "Elimina categoria", onclick: () => eliminaCategoria(k) }, "✕")),
      h("div", { class: "due" }, campo("Nome", `lavori.categorie.${ic}.nome`, { segnaposto: "Es. Natale" }), scelta("Sta nel riquadro", `lavori.categorie.${ic}.riquadro`, opzRiquadri(), () => disegna())));
  };
  const nuovaCat = (riquadro) => cambia(() => categorie().push({ id: nuovoId("c"), nome: "Nuova categoria", riquadro }), "Categoria aggiunta: cambiale il nome");
  return [
    h("h1", {}, "Riquadri e categorie"),
    h("p", { class: "sottotitolo" }, "Sul sito ci sono dei grandi riquadri con la foto (es. Borse). Dentro ogni riquadro, le categorie sono i filtri (es. Bauletti, Clutch)."),
    g.map(({ r, cat }, ir) => {
      const cop = copertinaDi(r);
      return h("div", { class: "card" },
        h("div", { class: "voce-top", style: "padding-top:14px" }, h("h2", { style: "flex:1" }, r.nome || "Riquadro nuovo"),
          h("button", { type: "button", class: "mini", "aria-label": "Più in alto", disabled: ir === 0, onclick: () => scambia(riquadri(), ir, ir - 1) }, "↑"),
          h("button", { type: "button", class: "mini", "aria-label": "Più in basso", disabled: ir === g.length - 1, onclick: () => scambia(riquadri(), ir, ir + 1) }, "↓")),
        h("div", { style: "display:flex;gap:14px;align-items:center;margin-top:12px" },
          cop ? h("img", { src: src(cop), alt: "", style: "width:96px;aspect-ratio:3/4;object-fit:cover;border-radius:16px" }) : h("span", { class: "vuota" }),
          h("div", {}, h("span", { class: "etichetta" }, "Copertina"), h("button", { type: "button", class: "btn chiaro", onclick: () => scegliCopertina(ir) }, "Cambia copertina"))),
        h("div", { class: "due" }, campo("Nome del riquadro", `lavori.riquadri.${ir}.nome`, { segnaposto: "Es. Borse" }), campo("Frase sotto il nome", `lavori.riquadri.${ir}.sotto`, { segnaposto: "Es. A mano, a spalla e clutch" })),
        campo("Box per le richieste (facoltativo)", `lavori.riquadri.${ir}.richiesta`, { lungo: true, righe: 2, aiuto: "Se scrivi qualcosa, dentro il riquadro compare questo testo con il pulsante WhatsApp (come in «Su misura»)." }),
        h("span", { class: "etichetta", style: "margin-top:20px" }, `Categorie dentro «${r.nome}»`),
        cat.map((k) => rigaCat(k, cat)),
        h("button", { type: "button", class: "nuovo", onclick: () => nuovaCat(r.id) }, "+ Aggiungi una categoria qui"),
        h("button", { type: "button", class: "btn rosso", style: "margin-top:14px", onclick: () => {
          if (confirm(`Eliminare il riquadro «${r.nome}»? Le sue categorie diventano riquadri a sé (non si perde nessun modello).`))
            cambia(() => { categorie().forEach((k) => { if (k.riquadro === r.id) k.riquadro = ""; }); riquadri().splice(ir, 1); }, "Riquadro eliminato");
        } }, "Elimina riquadro"));
    }),
    h("div", { class: "card" },
      h("h2", {}, "Categorie a sé"),
      h("p", { class: "aiuto" }, "Queste categorie non stanno in un riquadro: sul sito ognuna diventa un riquadro suo (es. Natale)."),
      sole.length ? sole.map((k) => rigaCat(k, sole)) : h("p", { class: "aiuto" }, "Nessuna."),
      h("button", { type: "button", class: "nuovo", onclick: () => nuovaCat("") }, "+ Aggiungi una categoria a sé")),
    riquadri().length < 12 && h("button", { type: "button", class: "btn largo", style: "margin-top:20px", onclick: () => cambia(() => riquadri().push({ id: nuovoId("r"), nome: "Nuovo riquadro", sotto: "", copertina: "", richiesta: "" }), "Riquadro aggiunto: cambiagli il nome e aggiungi le categorie") }, "+ Nuovo riquadro")
  ];
}
function modelliDelRiquadro(r) {
  const cat = categorie().filter((k) => k.riquadro === r.id).map((k) => k.id);
  return modelli().filter((m) => cat.includes(m.cat) && m.foto.length && !m.nascosto);
}
function copertinaDi(r) {
  const suoi = modelliDelRiquadro(r);
  return (suoi.find((m) => m.nome === r.copertina) || suoi[0])?.foto[0]?.src;
}
function scegliCopertina(ir) {
  const r = riquadri()[ir];
  const suoi = modelliDelRiquadro(r);
  const attuale = (suoi.find((m) => m.nome === r.copertina) || suoi[0])?.nome;
  apriFinestra(`Copertina di «${r.nome}»`,
    h("p", { class: "aiuto", style: "margin-top:0" }, "Tocca il modello da usare: si usa la sua prima foto. Per cambiare la foto, cambia la copertina del modello."),
    suoi.length ? h("div", { class: "scegli-copertina" }, suoi.map((m) => h("button", { type: "button", class: m.nome === attuale ? "scelta" : false, onclick: () => {
      chiudiFinestra(); cambia(() => (r.copertina = m.nome), "Copertina cambiata");
    } }, h("img", { src: src(m.foto[0].src), alt: "", loading: "lazy" }), nomeModello(m))))
      : h("p", { class: "riquadro-aiuto" }, "In questo riquadro non ci sono ancora modelli con foto."));
}
function eliminaCategoria(k) {
  const altre = categorie().filter((x) => x !== k);
  if (!altre.length) return alert("Serve almeno una categoria.");
  const suoi = modelli().filter((m) => m.cat === k.id);
  const dove = altre.find((x) => x.riquadro === k.riquadro) || altre[0];
  if (!confirm(suoi.length ? `Eliminare la categoria «${k.nome}»? I suoi ${suoi.length} modelli passano in «${dove.nome}».` : `Eliminare la categoria «${k.nome}»?`)) return;
  cambia(() => { suoi.forEach((m) => (m.cat = dove.id)); categorie().splice(categorie().indexOf(k), 1); }, "Categoria eliminata");
}

// --- mercatini ed eventi ---
const oggi = () => new Date().toLocaleDateString("en-CA"); // aaaa-mm-gg
const dataBella = (d) => (d ? new Date(d + "T12:00").toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "long" }) : "senza data");
function schermoEventi() {
  return [
    h("h1", {}, "Mercatini ed eventi"),
    h("p", { class: "sottotitolo" }, "Aggiungi le date dei mercatini. Quando sono passate spariscono da sole dal sito: non serve toglierle."),
    lista("eventi.lista", { nome: "un mercatino", max: 40, inCima: true,
      nuova: () => ({ data: "", fine: "", nome: "", luogo: "", orari: "", link: "" }),
      titolo: (v) => `${dataBella(v.data)} · ${v.nome || "nuovo"}`,
      classe: (v) => (v.data && (v.fine || v.data) < oggi() ? "passato" : ""),
      campi: (p, v) => [
        !v.data && h("p", { class: "riquadro-aiuto" }, "Scegli il giorno e scrivi il nome: senza, non si vede sul sito."),
        campo("Nome del mercatino", `${p}.nome`, { segnaposto: "Es. Mercatino di Natale di Moncalieri" }),
        h("div", { class: "due" }, campo("Giorno", `${p}.data`, { tipo: "date" }), campo("Ultimo giorno (se dura più giorni)", `${p}.fine`, { tipo: "date" })),
        h("div", { class: "due" }, campo("Dove", `${p}.luogo`, { segnaposto: "Es. Piazza Vittorio, Torino" }), campo("Orari", `${p}.orari`, { segnaposto: "Es. 10:00 – 19:00" })),
        campo("Link (facoltativo)", `${p}.link`, { tipo: "url", aiuto: "Per esempio il post Instagram dell'evento." })] }),
    h("div", { class: "card" }, campo("Titolo della sezione", "eventi.titolo"), campo("Frase quando non ci sono mercatini in programma", "eventi.vuoto", { lungo: true, righe: 2 }))
  ];
}

// --- recensioni ---
async function caricaAttesa() {
  try { attesa = await chiama("/api/attesa"); } catch { return; }
  if (["", "recensioni"].includes(rotta().nome)) disegna();
}
async function decidi(r, azione, bottone) {
  bottone.disabled = true;
  try {
    const esito = await chiama("/api/attesa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: r.id, azione }) });
    attesa = attesa.filter((x) => x.id !== r.id);
    if (esito.recensione) dati.recensioni.lista.unshift(esito.recensione); // già salvata sul sito
    avviso(esito.recensione ? "Pubblicata sul sito!" : "Cancellata");
    disegna();
  } catch (err) { alert(err.message); bottone.disabled = false; }
}
function schermoRecensioni() {
  return [
    h("h1", {}, "Recensioni"),
    attesa.length
      ? h("div", { class: "card" }, h("h2", {}, `Da approvare (${attesa.length})`), h("p", { class: "aiuto" }, "Le hanno lasciate i clienti dal sito. Non si vedono finché non le pubblichi."),
        attesa.map((r) => h("div", { class: "voce" },
          h("div", { class: "voce-top" }, h("strong", {}, `${new Date(r.data).toLocaleDateString("it-IT", { day: "numeric", month: "long" })} · ${r.nome || "senza nome"}${r.pezzo ? " · " + r.pezzo : ""}`)),
          h("p", { style: "margin:8px 0 12px;white-space:pre-line" }, r.testo),
          h("div", { style: "display:flex;gap:10px;flex-wrap:wrap" },
            h("button", { type: "button", class: "btn", onclick: (e) => decidi(r, "pubblica", e.currentTarget) }, "Pubblica sul sito"),
            h("button", { type: "button", class: "btn rosso", onclick: (e) => { if (confirm("Cancellare questa recensione?")) decidi(r, "togli", e.currentTarget); } }, "Cancella")))))
      : h("p", { class: "riquadro-aiuto" }, "Nessuna recensione nuova da approvare. Quando un cliente ne lascia una dal sito, la trovi qui."),
    h("h2", { style: "margin-top:28px;font-size:1.7rem" }, "Sul sito"),
    h("p", { class: "aiuto" }, "Puoi anche aggiungerle tu, copiando le frasi delle clienti da WhatsApp o Instagram. Quelle in cima si vedono per prime."),
    lista("recensioni.lista", { nome: "una recensione", max: 30, inCima: true,
      nuova: () => ({ testo: "", nome: "", pezzo: "" }),
      titolo: (v, i) => `${i + 1}. ${v.nome || "Recensione nuova"}`,
      campi: (p) => [
        campo("Cosa ha scritto", `${p}.testo`, { lungo: true, righe: 3, segnaposto: "Es. La borsa è bellissima, curata in ogni dettaglio!" }),
        h("div", { class: "due" }, campo("Nome (o solo l'iniziale)", `${p}.nome`, { segnaposto: "Es. Giulia M." }), campo("Cosa ha preso (facoltativo)", `${p}.pezzo`, { segnaposto: "Es. Bauletto bordeaux" }))] }),
    h("div", { class: "card" }, campo("Titolo della sezione", "recensioni.titolo"))
  ];
}

// --- foto dei mercatini ---
function schermoMercatini() {
  return [
    h("h1", {}, "Foto dei mercatini"),
    h("p", { class: "sottotitolo" }, `Scorrono in una riga nella sezione «Dove trovarmi» (al massimo 12). Tocca una foto per spostarla, cambiarla o scriverci una didascalia.`),
    h("div", { class: "card" }, grigliaFoto("mercatini.foto", { max: 12, copertina: "", nota: "Didascalia (facoltativa)", esempioNota: "Es. Il mio banco al mercatino di Volpiano" })),
    h("div", { class: "card" }, h("h2", {}, "Testi di «Dove trovarmi»"),
      campo("Titolo", "mercatini.titolo"),
      campo("Frase sotto il titolo", "mercatini.testo", { lungo: true, righe: 2 }),
      campo("Riquadro «Ai mercatini»", "mercatini.ai_mercatini", { lungo: true, righe: 2 }),
      campo("Riquadro «Consegna a mano»", "mercatini.a_mano", { lungo: true, righe: 2 }),
      campo("Riquadro «Spedizione»", "mercatini.spedizione", { lungo: true, righe: 2 }))
  ];
}

// --- testi ---
function schermoTesti() {
  return [
    h("h1", {}, "Testi del sito"),
    h("p", { class: "sottotitolo" }, "Nell'ordine in cui si vedono sul sito."),
    h("div", { class: "card" }, h("h2", {}, "In alto (prima schermata)"),
      campo("Etichetta gialla", "hero.eyebrow"),
      h("div", { class: "due" }, campo("Titolo", "hero.titolo"), campo("Seconda riga in corsivo", "hero.corsivo")),
      campo("Testo", "hero.testo", { lungo: true }),
      fotoSingola("Illustrazione accanto al titolo", "hero.foto")),
    h("div", { class: "card" }, h("h2", {}, "Le mie creazioni"),
      campo("Titolo della sezione", "lavori.titolo"),
      campo("Frase sotto il titolo", "lavori.testo", { lungo: true, righe: 3 })),
    h("div", { class: "card" }, h("h2", {}, "Su richiesta"),
      campo("Titolo", "richiesta.titolo"),
      [0, 1, 2].map((i) => h("div", { class: "voce" }, h("div", { class: "voce-top" }, h("strong", {}, `Passo ${i + 1}`)),
        campo("Titolo", `richiesta.passi.${i}.titolo`), campo("Testo", `richiesta.passi.${i}.testo`, { lungo: true, righe: 2 })))),
    h("div", { class: "card" }, h("h2", {}, "Chi sono"),
      campo("Titolo", "chi.titolo"),
      campo("Testo", "chi.testo", { lungo: true, righe: 10, aiuto: "Per iniziare un nuovo paragrafo lascia una riga vuota." }),
      campo("Frase finale", "chi.firma"),
      fotoSingola("Foto", "chi.foto")),
    h("p", { class: "aiuto", style: "margin-top:16px" }, "I testi di «Dove trovarmi» sono in «Foto dei mercatini», quelli dei contatti in «Contatti e social».")
  ];
}

// --- contatti ---
function schermoContatti() {
  return [
    h("h1", {}, "Contatti e social"),
    h("div", { class: "card" },
      campo("Numero WhatsApp", "contatti.whatsapp", { tipo: "tel", aiuto: "È il numero di tutti i pulsanti WhatsApp del sito." }),
      campo("Link Instagram", "contatti.instagram", { tipo: "url", aiuto: "Lascia vuoto per toglierlo dal sito." }),
      campo("Link TikTok", "contatti.tiktok", { tipo: "url", aiuto: "Lascia vuoto per toglierlo dal sito." })),
    h("div", { class: "card" }, h("h2", {}, "In fondo alla pagina"),
      campo("Titolo", "contatti.titolo"),
      campo("Frase sotto il titolo", "contatti.testo"))
  ];
}

// --- versioni precedenti ---
function schermoVersioni() {
  const box = h("div", {}, h("p", { class: "aiuto" }, "Carico…"));
  chiama("/api/copie").then((copie) => {
    const quando = (c) => { const d = new Date(c.length <= 13 ? c + ":00:00Z" : c.endsWith("Z") ? c : c + "Z"); return d.toLocaleString("it-IT", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }); };
    box.replaceChildren(copie.length
      ? h("div", { class: "righe" }, copie.map((c) => h("div", { class: "riga", style: "padding:12px 14px" },
          h("span", { style: "flex:1" }, h("b", {}, quando(c))),
          h("button", { type: "button", class: "btn chiaro", onclick: async (e) => {
            if (!confirm(`Riportare il sito a com'era ${quando(c)}? (Potrai comunque tornare a com'è adesso: viene salvata anche questa versione.)`)) return;
            e.currentTarget.disabled = true;
            try {
              const r = await chiama("/api/copie", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ copia: c }) });
              dati = r.contenuti; storia = []; $("#annulla").hidden = true;
              avviso("Fatto! Il sito è tornato a quella versione.");
              vai("");
            } catch (err) { alert(err.message); e.currentTarget.disabled = false; }
          } }, "Ripristina"))))
      : h("p", { class: "riquadro-aiuto" }, "Non ci sono ancora versioni precedenti: si creano da sole mentre fai modifiche (una ogni ora, tenute per 2 mesi)."));
  }).catch((err) => box.replaceChildren(h("p", { class: "errore" }, err.message)));
  return [
    h("h1", {}, "Versioni precedenti"),
    h("p", { class: "sottotitolo" }, "Per un errore piccolo appena fatto usa «↶ Annulla» in alto. Se invece vuoi tornare a com'era il sito qualche ora o giorno fa, scegli qui sotto. Ogni versione è com'era il sito a quell'ora, prima delle modifiche."),
    box
  ];
}

// --- password ---
function schermoPassword() {
  const pw = (id, label, auto) => h("div", { class: "campo" }, h("label", { for: id }, label), h("input", { id, type: "password", autocomplete: auto }));
  const esito = h("p", { class: "errore" });
  const bottone = h("button", { type: "button", class: "btn", style: "margin-top:18px", onclick: async () => {
    const vecchia = $("#pw-vecchia").value, nuova = $("#pw-nuova").value;
    esito.className = "errore";
    if (nuova.length < 12) return (esito.textContent = "La nuova password deve avere almeno 12 caratteri.");
    if (nuova !== $("#pw-ripeti").value) return (esito.textContent = "Le due password nuove non sono uguali.");
    bottone.disabled = true;
    esito.textContent = "Cambio la password…";
    try {
      await chiama("/api/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vecchia, nuova }) });
      ["#pw-vecchia", "#pw-nuova", "#pw-ripeti"].forEach((s) => ($(s).value = ""));
      esito.className = "errore ok";
      esito.textContent = "Fatto! Da adesso per entrare usa la password nuova.";
    } catch (err) { esito.textContent = err.message; }
    bottone.disabled = false;
  } }, "Cambia password");
  return [
    h("h1", {}, "Password"),
    h("div", { class: "card" },
      h("p", { class: "aiuto", style: "margin-top:14px" }, "Scegli una password di almeno 12 caratteri. Sugli altri telefoni e computer bisognerà entrare di nuovo."),
      pw("pw-vecchia", "Password attuale", "current-password"),
      pw("pw-nuova", "Nuova password", "new-password"),
      pw("pw-ripeti", "Ripeti la nuova password", "new-password"),
      bottone, esito)
  ];
}

// ---------- accesso ----------
function mostraLogin() {
  $("#admin").hidden = true;
  $("#login").hidden = false;
  $("#password").focus();
}
async function apri() {
  try {
    const nuovi = await chiama("/api/contenuti");
    // se la sessione era scaduta con delle modifiche non ancora salvate, le tengo e le salvo adesso
    if (!(dati && daSalvare)) dati = nuovi;
    dati.recensioni ??= { titolo: "Dicono di me", lista: [] };
    dati.lavori.riquadri ??= [];
    dati.mercatini.foto = dati.mercatini.foto.map((f) => (typeof f === "string" ? { src: f, nota: "" } : f));
    dati.lavori.lista.forEach((m) => (m.nascosto ??= false));
  } catch (err) {
    if (err.status !== 401) { mostraLogin(); $("#errore-login").textContent = err.message; }
    return; // 401: chiama() ha già mostrato il login
  }
  $("#login").hidden = true;
  $("#admin").hidden = false;
  if (daSalvare) programmaSalva(0); else statoSalva("Tutto salvato");
  disegna();
  caricaAttesa();
}
$("#form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#errore-login").textContent = "";
  try {
    await chiama("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: $("#password").value }) });
    $("#password").value = "";
    apri();
  } catch (err) { $("#errore-login").textContent = err.message; }
});
async function esci() {
  if ((daSalvare || salvando) && !confirm("Sto ancora salvando. Uscire lo stesso?")) return;
  await chiama("/api/logout", { method: "POST" }).catch(() => {});
  dati = null; storia = [];
  mostraLogin();
}

apri();
