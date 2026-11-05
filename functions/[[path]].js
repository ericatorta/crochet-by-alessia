// Admin del sito crochet by Alessia (Cloudflare Pages Functions). Stesso sistema del sito di Rossino.
// I contenuti modificati da Alessia stanno nel KV "CONTENUTI": la chiave "contenuti" (JSON) e le foto "foto:<id>".
// Finché nel KV non c'è niente valgono quelli di contenuti.json (che coincide con index.html).
//
//   GET  /              la pagina, con i contenuti messi al posto dei data-c di index.html (gli eventi passati spariscono da soli)
//   GET  /media/<id>    una foto caricata dall'admin
//   POST /api/login     { password }  -> cookie di sessione (30 giorni)
//   POST /api/logout
//   GET  /api/contenuti                -> contenuti attuali (KV oppure contenuti.json)
//   PUT  /api/contenuti                <- contenuti nuovi (solo con sessione)
//   POST /api/foto      corpo = la foto (jpeg/png/webp, già rimpicciolita dall'admin) -> { url }
//   GET  /api/copie                    -> versioni precedenti (una per ora, 60 giorni)
//   POST /api/copie     { copia }      -> torna a quella versione (solo con sessione)
//   POST /api/password  { vecchia, nuova }  -> cambia la password (solo con sessione)
//   POST /api/recensione { testo, nome, pezzo } <- dal sito, chiunque: finisce "da approvare" (al massimo 3 all'ora per indirizzo)
//   GET  /api/attesa                   -> recensioni da approvare (solo con sessione)
//   POST /api/attesa    { id, azione: "pubblica" | "togli" } (solo con sessione)
//
// Variabili (Cloudflare Pages → Settings → Variables and secrets):
//   ADMIN_PASSWORD  password iniziale di Alessia (secret, almeno 12 caratteri); dopo un cambio dall'admin vale quella nel KV
//   SESSION_SECRET  stringa lunga a caso (secret), firma i cookie
// Binding KV: CONTENUTI

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

// ---------- password e sessione (come Rossino) ----------
const enc = new TextEncoder();
const bytesToB64 = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
// Se Alessia ha cambiato la password dall'admin, nel KV c'è "password" = "sale.hash" (PBKDF2) e vale quella;
// altrimenti vale ADMIN_PASSWORD. Per tornare a ADMIN_PASSWORD (password dimenticata) basta cancellare "password" dal KV.
const passwordSalvata = (env) => env.CONTENUTI.get("password");
async function pbkdf2(password, sale) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return bytesToB64(new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(sale), iterations: 100000 }, base, 256)));
}
async function passwordGiusta(env, password) {
  const salvata = await passwordSalvata(env);
  if (!salvata) return same(password, String(env.ADMIN_PASSWORD));
  const [sale, hash] = salvata.split(".");
  return same(await pbkdf2(password, sale), hash);
}
// la chiave dei cookie dipende dalla password attuale: quando cambia, tutti gli altri accessi scadono
async function hmac(env, text) {
  const segreto = (await passwordSalvata(env)) || env.ADMIN_PASSWORD;
  const key = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", enc.encode(`${segreto}|${env.SESSION_SECRET}`)),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToB64(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(text)))).replace(/=+$/, "");
}
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const configurato = (env) => !!env.CONTENUTI && String(env.ADMIN_PASSWORD || "").length >= 12 && String(env.SESSION_SECRET || "").length >= 16;
const SESSION_DAYS = 30;
async function sessionOk(request, env) {
  if (!configurato(env)) return false;
  const m = (request.headers.get("cookie") || "").match(/(?:^|;\s*)alessia_session=([^;]+)/);
  if (!m) return false;
  const [exp, sig] = decodeURIComponent(m[1]).split(".");
  return !!sig && +exp > Date.now() && same(sig, await hmac(env, exp));
}
const cookie = (value, maxAge) => `alessia_session=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

// ---------- contenuti ----------
async function predefiniti(request, env) {
  const r = await env.ASSETS.fetch(new URL("/contenuti.json", request.url));
  return r.json();
}
async function contenuti(request, env) {
  const salvati = env.CONTENUTI ? await env.CONTENUTI.get("contenuti", "json") : null;
  const prima = await predefiniti(request, env);
  // anche quelli salvati da una versione precedente dell'admin passano di qui: i campi nuovi prendono i valori di contenuti.json
  return salvati ? pulisci(salvati, prima) : prima;
}

// Controlla e ripulisce quello che arriva dall'admin: solo i campi previsti, solo testo, lunghezze ragionevoli.
const T = (v, max = 600) => String(v ?? "").replace(/\r/g, "").slice(0, max).trim();
const FOTO = /^(foto\/[\w-]+(\/[\w-]+)*\.jpe?g|\/media\/[a-z0-9]{20})$/;
const F = (v, prima) => (FOTO.test(String(v)) ? String(v) : prima);
const ID_CAT = /^[a-z0-9-]{1,40}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const URL_SOCIAL = (v, host) => { try { const u = new URL(String(v)); return u.protocol === "https:" && u.hostname.endsWith(host) ? u.href : ""; } catch { return ""; } };
function pulisci(c, prima) {
  const pulito = pulisciTutto(c, prima);
  const ids = pulito.lavori.categorie.map((k) => k.id);
  pulito.lavori.lista.forEach((l) => { if (!ids.includes(l.cat)) l.cat = ids[0]; });
  return pulito;
}
function pulisciTutto(c, prima) {
  const lista = (v, max, fn) => (Array.isArray(v) ? v.slice(0, max).map(fn).filter(Boolean) : []);
  const tel = T(c?.contatti?.whatsapp, 30);
  return {
    hero: { eyebrow: T(c?.hero?.eyebrow, 120), titolo: T(c?.hero?.titolo, 80), corsivo: T(c?.hero?.corsivo, 60), testo: T(c?.hero?.testo, 500), foto: F(c?.hero?.foto, prima.hero.foto || "foto/logo.jpg") },
    lavori: {
      titolo: T(c?.lavori?.titolo, 120), testo: T(c?.lavori?.testo, 300),
      // le categorie le decide Alessia dall'admin (es. "Natale"); senza nessuna valida restano quelle di contenuti.json
      categorie: (() => {
        const visti = new Set();
        const cat = lista(c?.lavori?.categorie, 30, (k) => (ID_CAT.test(String(k?.id)) && T(k?.nome) && !visti.has(k.id) && visti.add(k.id) ? { id: k.id, nome: T(k.nome, 40), riquadro: ID_CAT.test(String(k?.riquadro)) ? k.riquadro : "" } : null));
        // salvate prima che esistessero i riquadri: il riquadro lo prendono da contenuti.json
        if (!Array.isArray(c?.lavori?.riquadri)) cat.forEach((k) => (k.riquadro = prima.lavori.categorie.find((x) => x.id === k.id)?.riquadro || ""));
        return cat.length ? cat : prima.lavori.categorie;
      })(),
      // i riquadri del sito: ognuno raccoglie le categorie che puntano a lui; copertina = nome di un modello
      riquadri: Array.isArray(c?.lavori?.riquadri)
        ? (() => { const visti = new Set(); return lista(c.lavori.riquadri, 12, (r) => (ID_CAT.test(String(r?.id)) && T(r?.nome) && !visti.has(r.id) && visti.add(r.id)
          ? { id: r.id, nome: T(r.nome, 40), sotto: T(r?.sotto, 120), copertina: T(r?.copertina, 60), richiesta: T(r?.richiesta, 400) } : null)); })()
        : prima.lavori.riquadri || [],
      // ogni modello ha le sue foto (le varianti, con una nota facoltativa); un modello senza foto non si mostra
      lista: lista(c?.lavori?.lista, 120, (l) => {
        const foto = lista(l?.foto, 40, (f) => (FOTO.test(String(f?.src)) ? { src: String(f.src), nota: T(f?.nota, 120) } : null));
        // un modello appena creato può non avere ancora foto (sul sito non si vede finché non ne ha una)
        return foto.length || T(l?.nome) ? { cat: String(l?.cat ?? ""), nome: T(l?.nome, 60), testo: T(l?.testo, 200), foto, nascosto: l?.nascosto === true } : null;
      })
    },
    richiesta: {
      titolo: T(c?.richiesta?.titolo, 120),
      passi: [0, 1, 2].map((i) => ({ titolo: T(c?.richiesta?.passi?.[i]?.titolo, 60), testo: T(c?.richiesta?.passi?.[i]?.testo, 300) }))
    },
    chi: { titolo: T(c?.chi?.titolo, 120), testo: T(c?.chi?.testo, 3000), firma: T(c?.chi?.firma, 120), foto: F(c?.chi?.foto, prima.chi.foto) },
    eventi: {
      titolo: T(c?.eventi?.titolo, 120), vuoto: T(c?.eventi?.vuoto, 300),
      lista: lista(c?.eventi?.lista, 40, (e) => (DATA.test(String(e?.data)) && T(e?.nome) ? {
        data: e.data, fine: DATA.test(String(e?.fine)) && e.fine > e.data ? e.fine : "",
        nome: T(e.nome, 100), luogo: T(e?.luogo, 140), orari: T(e?.orari, 60), link: URL_SOCIAL(e?.link, "")
      } : null)).sort((a, b) => a.data.localeCompare(b.data))
    },
    mercatini: {
      titolo: T(c?.mercatini?.titolo, 120), testo: T(c?.mercatini?.testo, 300),
      // da 1 a 12 foto, ognuna con una didascalia facoltativa (si vede quando la foto si apre grande)
      foto: (() => {
        const f = lista(c?.mercatini?.foto, 12, (x) => { const v = typeof x === "string" ? x : x?.src; return FOTO.test(String(v)) ? { src: String(v), nota: T(x?.nota, 120) } : null; });
        return f.length ? f : prima.mercatini.foto;
      })(),
      ai_mercatini: T(c?.mercatini?.ai_mercatini, 300), a_mano: T(c?.mercatini?.a_mano, 300), spedizione: T(c?.mercatini?.spedizione, 300)
    },
    // le recensioni le copia Alessia dai messaggi delle clienti; senza testo non si mostrano
    recensioni: {
      titolo: T(c?.recensioni?.titolo, 120) || "Dicono di me",
      lista: lista(c?.recensioni?.lista, 30, (r) => (T(r?.testo) ? { testo: T(r.testo, 600), nome: T(r?.nome, 60), pezzo: T(r?.pezzo, 80) } : null))
    },
    contatti: {
      titolo: T(c?.contatti?.titolo, 120) || prima.contatti.titolo, testo: T(c?.contatti?.testo, 300) || prima.contatti.testo,
      whatsapp: tel.replace(/\D/g, "").length >= 6 ? tel : prima.contatti.whatsapp,
      instagram: URL_SOCIAL(c?.contatti?.instagram, "instagram.com"), tiktok: URL_SOCIAL(c?.contatti?.tiktok, "tiktok.com")
    }
  };
}

// ---------- la pagina ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const img = (p) => (p.startsWith("/") ? p : "/" + p);
const waNumero = (t) => { const n = t.replace(/\D/g, "").replace(/^00/, ""); return n.startsWith("39") ? n : "39" + n; };
const nomeSocial = (u) => "@" + u.replace(/\/+$/, "").split("/").pop().replace(/^@/, "");
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
const oggi = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date()); // "aaaa-mm-gg"
function dataEvento(e) {
  const d = new Date(e.data + "T12:00:00Z");
  const giorno = `${GIORNI[d.getUTCDay()]} ${d.getUTCDate()} ${MESI[d.getUTCMonth()]}`;
  if (!e.fine) return { n: d.getUTCDate(), m: MESI[d.getUTCMonth()], testo: giorno };
  const f = new Date(e.fine + "T12:00:00Z");
  const art = (n, a) => ([1, 8, 11].includes(n) ? a + "ll'" : a + "l ") + n; // "dall'8", "all'11"
  return { n: d.getUTCDate(), m: MESI[d.getUTCMonth()], testo: `${art(d.getUTCDate(), "da")} ${MESI[d.getUTCMonth()]} ${art(f.getUTCDate(), "a")} ${MESI[f.getUTCMonth()]}` };
}
const paragrafi = (t) => t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");

// Per ogni data-c: cosa mettere (text = testo semplice, html = già escapato qui, attr = solo un attributo).
function valori(c) {
  const wa = waNumero(c.contatti.whatsapp);
  const prossimi = c.eventi.lista.filter((e) => (e.fine || e.data) >= oggi());
  const v = {
    "hero.eyebrow": { text: c.hero.eyebrow },
    "hero.h1": { html: `${esc(c.hero.titolo)}<br><em>${esc(c.hero.corsivo)}</em>` },
    "hero.testo": { text: c.hero.testo },
    "hero.foto": { attr: ["src", img(c.hero.foto)] },
    "lavori.titolo": { text: c.lavori.titolo },
    "lavori.testo": { text: c.lavori.testo },
    // stesse schede di index.html: la copertina è la prima foto, le altre le apre la galleria (data-foto)
    // le categorie (nome e ordine) le legge lo script della pagina per disegnare i riquadri
    "lavori.categorie": { html: (c.lavori.categorie || []).map((k) => `<span data-id="${esc(k.id)}" data-riquadro="${esc(k.riquadro)}">${esc(k.nome)}</span>`).join("") },
    "lavori.riquadri": { html: c.lavori.riquadri.map((r) => `<span data-id="${esc(r.id)}" data-sotto="${esc(r.sotto)}" data-copertina="${esc(r.copertina)}" data-richiesta="${esc(r.richiesta)}">${esc(r.nome)}</span>`).join("") },
    "lavori.lista": { html: c.lavori.lista.filter((l) => l.foto.length && !l.nascosto).map((l) => {
      const f = l.foto.map((x) => ({ src: img(x.src), nota: x.nota }));
      return `<article class="lavoro" data-cat="${l.cat}" data-foto="${esc(JSON.stringify(f))}" tabindex="0" role="button" aria-label="${esc(l.nome)}: vedi ${f.length} foto">`
        + `<div class="cop"><img src="${esc(f[0].src)}" alt="${esc(l.nome)} all'uncinetto" loading="lazy">${f.length > 1 ? `<span class=conta>${f.length} foto</span>` : ""}</div>`
        + `<div><h3>${esc(l.nome)}</h3><p>${esc(l.testo)}</p></div></article>`;
    }).join("") },
    "richiesta.titolo": { text: c.richiesta.titolo },
    "richiesta.passi": { html: c.richiesta.passi.map((p) => `<div class="passo"><h3>${esc(p.titolo)}</h3><p>${esc(p.testo)}</p></div>`).join("") },
    "chi.titolo": { text: c.chi.titolo },
    "chi.testo": { html: paragrafi(c.chi.testo) },
    "chi.firma": { text: c.chi.firma },
    "chi.foto": { attr: ["src", img(c.chi.foto)] },
    "eventi.titolo": { text: c.eventi.titolo },
    "eventi.lista": { html: prossimi.length
      ? prossimi.map((e) => { const d = dataEvento(e); return `<li class="evento"><div class="giorno"><b>${d.n}</b>${d.m}</div><div><h3>${esc(e.nome)}</h3><p>${esc(d.testo)}${e.orari ? " · " + esc(e.orari) : ""}</p>${e.luogo ? `<p class="luogo">📍 ${esc(e.luogo)}</p>` : ""}${e.link ? `<a href="${esc(e.link)}" target="_blank" rel="noopener">Più informazioni →</a>` : ""}</div></li>`; }).join("")
      : `<li class="nessuno">${esc(c.eventi.vuoto)}</li>` },
    "mercatini.titolo": { text: c.mercatini.titolo },
    "mercatini.testo": { text: c.mercatini.testo },
    "mercatini.foto": { html: c.mercatini.foto.map((f) => `<img src="${esc(img(f.src))}" alt="${esc(f.nota || "Il banco di crochet by Alessia a un mercatino")}" loading="lazy">`).join("") },
    "mercatini.ai_mercatini": { text: c.mercatini.ai_mercatini },
    "mercatini.a_mano": { text: c.mercatini.a_mano },
    "mercatini.spedizione": { text: c.mercatini.spedizione },
    "recensioni.titolo": { text: c.recensioni.titolo },
    "recensioni.lista": { html: c.recensioni.lista.map((r) => `<li class="recensione"><blockquote>“${esc(r.testo)}”</blockquote>`
      + (r.nome || r.pezzo ? `<p>${esc(r.nome)}${r.pezzo ? `<small>${esc(r.pezzo)}</small>` : ""}</p>` : "") + "</li>").join("") },
    "contatti.titolo": { text: c.contatti.titolo },
    "contatti.testo": { text: c.contatti.testo },
    "contatti.whatsapp": { text: "WhatsApp · " + c.contatti.whatsapp, attr: ["href", "https://wa.me/" + wa] },
    "contatti.instagram": { text: "Instagram " + nomeSocial(c.contatti.instagram), attr: ["href", c.contatti.instagram], nascondi: !c.contatti.instagram },
    "contatti.tiktok": { text: "TikTok " + nomeSocial(c.contatti.tiktok), attr: ["href", c.contatti.tiktok], nascondi: !c.contatti.tiktok }
  };
  return { v, wa, ig: c.contatti.instagram };
}

async function pagina(context) {
  const { request, env, next } = context;
  // senza le richieste condizionali: altrimenti arriva un 304 e il browser tiene la pagina vecchia
  const intestazioni = new Headers(request.headers);
  intestazioni.delete("if-none-match");
  intestazioni.delete("if-modified-since");
  const statica = await next(new Request(request.url, { method: request.method, headers: intestazioni }));
  // anche senza modifiche nel KV la pagina passa di qui: gli eventi passati devono sparire ogni giorno
  const { v, wa, ig } = valori(await contenuti(request, env));
  const out = new HTMLRewriter()
    .on("[data-c]", {
      element(el) {
        const x = v[el.getAttribute("data-c")];
        if (!x) return;
        if (x.nascondi) return el.remove();
        if (x.attr) el.setAttribute(x.attr[0], x.attr[1]);
        if (x.text !== undefined) el.setInnerContent(x.text);
        if (x.html !== undefined) el.setInnerContent(x.html, { html: true });
      }
    })
    // il pulsante WhatsApp in alto ha già un messaggio pronto: cambio solo il numero
    .on("a[data-wa]", { element(el) { el.setAttribute("href", (el.getAttribute("href") || "").replace(/wa\.me\/\d+/, "wa.me/" + wa)); } })
    .on("a[data-ig]", { element(el) { if (ig) el.setAttribute("href", ig); else el.remove(); } })
    .transform(statica);
  const h = new Headers(out.headers);
  h.set("cache-control", "no-cache");
  h.delete("etag");
  h.delete("last-modified");
  return new Response(out.body, { status: out.status, headers: h });
}

// ---------- foto ----------
const TIPI = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
async function media(id, env) {
  if (!env.CONTENUTI || !/^[a-z0-9]{20}$/.test(id)) return new Response("Non trovata", { status: 404 });
  const { value, metadata } = await env.CONTENUTI.getWithMetadata("foto:" + id, "arrayBuffer");
  if (!value) return new Response("Non trovata", { status: 404 });
  return new Response(value, { headers: { "content-type": metadata?.tipo || "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
}
const nuovoId = () => Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

// ---------- api ----------
async function api(context, route) {
  const { request, env } = context;
  const m = request.method;

  if (route === "login" && m === "POST") {
    if (!configurato(env)) return json({ errore: "L'admin non è ancora configurato." }, 503);
    const { password } = await request.json().catch(() => ({}));
    if (typeof password !== "string" || !(await passwordGiusta(env, password))) {
      await new Promise((r) => setTimeout(r, 900)); // frena chi prova le password a raffica
      return json({ errore: "Password sbagliata." }, 401);
    }
    const exp = String(Date.now() + SESSION_DAYS * 864e5);
    return json({ ok: true }, 200, { "set-cookie": cookie(`${exp}.${await hmac(env, exp)}`, SESSION_DAYS * 86400) });
  }
  if (route === "logout" && m === "POST") return json({ ok: true }, 200, { "set-cookie": cookie("", 0) });

  // recensione lasciata da un cliente sul sito: non si vede finché Alessia non la approva dall'admin
  if (route === "recensione" && m === "POST") {
    if (!env.CONTENUTI) return json({ errore: "Al momento non riesco a riceverla: scrivimi su WhatsApp!" }, 503);
    const body = await request.text();
    if (body.length > 4000) return json({ errore: "Il messaggio è troppo lungo." }, 413);
    let r;
    try { r = JSON.parse(body); } catch { return json({ errore: "Dati non validi." }, 400); }
    if (T(r?.sito)) return json({ ok: true }); // campo nascosto compilato: è un bot, faccio finta di niente
    const testo = T(r?.testo, 600);
    if (testo.length < 5) return json({ errore: "Scrivi qualche parola in più." }, 400);
    const ip = request.headers.get("cf-connecting-ip") || "?";
    const n = Number(await env.CONTENUTI.get("limite:" + ip)) || 0;
    if (n >= 3) return json({ errore: "Hai già inviato diverse recensioni: riprova più tardi." }, 429);
    await env.CONTENUTI.put("limite:" + ip, String(n + 1), { expirationTtl: 3600 });
    const attesa = (await env.CONTENUTI.get("attesa", "json")) || [];
    if (attesa.length >= 50) return json({ errore: "Al momento non riesco a riceverla: scrivimi su WhatsApp!" }, 503);
    attesa.push({ id: nuovoId(), testo, nome: T(r?.nome, 60), pezzo: T(r?.pezzo, 80), data: new Date().toISOString() });
    await env.CONTENUTI.put("attesa", JSON.stringify(attesa));
    return json({ ok: true });
  }

  if (!(await sessionOk(request, env))) return json({ errore: "Accesso scaduto: entra di nuovo con la password." }, 401);

  if (route === "attesa" && m === "GET") return json((await env.CONTENUTI.get("attesa", "json")) || []);
  if (route === "attesa" && m === "POST") {
    const { id, azione } = await request.json().catch(() => ({}));
    const attesa = (await env.CONTENUTI.get("attesa", "json")) || [];
    const r = attesa.find((x) => x.id === id);
    if (!r) return json({ errore: "Questa recensione non c'è più." }, 404);
    await env.CONTENUTI.put("attesa", JSON.stringify(attesa.filter((x) => x.id !== id)));
    if (azione !== "pubblica") return json({ ok: true });
    // pubblicata: va in cima alle recensioni del sito
    const c = await contenuti(request, env);
    c.recensioni.lista.unshift({ testo: r.testo, nome: r.nome, pezzo: r.pezzo });
    const puliti = pulisci(c, c);
    await env.CONTENUTI.put("contenuti", JSON.stringify(puliti));
    return json({ ok: true, recensione: puliti.recensioni.lista[0] });
  }

  if (route === "contenuti" && m === "GET") return json(await contenuti(request, env));
  if (route === "contenuti" && m === "PUT") {
    const body = await request.text();
    if (body.length > 200000) return json({ errore: "Troppo testo." }, 413);
    let dati;
    try { dati = JSON.parse(body); } catch { return json({ errore: "Dati non validi." }, 400); }
    const prima = await contenuti(request, env);
    const puliti = pulisci(dati, prima);
    // l'admin salva da solo a ogni modifica: tengo una copia di com'era il sito all'inizio di ogni ora (per 60 giorni),
    // così Alessia può tornare indietro da "Versioni precedenti"
    const ora = "contenuti:" + new Date().toISOString().slice(0, 13);
    if (!(await env.CONTENUTI.get(ora))) await env.CONTENUTI.put(ora, JSON.stringify(prima), { expirationTtl: 60 * 86400 });
    await env.CONTENUTI.put("contenuti", JSON.stringify(puliti));
    return json({ ok: true, contenuti: puliti });
  }
  // versioni precedenti (le copie orarie qui sopra)
  if (route === "copie" && m === "GET") {
    const { keys } = await env.CONTENUTI.list({ prefix: "contenuti:" });
    return json(keys.map((k) => k.name.slice(10)).sort().reverse().slice(0, 100));
  }
  if (route === "copie" && m === "POST") {
    const { copia } = await request.json().catch(() => ({}));
    const vecchia = /^[\dT:.Z-]{10,30}$/.test(String(copia)) ? await env.CONTENUTI.get("contenuti:" + copia, "json") : null;
    if (!vecchia) return json({ errore: "Questa versione non c'è più." }, 404);
    const attuali = await contenuti(request, env);
    // prima di tornare indietro salvo com'è adesso, così si può anche annullare il ripristino
    await env.CONTENUTI.put("contenuti:" + new Date().toISOString().slice(0, 19), JSON.stringify(attuali), { expirationTtl: 60 * 86400 });
    const puliti = pulisci(vecchia, attuali);
    await env.CONTENUTI.put("contenuti", JSON.stringify(puliti));
    return json({ ok: true, contenuti: puliti });
  }
  if (route === "foto" && m === "POST") {
    const tipo = (request.headers.get("content-type") || "").split(";")[0];
    if (!TIPI[tipo]) return json({ errore: "Formato non supportato: usa una foto JPG o PNG." }, 415);
    const dati = await request.arrayBuffer();
    if (dati.byteLength > 4 * 1024 * 1024) return json({ errore: "Foto troppo pesante." }, 413);
    const id = nuovoId();
    await env.CONTENUTI.put("foto:" + id, dati, { metadata: { tipo } });
    return json({ url: "/media/" + id });
  }
  if (route === "password" && m === "POST") {
    const { vecchia, nuova } = await request.json().catch(() => ({}));
    if (typeof vecchia !== "string" || !(await passwordGiusta(env, vecchia))) {
      await new Promise((r) => setTimeout(r, 900));
      return json({ errore: "La password attuale è sbagliata." }, 403);
    }
    if (typeof nuova !== "string" || nuova.length < 12 || nuova.length > 200) return json({ errore: "La nuova password deve avere almeno 12 caratteri." }, 400);
    const sale = nuovoId();
    await env.CONTENUTI.put("password", `${sale}.${await pbkdf2(nuova, sale)}`);
    // nuovo cookie con la chiave nuova, così chi l'ha cambiata resta dentro
    const exp = String(Date.now() + SESSION_DAYS * 864e5);
    return json({ ok: true }, 200, { "set-cookie": cookie(`${exp}.${await hmac(env, exp)}`, SESSION_DAYS * 86400) });
  }
  return json({ errore: "Non trovato." }, 404);
}

export async function onRequest(context) {
  const path = new URL(context.request.url).pathname;
  if (path === "/" && ["GET", "HEAD"].includes(context.request.method)) return pagina(context);
  if (path.startsWith("/media/")) return media(path.slice(7), context.env);
  if (path.startsWith("/api/")) return api(context, path.slice(5));
  return context.next();
}
