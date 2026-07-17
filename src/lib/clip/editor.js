/* eslint-disable */
// @ts-nocheck
// Editor de clipping — PORT del editor real del cliente (ketchum-mailchimp/index.html).
// Adaptado a la app: monta sobre `root`, un cliente por vez (la navegación entre clientes la maneja
// React arriba con un desplegable), SECCIONES FIJAS (no se agregan ni borran; están todas siempre),
// iconos SVG (no emojis), confirmación via `opts.confirm` (dialog de la app, no window.confirm),
// autosave (`opts.onSave`) y export (`opts.onExport`). Pintar/paste-plano/export = fieles al repo.

import Sortable from "sortablejs";

const ASSET_BASE = "https://ketchum-mailchimp.vercel.app/";

// Iconos (lucide) inline como SVG para no depender de React dentro del DOM imperativo.
const ICON = {
  grip: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  plus: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
  copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  brush: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3Z"/><path d="M9 8c-2 3-4 3.5-7 4l8 10c2-1 6-5 6-7"/><path d="M14.5 17.5 4.5 15"/></svg>',
  eraser: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>',
  clipboard: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/><path d="m9 14 2 2 4-4"/></svg>',
  undo: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>',
  redo: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13"/></svg>',
  sparkles: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.9 2.6 8.6 6.1 5.1 7.4l3.5 1.3 1.3 3.5 1.3-3.5 3.5-1.3-3.5-1.3z"/><path d="M18 6h.01M6 18h.01M19 14l-1 2.5L15.5 18l2.5 1 1 2.5 1-2.5 2.5-1-2.5-1z"/></svg>',
  refresh: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>',
};

const THEMES = {
  booking: {
    banner: "https://mcusercontent.com/36c5c572bba94d0ff7ebdd653/images/e7a879c8-e852-70d1-a5d2-1bf020e2b6ef.jpg",
    bannerAlt: "Ketchum Clipping+ - Booking.com",
    colorHeader: "#0000FF", colorLink: "#0000FF", colorText: "#222222", pageBg: "#F5F8FB",
    sections: ["Exclusiva", "Competencia", "Turismo"],
    sectionImages: {
      "Exclusiva": "https://mcusercontent.com/36c5c572bba94d0ff7ebdd653/images/cd751c34-c6e6-263c-f1ea-2d8183a2063a.jpg",
      "Competencia": "https://mcusercontent.com/36c5c572bba94d0ff7ebdd653/images/467dd0af-9fa8-2ba8-70aa-e59e2dbde4d1.jpg",
      "Turismo": "images/portadas/booking-turismo.jpg"
    },
    tierSection: "Exclusiva", footerName: "KETCHUM ARGENTINA", footerMail: "contacto@ketchum.com.ar",
    hlColor: "#D32F2F", autoTerm: "Booking"
  },
  bms: {
    banner: "https://mcusercontent.com/36c5c572bba94d0ff7ebdd653/images/cef6a241-f54a-cc30-f31f-8ea528843471.jpg",
    bannerAlt: "Ketchum Clipping+ - Bristol Myers Squibb",
    bmsLogo: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Bristol_Myers_Squibb_logo.svg/320px-Bristol_Myers_Squibb_logo.svg.png",
    colorHeader: "#D81B7C", colorLink: "#1A4FB5", colorText: "#1F1F1F", pageBg: "#FFFFFF",
    sections: ["Notas Exclusivas", "Noticias del Sector", "Propiedad Intelectual", "Competencia", "Áreas Terapéuticas", "Onco Hematología", "CAR-T", "Cardiología", "Artritis", "Psoriasis", "Trasplantes"],
    sectionImages: {
      "Notas Exclusivas": "images/portadas/bms-notas-exclusivas.jpg",
      "Noticias del Sector": "images/portadas/bms-noticias-del-sector.jpg",
      "Áreas Terapéuticas": "images/portadas/bms-areas-terapeuticas.jpg",
      "Competencia": "images/portadas/bms-competencia.jpg",
      "Propiedad Intelectual": "images/portadas/bms-propiedad-intelectual.jpg",
      "Onco Hematología": "images/portadas/bms-onco-hematologia.jpg",
      "Cardiología": "images/portadas/bms-cardiologia.jpg",
      "Psoriasis": "images/portadas/bms-psoriasis.jpg",
      "Artritis": "images/portadas/bms-artritis.jpg",
      "CAR-T": "images/portadas/bms-cart.jpg",
      "Trasplantes": "images/portadas/bms-trasplantes.jpg"
    },
    tierSection: "Notas Exclusivas", footerName: "Ketchum Argentina", footerMail: "contacto@ketchum.com.ar",
    hlColor: "#D81B7C", autoTerm: ""
  },
  msd: {
    banner: "https://ketchum-mailchimp.vercel.app/images/portadas/msd-banner.jpg",
    bannerAlt: "Ketchum Clipping - MSD Salud Animal",
    colorHeader: "#008080", colorLink: "#007C89", colorText: "#202020", pageBg: "#FFFFFF",
    sections: ["Exclusivas", "Corporativas", "Salud", "Animales de Compañía", "Aves", "Cerdos", "Ganadería", "Innovación en Salud Animal"],
    sectionImages: {
      "Exclusivas": "https://ketchum-mailchimp.vercel.app/images/portadas/msd-exclusivas.jpg",
      "Corporativas": "https://ketchum-mailchimp.vercel.app/images/portadas/msd-corporativas.jpg",
      "Salud": "https://ketchum-mailchimp.vercel.app/images/portadas/msd-salud.jpg",
      "Animales de Compañía": "https://ketchum-mailchimp.vercel.app/images/portadas/msd-animales-de-compania.jpg",
      "Aves": "https://ketchum-mailchimp.vercel.app/images/portadas/msd-aves.jpg",
      "Cerdos": "https://ketchum-mailchimp.vercel.app/images/portadas/msd-cerdos.jpg",
      "Ganadería": "https://ketchum-mailchimp.vercel.app/images/portadas/msd-ganaderia.jpg",
      "Innovación en Salud Animal": "https://ketchum-mailchimp.vercel.app/images/portadas/msd-innovacion-salud-animal.jpg"
    },
    tierSection: "Exclusivas", footerName: "Ketchum Argentina", footerMail: "contacto@ketchum.com.ar",
    hlColor: "#C62828", autoTerm: "MSD"
  },
  mars: {
    banner: "https://ketchum-mailchimp.vercel.app/images/portadas/mars-banner.jpg",
    bannerAlt: "Ketchum Clipping+ - Mars",
    colorHeader: "#1B1B6F", colorLink: "#0000FF", colorText: "rgb(32,32,32)", pageBg: "#FFFFFF",
    sections: ["Exclusivas", "Corporativo", "Pet Nutrition", "Snacking", "Competencia", "Noticias de interés"],
    sectionImages: {
      "Exclusivas": "https://ketchum-mailchimp.vercel.app/images/portadas/mars-exclusivas.jpg",
      "Corporativo": "https://ketchum-mailchimp.vercel.app/images/portadas/mars-corporativo.jpg",
      "Pet Nutrition": "https://ketchum-mailchimp.vercel.app/images/portadas/mars-pet-nutrition.jpg",
      "Snacking": "https://ketchum-mailchimp.vercel.app/images/portadas/mars-snacking.jpg",
      "Competencia": "https://ketchum-mailchimp.vercel.app/images/portadas/mars-competencia.jpg",
      "Noticias de interés": "https://ketchum-mailchimp.vercel.app/images/portadas/mars-noticias-de-interes.jpg"
    },
    tierSection: "Exclusivas", footerName: "Ketchum Argentina", footerMail: "contacto@ketchum.com.ar",
    hlColor: "#8E24AA", autoTerm: "Mars"
  }
};

function slugToTheme(slug) {
  const s = String(slug || "").toLowerCase();
  if (s.includes("bms")) return "bms";
  if (s.includes("msd")) return "msd";
  if (s.includes("mars")) return "mars";
  return "booking";
}

// n8n escribe `seccion` en crudo (ej. "Sin grupo", "Industria y Competencia", "Indicaciones y
// Áreas Terapéuticas") que NO son los nombres canónicos con portada. Esto los mapea a la sección
// canónica del cliente (igual que hace el mail), así no aparecen secciones extra ni "Sin grupo".
function foldStr(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim(); }
const FALLBACK_SEC = { booking: "Turismo", bms: "Noticias del Sector", msd: "Salud", mars: "Noticias de interés" };
// Grupos internos de n8n que no matchean por texto con la sección visible.
const SEC_ALIAS = { bms: { "productos bms": "Notas Exclusivas", "regulatorio y gobierno": "Noticias del Sector", "sector y gestion": "Noticias del Sector" } };
// Ejes del Resumen IA por cliente (2º eje varía: MSD usa Corporativas, el resto Competencia).
const RESUMEN_LABELS = { booking: ["Exclusivas", "Competencia"], bms: ["Exclusivas", "Competencia"], msd: ["Exclusivas", "Corporativas"], mars: ["Exclusivas", "Competencia"] };
function canonSection(theme, raw) {
  const cans = (THEMES[theme] && THEMES[theme].sections) || [];
  const r = foldStr(raw);
  if (!r) return FALLBACK_SEC[theme] || cans[cans.length - 1] || "";
  if (SEC_ALIAS[theme] && SEC_ALIAS[theme][r]) return SEC_ALIAS[theme][r]; // alias grupo interno
  for (const c of cans) if (foldStr(c) === r) return c; // exacto
  const byLen = [...cans].sort((a, b) => foldStr(b).length - foldStr(a).length);
  for (const c of byLen) { const fc = foldStr(c); if (fc && (r.includes(fc) || fc.includes(r))) return c; } // contiene/contenido
  return FALLBACK_SEC[theme] || cans[cans.length - 1] || String(raw); // catch-all
}

// ============ MOUNT ============
export function mountEditor(root, opts) {
  const payload = opts.payload || {}; // { slug, nombre, clippingId, data }
  const onSave = opts.onSave || (() => {});
  const onExport = opts.onExport || (() => {});
  const onActivity = opts.onActivity || (() => {});
  // Registra una acción de edición (agrega/quita/reordena/pinta/despinta/regresa) para Estadísticas.
  const logAct = (accion) => { try { if (curClippingId) onActivity(curSlug, curClippingId, accion); } catch (e) {} };
  const confirmFn = opts.confirm || ((m) => Promise.resolve(window.confirm(m)));
  const resumenFn = opts.resumen || (() => Promise.resolve(null));
  let currentResumen = null; // {exclusivas, competencia} — solo booking/bms
  let state = { theme: "booking", fecha: "", sections: [] };
  const curSlug = payload.slug || "booking";
  const curClippingId = payload.clippingId || null;
  let uid = 1;
  const nid = () => "n" + (uid++);
  const toAbs = (u) => { u = String(u || ""); return /^https?:\/\//i.test(u) ? u : (ASSET_BASE + u.replace(/^\//, "")); };

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function escAttr(s) { return esc(s).replace(/"/g, "&quot;"); }

  // ---- normalize ----
  function normalize(data) {
    const theme = slugToTheme(data.cliente || data.theme);
    const T = THEMES[theme]; let sections = [];
    // editor_state guardado usa `sections`; un import externo podría usar `secciones`. Ambos = ya rich.
    const secList = (Array.isArray(data.secciones) && data.secciones.length)
      ? data.secciones
      : (Array.isArray(data.sections) && data.sections.length ? data.sections : null);
    const fromState = !!secList;
    if (secList) {
      // Canonicalizar también el estado guardado: si tiene "Sin grupo" u otra no-canónica, se remapea
      // y se fusiona con la sección canónica correspondiente (nada de secciones extra).
      const bucket = new Map();
      for (const s of secList) {
        const canon = canonSection(theme, s.titulo || "");
        if (!bucket.has(canon)) bucket.set(canon, []);
        bucket.get(canon).push(...(s.notas || []).map(toNota));
      }
      sections = [...bucket.entries()].map(([titulo, notas]) => ({ id: nid(), titulo, notas }));
    } else if (Array.isArray(data.articles)) {
      const map = new Map();
      for (const a of data.articles) { const sec = canonSection(theme, a.seccion || a.grupo || a.group || ""); if (!map.has(sec)) map.set(sec, []); map.get(sec).push(toNota(a)); }
      const seen = new Set();
      for (const name of T.sections) { if (map.has(name)) { sections.push({ id: nid(), titulo: name, notas: map.get(name) }); seen.add(name); } }
      for (const [name, notas] of map) { if (!seen.has(name)) sections.push({ id: nid(), titulo: name, notas }); }
    }
    if (!sections.length) sections = [{ id: nid(), titulo: T.sections[0], notas: [] }];
    sections = mergeCanonical(theme, sections);
    // Solo auto-pintar el término del cliente cuando viene de texto plano (articles), no de estado rich.
    if (!fromState) sections = prepRich(theme, sections);
    return { theme, fecha: data.fecha || "", sections };
  }
  function prepRich(theme, sections) {
    const T = THEMES[theme] || {}; const term = T.autoTerm || ""; const color = T.hlColor || "#D32F2F";
    for (const s of sections) { for (const n of (s.notas || [])) { n.titulo = paintTerm(esc(n.titulo || ""), term, color); n.snippet = paintTerm(esc(n.snippet || ""), term, color); } }
    return sections;
  }
  function paintTerm(html, term, color) {
    if (!term) return html;
    try { return String(html).replace(new RegExp("(" + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi"), '<span style="color:' + color + '">$1</span>'); }
    catch (e) { return html; }
  }
  function isDarkDefault(color) {
    const c = String(color || "").trim().toLowerCase();
    if (!c) return false;
    if (c === "black") return true;
    let r, g, b, m = c.match(/^#([0-9a-f]{3})$/); if (m) { r = parseInt(m[1][0] + m[1][0], 16); g = parseInt(m[1][1] + m[1][1], 16); b = parseInt(m[1][2] + m[1][2], 16); }
    if (r === undefined) { m = c.match(/^#([0-9a-f]{6})$/); if (m) { r = parseInt(m[1].slice(0, 2), 16); g = parseInt(m[1].slice(2, 4), 16); b = parseInt(m[1].slice(4, 6), 16); } }
    if (r === undefined) { m = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/); if (m) { r = +m[1]; g = +m[2]; b = +m[3]; } }
    if (r === undefined) return false;
    return (r < 90 && g < 90 && b < 90);
  }
  function cleanRich(node) {
    const tmp = document.createElement("div"); tmp.innerHTML = String(node || "");
    function walk(el) {
      let out = "";
      el.childNodes.forEach(c => {
        if (c.nodeType === 3) { out += esc(c.nodeValue); }
        else if (c.nodeType === 1) {
          const tag = c.tagName.toLowerCase();
          if (tag === "br") { out += "<br>"; return; }
          const inner = walk(c);
          let color = "";
          try { if (c.style && c.style.color) color = c.style.color; } catch (e) {}
          if (!color && tag === "font" && c.getAttribute("color")) color = c.getAttribute("color");
          if (color && isDarkDefault(color)) color = "";
          out += color ? ('<span style="color:' + color + '">' + inner + '</span>') : inner;
        }
      });
      return out;
    }
    return walk(tmp).replace(/\s+/g, " ").trim();
  }
  function mergeCanonical(theme, sections) {
    const order = (THEMES[theme] && THEMES[theme].sections) || [];
    const byTitle = new Map(sections.map(s => [String(s.titulo || "").trim().toLowerCase(), s]));
    const orderSet = new Set(order.map(o => o.toLowerCase()));
    const out = [];
    for (const name of order) { const k = name.toLowerCase(); out.push(byTitle.has(k) ? byTitle.get(k) : { id: nid(), titulo: name, notas: [] }); }
    for (const s of sections) { const k = String(s.titulo || "").trim().toLowerCase(); if (!orderSet.has(k)) out.push(s); }
    return out;
  }
  function toNota(a) { return { id: nid(), medio: a.medio || a.fuente || a.nombre_medio_origen || "", online: (a.online !== undefined && a.online !== null) ? a.online : "(Online)", fecha: a.fecha || a.pubDate || "", tier: a.tier || "", titulo: a.titulo || a.title || "", url: a.url || a.url_canonica || "", snippet: a.snippet || a.contentSnippet || "", esGacetilla: !!a.esGacetilla }; }

  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => root.querySelectorAll(sel);

  // ---- render ----
  function applyTheme() {
    const T = THEMES[state.theme]; root.dataset.theme = state.theme;
    const r = root.style;
    r.setProperty("--color-header", T.colorHeader); r.setProperty("--color-link", T.colorLink);
    r.setProperty("--color-text", T.colorText); r.setProperty("--page-bg", T.pageBg);
    r.setProperty("--hl", T.hlColor || "#D32F2F");
    const b = $(".kx-banner"); b.src = T.banner; b.alt = T.bannerAlt;
    // Footer igual al del HTML: redes (X / Facebook / Web) + dirección.
    $(".kx-footer").innerHTML =
      '<div style="background:#f7f8f9;padding:8px 20px 0 20px">'
      + '<div style="text-align:center;padding:28px 0 20px 0">'
      + '<a href="http://www.twitter.com/KetchumArg" target="_blank" style="margin:0 13px;display:inline-block"><img src="' + toAbs('images/social/color-twitter-48.png') + '" alt="X" width="28" height="28" style="border:0;vertical-align:middle"></a>'
      + '<a href="https://www.facebook.com/KetchumARG" target="_blank" style="margin:0 13px;display:inline-block"><img src="' + toAbs('images/social/color-facebook-48.png') + '" alt="Facebook" width="28" height="28" style="border:0;vertical-align:middle"></a>'
      + '<a href="https://www.ketchum.com/" target="_blank" style="margin:0 13px;display:inline-block"><img src="' + toAbs('images/social/color-link-48.png') + '" alt="Web" width="28" height="28" style="border:0;vertical-align:middle"></a>'
      + '</div>'
      + '<div style="padding:20px 0 28px 0;border-top:1px solid #e6e6e6;font-size:13px;color:#656565;line-height:1.7;text-align:center">This email was sent to <span style="text-decoration:underline">fedra.cacciamano@ketchum.com.ar</span><br>Ketchum &middot; 11 de septiembre de 1888 N&deg;2173 3C - Buenos Aires, Ciudad de Buenos Aires CP 1428 &middot; Argentina</div>'
      + '</div>';
  }
  function render() {
    applyTheme();
    $(".kx-datebar").textContent = state.fecha;
    const cont = $(".kx-sections"); cont.innerHTML = "";
    for (const s of state.sections) cont.appendChild(renderSection(s));
    $$(".f-medio,.f-fecha,.f-tier,.f-online").forEach(autoSize);
    initSortables();
    renderResumen();
  }
  const tieneResumen = () => currentResumen && (String(currentResumen.exclusivas || "").trim() || String(currentResumen.competencia || "").trim());
  // Muestra la caja "Síntesis del día" (editable) en el canvas, solo booking/bms con resumen.
  function renderResumen() {
    const slot = $(".kx-resumen-slot"); if (!slot) return;
    if (!RESUMEN_LABELS[curSlug] || !tieneResumen()) { slot.innerHTML = ""; return; }
    const T = THEMES[state.theme];
    const L = RESUMEN_LABELS[curSlug];
    slot.innerHTML =
      '<div class="kx-resumen-box" style="border-left:4px solid ' + T.colorHeader + '">'
      + '<div class="kx-resumen-head" style="color:' + T.colorHeader + '"><span>✨ Síntesis del día · Resumen IA</span>'
      + '<button class="kx-resumen-regen" title="Regenerar con IA">' + ICON.refresh + '</button></div>'
      + '<div class="kx-resumen-label">' + esc(L[0]) + '</div><div class="kx-resumen-ex" contenteditable="true" data-ph="(sin ' + esc(L[0].toLowerCase()) + ')">' + esc(String(currentResumen.exclusivas || "")) + '</div>'
      + '<div class="kx-resumen-label">' + esc(L[1]) + '</div><div class="kx-resumen-co" contenteditable="true" data-ph="(sin ' + esc(L[1].toLowerCase()) + ')">' + esc(String(currentResumen.competencia || "")) + '</div>'
      + '</div>';
  }
  function syncResumen() {
    const ex = $(".kx-resumen-ex"), co = $(".kx-resumen-co");
    if (ex && co) currentResumen = { exclusivas: ex.textContent.trim(), competencia: co.textContent.trim() };
  }
  async function genResumen() {
    if (!RESUMEN_LABELS[curSlug]) return;
    const btn = $(".kx-resumen"); if (btn) btn.disabled = true;
    setStatus("Generando resumen IA…");
    syncFromDOM();
    let r = null;
    try { r = await resumenFn(curSlug, clone(state.sections)); } catch (e) { r = null; }
    if (btn) btn.disabled = false;
    if (r && (String(r.exclusivas || "").trim() || String(r.competencia || "").trim())) {
      currentResumen = r; renderResumen(); scheduleSave(); setStatus("Resumen listo ✓");
    } else {
      setStatus("No hay notas en " + RESUMEN_LABELS[curSlug][0] + "/" + RESUMEN_LABELS[curSlug][1] + " para resumir");
    }
  }
  // Header de sección FIJO (portada o barra). No editable, no borrable.
  function renderSection(s) {
    const T = THEMES[state.theme];
    const showTier = !!(T.tierSection && s.titulo.trim().toLowerCase() === T.tierSection.toLowerCase());
    const el = document.createElement("div"); el.className = "kx-section"; el.dataset.id = s.id;
    const img = (T.sectionImages || {})[s.titulo];
    const head = document.createElement("div"); head.className = "kx-section-head";
    if (img) {
      head.innerHTML = '<img class="kx-sec-cover" alt="' + escAttr(s.titulo) + '" src="' + escAttr(toAbs(img)) + '">';
    } else {
      head.innerHTML = '<div class="kx-section-title">' + esc(s.titulo) + '</div>';
    }
    el.appendChild(head);
    const notes = document.createElement("div"); notes.className = "kx-notes";
    for (const n of s.notas) notes.appendChild(renderNote(n, showTier));
    el.appendChild(notes);
    const addRow = document.createElement("div"); addRow.className = "kx-add-note-row";
    addRow.innerHTML = '<button class="btn-addnote2">' + ICON.plus + ' Agregar nota</button>';
    el.appendChild(addRow);
    return el;
  }
  function renderNote(n, showTier) {
    const el = document.createElement("div"); el.className = "kx-note"; el.dataset.id = n.id; el.dataset.gacetilla = n.esGacetilla ? "1" : "";
    const tierField = showTier ? '<input class="fld f-tier" placeholder="Tier">' : '';
    el.innerHTML =
      '<span class="kx-grip note-handle" title="Arrastrar para reordenar">' + ICON.grip + '</span>'
      + '<div class="kx-note-body">'
      + '<div class="kx-headline">'
      + '<input class="fld f-medio" placeholder="Medio"><input class="fld f-online" title="Editá el (Online) — ej. (Gráfica), (Papel)… o vacialo si no va">'
      + '<input class="fld f-fecha" placeholder="Fecha">'
      + tierField
      + '<span class="kx-sep">-</span>'
      + '<div class="fld f-titulo rich" contenteditable="true" data-ph="Título de la nota"></div>'
      + '</div>'
      + '<div class="fld f-snippet rich" contenteditable="true" data-ph="Snippet / resumen…"></div>'
      + '<div class="kx-urlrow">🔗 <input class="f-url" placeholder="https://…"></div>'
      + '</div>'
      + '<div class="kx-note-actions">'
      + '<button class="kx-icon-btn btn-dupnote" title="Duplicar">' + ICON.copy + '</button>'
      + '<button class="kx-icon-btn btn-delnote" title="Eliminar">' + ICON.trash + '</button>'
      + '</div>';
    el.querySelector(".f-medio").value = n.medio || "";
    el.querySelector(".f-online").value = (n.online !== undefined && n.online !== null) ? n.online : "(Online)";
    el.querySelector(".f-fecha").value = n.fecha || "";
    if (showTier) el.querySelector(".f-tier").value = n.tier || "";
    el.querySelector(".f-titulo").innerHTML = n.titulo || "";
    el.querySelector(".f-snippet").innerHTML = n.snippet || "";
    el.querySelector(".f-url").value = n.url || "";
    return el;
  }
  function autoSize(inp) { inp.style.width = Math.max(4, (inp.value.length || inp.placeholder.length) + 1) + "ch"; }

  function syncFromDOM() {
    const secs = [];
    $$(".kx-section").forEach(secEl => {
      const s = { id: secEl.dataset.id, titulo: (secEl.dataset.titulo || currentTitulo(secEl)), notas: [] };
      secEl.querySelectorAll(".kx-notes .kx-note").forEach(nEl => {
        const tierEl = nEl.querySelector(".f-tier");
        s.notas.push({
          id: nEl.dataset.id,
          medio: nEl.querySelector(".f-medio").value.trim(),
          online: (function () { const e = nEl.querySelector(".f-online"); return e ? e.value.trim() : "(Online)"; })(),
          fecha: nEl.querySelector(".f-fecha").value.trim(),
          tier: tierEl ? tierEl.value.trim() : "",
          titulo: cleanRich(nEl.querySelector(".f-titulo").innerHTML),
          url: nEl.querySelector(".f-url").value.trim(),
          snippet: cleanRich(nEl.querySelector(".f-snippet").innerHTML),
          esGacetilla: nEl.dataset.gacetilla === "1"
        });
      });
      secs.push(s);
    });
    state.sections = secs;
  }
  // El título de sección es fijo: lo tomamos del state por id (no del DOM editable).
  function currentTitulo(secEl) {
    const cur = state.sections.find(x => x.id === secEl.dataset.id);
    return cur ? cur.titulo : "Sección";
  }

  // ---- Deshacer / Rehacer (estructural: agregar/duplicar/eliminar/pintar/mover) ----
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const HISTORY_MAX = 25;
  let undoStack = [], redoStack = [];
  // Edición de TEXTO: snapshot al entrar al campo (focusin) y commit al primer cambio (1 paso por campo).
  let pendingPre = null, committedBurst = false, inPaint = false;
  function commitUndoSnapshot(snap) { undoStack.push(snap); if (undoStack.length > HISTORY_MAX) undoStack.shift(); redoStack = []; updateUndoUI(); }
  // Snapshot del estado ACTUAL (pre-mutación) para poder volver.
  function pushHistory() { syncFromDOM(); undoStack.push(clone(state.sections)); if (undoStack.length > HISTORY_MAX) undoStack.shift(); redoStack = []; updateUndoUI(); }
  function undo() {
    if (!undoStack.length) return;
    syncFromDOM(); redoStack.push(clone(state.sections));
    state.sections = undoStack.pop(); render(); scheduleSave(); updateUndoUI(); setStatus("Deshecho"); logAct("regresa");
  }
  function redo() {
    if (!redoStack.length) return;
    syncFromDOM(); undoStack.push(clone(state.sections));
    state.sections = redoStack.pop(); render(); scheduleSave(); updateUndoUI(); setStatus("Rehecho");
  }
  function updateUndoUI() {
    const bar = $(".kx-undo"); if (!bar) return;
    bar.style.display = (undoStack.length || redoStack.length) ? "flex" : "none";
    const u = bar.querySelector('[data-act="undo"]'), r = bar.querySelector('[data-act="redo"]');
    if (u) u.disabled = !undoStack.length;
    if (r) r.disabled = !redoStack.length;
  }

  // ---- drag & drop de NOTAS con SortableJS (animación fluida, mover dentro y entre secciones) ----
  // Secciones fijas: solo se arrastran NOTAS. group compartido = cross-section. handle = el grip.
  let sortables = [];
  let dragPrev = null;
  function initSortables() {
    sortables.forEach(s => { try { s.destroy(); } catch (e) {} });
    sortables = [];
    $$(".kx-notes").forEach(cont => {
      sortables.push(Sortable.create(cont, {
        group: "kx-notes",
        handle: ".note-handle",
        draggable: ".kx-note",
        animation: 180,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        ghostClass: "kx-ghost",
        chosenClass: "kx-chosen",
        dragClass: "kx-drag",
        forceFallback: true, // clon propio (no el ghost nativo feo) → animación consistente
        fallbackOnBody: true,
        fallbackTolerance: 4,
        onStart: () => { syncFromDOM(); dragPrev = clone(state.sections); },
        onEnd: (evt) => {
          const changed = evt.oldIndex !== evt.newIndex || evt.from !== evt.to;
          if (changed && dragPrev) { undoStack.push(dragPrev); if (undoStack.length > HISTORY_MAX) undoStack.shift(); redoStack = []; updateUndoUI(); }
          dragPrev = null;
          syncFromDOM(); scheduleSave(); if (changed) logAct("reordena");
        },
      }));
    });
  }

  // ---- acciones (sin agregar/borrar sección: fijas) ----
  function addNote(secEl) { pushHistory(); const s = state.sections.find(x => x.id === secEl.dataset.id); if (s) s.notas.push({ id: nid(), medio: "", online: "(Online)", fecha: "", tier: "", titulo: "", url: "", snippet: "" }); render(); scheduleSave(); logAct("agrega"); }
  function dupNote(nEl) { pushHistory(); for (const s of state.sections) { const i = s.notas.findIndex(n => n.id === nEl.dataset.id); if (i >= 0) { s.notas.splice(i + 1, 0, Object.assign({}, s.notas[i], { id: nid() })); break; } } render(); scheduleSave(); logAct("agrega"); }
  async function delNote(nEl) {
    const ok = await confirmFn("¿Eliminar esta noticia? Podés deshacerlo con la flecha ↶.");
    if (!ok) return;
    pushHistory(); for (const s of state.sections) s.notas = s.notas.filter(n => n.id !== nEl.dataset.id); render(); scheduleSave(); logAct("quita");
  }

  // ---- export ---- (unificado: booking/msd/mars comparten layout; bms es especial)
  function exportHTML(resumen) {
    syncFromDOM();
    const T = THEMES[state.theme]; const W = 720, FONT = "Arial, Helvetica, sans-serif";
    // Caja "Síntesis del día" (Resumen IA) — igual que el mail. Solo booking/bms la reciben.
    const resumenHtml = (function () {
      if (!resumen) return "";
      const L = RESUMEN_LABELS[state.theme] || ["Exclusivas", "Competencia"];
      const secs = [];
      if (String(resumen.exclusivas || "").trim()) secs.push([L[0], String(resumen.exclusivas).trim()]);
      if (String(resumen.competencia || "").trim()) secs.push([L[1], String(resumen.competencia).trim()]);
      if (!secs.length) return "";
      return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px 0"><tr><td style="background:#EEF2FB;border-left:4px solid ' + T.colorHeader + ';padding:18px 22px;border-radius:4px"><p style="margin:0 0 12px 0;font-family:' + FONT + ';font-size:12px;font-weight:bold;color:' + T.colorHeader + ';letter-spacing:.5px;text-transform:uppercase">Síntesis del día</p>'
        + secs.map(function (s) { return '<p style="margin:0 0 4px 0;font-family:' + FONT + ';font-size:13px;font-weight:bold;color:' + T.colorHeader + '">' + s[0] + '</p><p style="margin:0 0 12px 0;font-family:' + FONT + ';font-size:14px;line-height:1.55;color:' + T.colorText + '">' + esc(s[1]) + '</p>'; }).join("")
        + '</td></tr></table>';
    })();
    const banner = state.theme === "bms"
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0"><tr><td style="text-align:center"><img src="${T.banner}" alt="${escAttr(T.bannerAlt)}" width="${W}" style="display:block;width:100%;max-width:${W}px;height:auto;border:0"></td></tr></table>`
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td style="padding:0"><img src="${T.banner}" alt="${escAttr(T.bannerAlt)}" width="${W}" style="display:block;width:100%;max-width:${W}px;height:auto;border:0"></td></tr><tr><td style="background:${T.colorHeader};padding:10px 28px" align="right"><span style="font-family:${FONT};font-size:11px;color:#ffffff;letter-spacing:2px;text-transform:uppercase">${esc(state.fecha.toUpperCase())}</span></td></tr></table>`;
    function noteHTML(n, showTier) {
      const on = (n.online !== undefined && n.online !== null) ? n.online : "(Online)";
      const partes = [`<strong style="color:${T.colorLink};font-weight:bold">${esc(n.medio || "Sin medio")}${on ? (' ' + esc(on)) : ''}</strong>`];
      if (n.fecha) partes.push(`<span style="color:${T.colorLink};font-weight:bold">${esc(n.fecha)}</span>`);
      if (showTier && n.tier) partes.push(`<span style="color:${T.colorLink};font-weight:bold">${esc(n.tier)}</span>`);
      const title = `<a href="${escAttr(n.url)}" style="color:${T.colorLink};text-decoration:underline;font-weight:bold">${n.titulo || ""}</a>`;
      const snip = n.snippet ? `<div style="font-family:${FONT};font-size:${state.theme === "bms" ? "14" : "12"}px;color:${T.colorText};margin-top:8px;line-height:1.6">${n.snippet}</div>` : "";
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" mc:repeatable="nota" mc:variant="Nota" style="border-collapse:collapse"><tr><td mc:edit="nota" style="padding:16px 0;border-bottom:1px solid #e0e6ec"><div style="font-family:${FONT};font-size:14px;color:${T.colorLink};font-weight:bold;line-height:1.45">${partes.join(" ")} - ${title}</div>${snip}</td></tr></table>`;
    }
    function sectionHTML(s) {
      const showTier = (s.titulo.trim().toLowerCase() === T.tierSection.toLowerCase());
      const notes = s.notas.filter(n => (n.titulo || "").trim()).map(n => noteHTML(n, showTier)).join("\n");
      const emptyHTML = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td style="padding:16px 0;font-family:${FONT};font-size:${state.theme === "bms" ? "14" : "13"}px;color:#8a98a5;font-style:italic">No se produjeron menciones</td></tr></table>`;
      const body = notes || emptyHTML;
      if (state.theme === "bms") {
        const bmsImg = (T.sectionImages || {})[s.titulo];
        if (bmsImg) { return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:28px 0 0 0"><tr><td style="padding:0"><img src="${escAttr(toAbs(bmsImg))}" alt="${escAttr(s.titulo)}" width="${W}" style="display:block;width:100%;max-width:${W}px;height:auto;border:0"></td></tr></table>${body}`; }
        const logo = showTier ? `<img src="${T.bmsLogo}" alt="Bristol Myers Squibb" height="28" style="float:right;display:inline-block;margin-top:8px">` : "";
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:36px 0 14px 0"><tr><td>${logo}<h2 style="margin:0;font-family:${FONT};font-size:24px;font-weight:bold;color:${T.colorHeader};letter-spacing:-.3px">${esc(s.titulo)}</h2></td></tr></table>${body}`;
      }
      const secImg = (T.sectionImages || {})[s.titulo];
      const bar = secImg
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:24px"><tr><td style="padding:0"><img src="${escAttr(toAbs(secImg))}" alt="${escAttr(s.titulo)}" width="${W}" style="display:block;width:100%;max-width:${W}px;height:auto;border:0"></td></tr></table>`
        : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:24px"><tr><td style="background:${T.colorHeader};padding:14px 22px"><span style="font-family:${FONT};font-size:15px;font-weight:bold;color:#ffffff;letter-spacing:2px;text-transform:uppercase">${esc(s.titulo.toUpperCase())}</span></td></tr></table>`;
      return `${bar}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:#ffffff;border:1px solid #e0e6ec;border-top:none"><tr><td style="padding:0 22px">${body}</td></tr></table>`;
    }
    const body = state.sections.map(sectionHTML).join("\n");
    const emptyMsg = `<p style="text-align:center;font-family:${FONT};color:#5A5A5A;padding:40px 0">Sin artículos.</p>`;
    const footer = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:36px 0 0 0;background:#f7f8f9"><tr><td style="padding:30px 24px 22px 24px;text-align:center;border-top:1px solid #e6e6e6"><a href="http://www.twitter.com/KetchumArg" style="display:inline-block;margin:0 13px;text-decoration:none"><img src="${toAbs('images/social/color-twitter-48.png')}" alt="X" width="28" height="28" style="display:inline-block;border:0;width:28px;height:28px"></a><a href="https://www.facebook.com/KetchumARG" style="display:inline-block;margin:0 13px;text-decoration:none"><img src="${toAbs('images/social/color-facebook-48.png')}" alt="Facebook" width="28" height="28" style="display:inline-block;border:0;width:28px;height:28px"></a><a href="https://www.ketchum.com/" style="display:inline-block;margin:0 13px;text-decoration:none"><img src="${toAbs('images/social/color-link-48.png')}" alt="Web" width="28" height="28" style="display:inline-block;border:0;width:28px;height:28px"></a></td></tr><tr><td style="padding:22px 24px 30px 24px;text-align:center;font-family:${FONT};font-size:13px;line-height:1.7;color:#656565;border-top:1px solid #e6e6e6">This email was sent to <a href="mailto:fedra.cacciamano@ketchum.com.ar" style="color:#656565;text-decoration:underline">fedra.cacciamano@ketchum.com.ar</a><br>Ketchum &middot; 11 de septiembre de 1888 N&deg;2173 3C - Buenos Aires, Ciudad de Buenos Aires CP 1428 &middot; Argentina</td></tr></table>`;
    if (state.theme === "bms") {
      return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#FFFFFF;font-family:${FONT}"><table role="presentation" align="left" width="${W}" cellpadding="0" cellspacing="0" border="0" style="max-width:${W}px;width:100%;margin:0;background:#FFFFFF"><tr><td style="padding:0 30px 30px 30px">${banner}\n${resumenHtml}${body || emptyMsg}\n${footer}</td></tr></table></body></html>`;
    }
    return `<html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:${T.pageBg};font-family:${FONT}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:${T.pageBg}"><tr><td align="left" style="padding:32px 0"><table role="presentation" width="${W}" cellpadding="0" cellspacing="0" border="0" style="width:${W}px;margin:0;border-collapse:collapse"><tr><td>${banner}</td></tr>\n${resumenHtml ? `<tr><td>${resumenHtml}</td></tr>\n` : ""}<tr><td>${body || emptyMsg}</td></tr>\n<tr><td>${footer}</td></tr></table></td></tr></table></body></html>`;
  }

  // ---- status / save ----
  let statusTimer = null;
  function setStatus(t) { const s = $(".kx-status"); if (!s) return; s.textContent = t; if (t) { clearTimeout(statusTimer); statusTimer = setTimeout(() => { if (s.textContent === t) s.textContent = ""; }, 4000); } }
  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      if (!curClippingId) return;
      try {
        syncFromDOM(); syncResumen();
        setStatus("Guardando…");
        const res = await onSave(curSlug, curClippingId, { theme: state.theme, fecha: state.fecha, sections: state.sections, resumen: currentResumen });
        if (res && res.ok === false) setStatus("⚠ No se pudo guardar");
        else setStatus("Guardado ✓");
      } catch (e) { setStatus("⚠ No se pudo guardar"); }
    }, 800);
  }

  // ---- build skeleton ----
  root.className = "kx-editor";
  root.innerHTML =
    '<div class="kx-toolbar">'
    + '<span class="kx-fecha kx-datebar-lbl"></span>'
    + '<span class="kx-grow"></span>'
    + '<span class="kx-status"></span>'
    + '<button class="kx-act kx-paint" title="Pintar lo seleccionado">' + ICON.brush + ' Pintar</button>'
    + '<button class="kx-act kx-unpaint" title="Quitar el pintado">' + ICON.eraser + ' Despintar</button>'
    + (RESUMEN_LABELS[curSlug] ? '<button class="kx-act kx-resumen" title="Generar la Síntesis del día con IA">' + ICON.sparkles + ' Resumen IA</button>' : "")
    + (RESUMEN_LABELS[curSlug] ? '<button class="kx-act kx-export-plain" title="Copiar el clipping SIN el resumen IA">' + ICON.clipboard + ' Copiar sin resumen</button>' : "")
    + '<button class="kx-act kx-primary kx-export" title="Copiar el clipping CON el resumen IA">' + ICON.clipboard + (RESUMEN_LABELS[curSlug] ? ' Copiar con resumen' : ' Copiar para Mail') + '</button>'
    + '</div>'
    + '<div class="kx-undo" style="display:none">'
    + '<button data-act="undo" title="Deshacer">' + ICON.undo + '</button>'
    + '<button data-act="redo" title="Rehacer">' + ICON.redo + '</button>'
    + '</div>'
    + '<div class="kx-canvas"><div class="kx-clip">'
    + '<img class="kx-banner" alt="Ketchum Clipping+">'
    + '<div class="kx-datebar"></div>'
    + '<div class="kx-resumen-slot"></div>'
    + '<div class="kx-sections"></div>'
    + '<div class="kx-footer"></div>'
    + '</div></div>';

  // ---- wire ----
  const onClick = ev => {
    const t = ev.target;
    if (t.closest('[data-act="undo"]')) return undo();
    if (t.closest('[data-act="redo"]')) return redo();
    if (t.closest(".kx-resumen") || t.closest(".kx-resumen-regen")) return genResumen();
    if (t.closest(".btn-addnote2")) addNote(t.closest(".kx-section"));
    else if (t.closest(".btn-dupnote")) dupNote(t.closest(".kx-note"));
    else if (t.closest(".btn-delnote")) delNote(t.closest(".kx-note"));
  };
  const isEditableField = (t) => t && t.closest && (t.closest(".fld") || t.classList.contains("rich") || t.classList.contains("f-url"));
  // Al entrar a un campo: snapshot del estado actual (pre-edición) para poder deshacer el texto.
  const onFocusIn = ev => {
    if (!isEditableField(ev.target)) return;
    syncFromDOM(); pendingPre = clone(state.sections); committedBurst = false;
  };
  const onInput = ev => {
    const t = ev.target;
    if (t.closest && t.closest(".kx-resumen-box")) { syncResumen(); scheduleSave(); return; }
    if (t.classList.contains("f-medio") || t.classList.contains("f-fecha") || t.classList.contains("f-tier") || t.classList.contains("f-online")) autoSize(t);
    if (isEditableField(t)) {
      // Commit del snapshot pre-edición una vez por ráfaga (no en cada tecla). Saltea si es pintado.
      if (!inPaint && !committedBurst && pendingPre) { commitUndoSnapshot(pendingPre); committedBurst = true; }
      scheduleSave();
    }
  };
  const onPaste = e => {
    const r = e.target.closest && e.target.closest(".rich");
    if (!r) return;
    e.preventDefault();
    const text = ((e.clipboardData || window.clipboardData).getData("text/plain") || "").replace(/\r/g, "");
    document.execCommand("insertText", false, text);
  };
  function applyPaint(on) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { setStatus("Seleccioná texto en un título o snippet"); return; }
    const a = sel.anchorNode; const hostEl = (a && a.nodeType === 1 ? a : (a && a.parentElement)) ? (a.nodeType === 1 ? a : a.parentElement).closest(".rich") : null;
    if (!hostEl) { setStatus("Seleccioná dentro del título o snippet"); return; }
    inPaint = true; // el execCommand dispara 'input'; evita doble entrada de historial
    pushHistory();
    try { document.execCommand("styleWithCSS", false, true); } catch (e) {}
    if (on) { document.execCommand("foreColor", false, (THEMES[state.theme].hlColor || "#D32F2F")); setStatus("Pintado ✓"); }
    else { document.execCommand("removeFormat", false, null); setStatus("Despintado ✓"); }
    inPaint = false;
    scheduleSave(); logAct(on ? "pinta" : "despinta");
  }
  const paintBtn = $(".kx-paint"), unpaintBtn = $(".kx-unpaint");
  const onPaintMd = e => e.preventDefault();
  paintBtn.addEventListener("mousedown", onPaintMd);
  unpaintBtn.addEventListener("mousedown", onPaintMd);
  const onPaint = () => applyPaint(true);
  const onUnpaint = () => applyPaint(false);
  paintBtn.addEventListener("click", onPaint);
  unpaintBtn.addEventListener("click", onUnpaint);
  const exportBtn = $(".kx-export");
  const exportPlainBtn = $(".kx-export-plain");
  // withResumen=true → copia CON resumen (lo genera si hace falta); false → SIN resumen.
  const onExportClick = (withResumen) => async () => {
    let builtHtml = "", builtResumen = null, buildPromise = null;
    const build = () => buildPromise || (buildPromise = (async () => {
      syncFromDOM(); syncResumen();
      if (withResumen && RESUMEN_LABELS[curSlug]) {
        if (tieneResumen()) { builtResumen = currentResumen; }
        else {
          setStatus("Generando resumen IA…");
          try { builtResumen = await resumenFn(curSlug, clone(state.sections)); } catch (e) { builtResumen = null; }
          if (builtResumen && (String(builtResumen.exclusivas || "").trim() || String(builtResumen.competencia || "").trim())) { currentResumen = builtResumen; renderResumen(); }
        }
      }
      builtHtml = exportHTML(withResumen ? builtResumen : null);
      return builtHtml;
    })());
    const blob = async (type) => new Blob([await build()], { type });
    let okCopy = false;
    try {
      // ClipboardItem con Promise: mantiene el gesto aunque el resumen IA tarde (Chrome).
      await navigator.clipboard.write([new ClipboardItem({ "text/html": blob("text/html"), "text/plain": blob("text/plain") })]);
      okCopy = true;
    } catch (e) {
      try {
        if (!builtHtml) await build();
        const tmp = document.createElement("div"); tmp.innerHTML = builtHtml;
        tmp.setAttribute("style", "position:fixed;left:-99999px;top:0;white-space:normal");
        document.body.appendChild(tmp);
        const range = document.createRange(); range.selectNodeContents(tmp);
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
        okCopy = document.execCommand("copy");
        sel.removeAllRanges(); document.body.removeChild(tmp);
      } catch (e2) {}
    }
    if (!builtHtml) { try { await build(); } catch (e) {} }
    setStatus(okCopy ? "Copiado ✓ — pegalo en el mail con Ctrl+V" : "No pude copiar — probá de nuevo");
    try { if (curClippingId) onExport(curSlug, curClippingId, builtHtml, { theme: state.theme, fecha: state.fecha, sections: state.sections }, builtResumen); } catch (e) {}
  };
  exportBtn.addEventListener("click", onExportClick(true));
  if (exportPlainBtn) exportPlainBtn.addEventListener("click", onExportClick(false));

  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("paste", onPaste);

  // ---- go ----
  state = normalize(payload.data || { cliente: curSlug, fecha: "", articles: [] });
  currentResumen = (payload.data && payload.data.resumen && typeof payload.data.resumen === "object") ? payload.data.resumen : null;
  render();
  $(".kx-datebar-lbl").textContent = state.fecha;

  return function unmount() {
    clearTimeout(saveTimer); clearTimeout(statusTimer);
    sortables.forEach(s => { try { s.destroy(); } catch (e) {} });
    sortables = [];
    root.removeEventListener("click", onClick);
    root.removeEventListener("input", onInput);
    root.removeEventListener("focusin", onFocusIn);
    root.removeEventListener("paste", onPaste);
    root.innerHTML = "";
  };
}
