/* eslint-disable */
// @ts-nocheck
// Render EXACTO — copia de Build HTML Email (n8n). NO reescribir.
export function renderBms({ articles: __articles, tier: __tier = {}, resumen: __resumenObj = {} }) {
  const __input = { articles: Array.isArray(__articles) ? __articles : [] };
function renderNoticia(){ var n=arguments[0]; var h=__rn.apply(null,arguments); if(typeof h==="string"&&h.trim()){ h=h.replace(/^(\s*<(?:div|table|a|p)\b)/i,"$1 data-note-id=\""+((n&&n.id!=null)?String(n.id):"")+"\""); } return h; }

// HTML idéntico al productivo BMS (template del cliente)
// Adaptado a los campos de v2: snippet, grupo, etiqueta
const out = __input || {};
let articles = Array.isArray(out.articles) ? out.articles : [];
// Si no hay articles, NO interrumpir: enviar mail con mensaje de error
const NO_NOTAS_FLAG = articles.length === 0;

const WIDTH = 720;
const COLOR_SECTION   = '#D81B7C';
const COLOR_LINK      = '#1A4FB5';
const COLOR_TEXT      = '#1F1F1F';
const COLOR_TEXT_DIM  = '#5A5A5A';
const COLOR_BG        = '#FFFFFF';
const COLOR_BADGE_BG  = '#FCE4EC';
const COLOR_BADGE_TXT = '#AD1457';
const FONT_STACK      = 'Arial, Helvetica, sans-serif';
const FONT_HEADING    = 'Arial, Helvetica, sans-serif';

const IMAGE_URL = 'https://mcusercontent.com/36c5c572bba94d0ff7ebdd653/images/cef6a241-f54a-cc30-f31f-8ea528843471.jpg';
const BMS_LOGO_URL = 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Bristol_Myers_Squibb_logo.svg/320px-Bristol_Myers_Squibb_logo.svg.png';

const JURS_CANON = ['Gacetillas','Productos BMS','Industria y Competencia','Indicaciones y Áreas Terapéuticas','Regulatorio y Gobierno','Sector y Gestión','Propiedad Intelectual','Onco Hematología','Cardiología','Artritis','Psoriasis','Trasplantes'];

// FIX P1: Whitelist de dominios primarios elegibles para 'Notas Exclusivas'.
// Si una nota matcheo grupo='Productos BMS' pero su dominio NO esta aca, se demote a Sector.
const EXCLUSIVAS_WHITELIST = new Set([
  'lanacion.com.ar','clarin.com','infobae.com','cronista.com','elpais.com.ar','perfil.com','pagina12.com.ar','ambito.com','tn.com.ar','iprofesional.com',
  'pharmabaires.com','pharmabaires.com.ar','pharmabiz.com.ar','consensosalud.com.ar','elmedicointeractivo.com','mdz.com.ar','docsalud.com',
  'reuters.com','bloomberg.com','wsj.com','ft.com','statnews.com','fiercepharma.com','endpts.com'
]);

// FIX P0: lookup dominio -> nombre legible desde sheet 'Medios Adicionales'.
const __mediosLookup = new Map();
try {
  for (const __row of ([])) {
    const __d = String(__row.json?.dominio || '').toLowerCase().replace(/^www\./,'');
    const __n = String(__row.json?.nombre || '').trim();
    if (__d && __n && !/^\d+$/.test(__n)) __mediosLookup.set(__d, __n);
  }
} catch(e) {}
console.log('[BuildHTMLEmail] medios_lookup_size=' + __mediosLookup.size + ' exclusivas_whitelist_size=' + EXCLUSIVAS_WHITELIST.size);

const SECTION_LABEL = {
  'Gacetillas': 'Gacetillas BMS',
  'Productos BMS': 'Notas Exclusivas',
  'Industria y Competencia': 'Competencia',
  'Propiedad Intelectual': 'Propiedad Intelectual',
  'Indicaciones y Áreas Terapéuticas': 'Noticias del Sector',
  'Regulatorio y Gobierno': 'Noticias del Sector',
  'Sector y Gestión': 'Noticias del Sector',
  'Onco Hematología': 'Onco Hematología',
  'Cardiología': 'Cardiología',
  'Artritis': 'Artritis',
  'Psoriasis': 'Psoriasis',
  'Trasplantes': 'Trasplantes',
};

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,' ').toUpperCase().trim();

const MAP = {};
for (const j of JURS_CANON) MAP[norm(j)] = j;
MAP['PRODUCTOS BMS'] = 'Productos BMS';
MAP['BMS'] = 'Productos BMS';
MAP['BRISTOL MYERS SQUIBB'] = 'Productos BMS';
MAP['EXCLUSIVAS BMS'] = 'Productos BMS';
MAP['NOTAS EXCLUSIVAS'] = 'Productos BMS'; MAP['EXCLUSIVAS'] = 'Productos BMS';
MAP['INDUSTRIA Y COMPETENCIA'] = 'Industria y Competencia';
MAP['INDUSTRIA'] = 'Industria y Competencia';
MAP['COMPETENCIA'] = 'Industria y Competencia';
MAP['PROPIEDAD INTELECTUAL'] = 'Propiedad Intelectual';
MAP['PATENTES'] = 'Propiedad Intelectual';
MAP['INDICACIONES Y AREAS TERAPEUTICAS'] = 'Indicaciones y Áreas Terapéuticas';
MAP['INDICACIONES'] = 'Indicaciones y Áreas Terapéuticas';
MAP['REGULATORIO Y GOBIERNO'] = 'Regulatorio y Gobierno';
MAP['REGULATORIO'] = 'Regulatorio y Gobierno';
MAP['SECTOR Y GESTION'] = 'Sector y Gestión';
MAP['SECTOR'] = 'Sector y Gestión';
MAP['ONCOLOGIA'] = 'Onco Hematología';
MAP['CARDIOLOGIA'] = 'Cardiología';
MAP['ARTRITIS'] = 'Artritis';
MAP['PSORIASIS'] = 'Psoriasis';
MAP['TRASPLANTES'] = 'Trasplantes';
MAP['TRASPLANTE'] = 'Trasplantes';
MAP['GACETILLAS'] = 'Gacetillas';
MAP['GACETILLA'] = 'Gacetillas';
MAP['GACETILLAS BMS'] = 'Gacetillas';

const cleanStr = (s) => (typeof s === 'string' ? s.trim() : '');
const esValido = (n) => n && typeof n === 'object' && cleanStr(n.title).length > 0 && cleanStr(n.url).length > 0;

const formatHeaderDate = () => {
  const d = new Date();
  const dias = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const day = String(d.getDate()).padStart(2,'0');
  return { dia: dias[d.getDay()], fecha: `${day} de ${meses[d.getMonth()]} ${d.getFullYear()}` };
};

const __MESf = {enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,septiembre:9,setiembre:9,octubre:10,noviembre:11,diciembre:12};
const __pfFmt = (raw) => {
  const s = String(raw||'').trim();
  if (!s) return '';
  let y, mo, d, m;
  if ((m = s.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/))) { y=+m[1]; mo=+m[2]; d=+m[3]; }
  else if ((m = s.match(/\b([0-3]?\d)[.\/-]([01]?\d)[.\/-](20\d{2})\b/))) { d=+m[1]; mo=+m[2]; y=+m[3]; }
  else if ((m = s.match(/\b([0-3]?\d)\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de)?\s+(20\d{2})\b/i))) { d=+m[1]; mo=__MESf[m[2].toLowerCase()]; y=+m[3]; }
  else if ((m = s.match(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+([0-3]?\d),?\s+(20\d{2})\b/i))) { mo=__MESf[m[1].toLowerCase()]; d=+m[2]; y=+m[3]; }
  else { const dt0 = new Date(s); if (isNaN(dt0.getTime())) return ''; y=dt0.getFullYear(); mo=dt0.getMonth()+1; d=dt0.getDate(); }
  if (!(mo>=1 && mo<=12 && d>=1 && d<=31 && y>=2024 && y<=2027)) return '';
  const dt = new Date(y, mo-1, d);
  if (isNaN(dt.getTime())) return '';
  const now = Date.now();
  if (dt.getTime() > now + 86400000) return '';
  if (now - dt.getTime() > 63072000000) return '';
  return String(d).padStart(2,'0')+'/'+String(mo).padStart(2,'0')+'/'+y;
};
const formatNoticiaDate = (raw) => { try { return __pfFmt(raw); } catch { return ''; } };

const escapeHtml = (s) => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

const decodeAndClean = (s) => String(s||'').replace(/<[^>]+>/g,'').replace(/&quot;/gi,'"').replace(/&apos;/gi,"'").replace(/&#39;/gi,"'").replace(/&#34;/gi,'"').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();

const truncateSnippet = (s, max=500) => {
  if (!s) return '';
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const ls = cut.lastIndexOf(' ');
  return (ls > 0 ? cut.slice(0, ls) : cut) + '…';
};

// [2026-06-12 AD VALUE] lookup dinámico desde la planilla de Fedra (nodo 'Build Tier Lookup')
function __tierNorm(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\b(online|web|com|ar|digital|diario|portal|noticias|el|la|los|las)\b/g,' ').replace(/ +/g,' ').trim(); }
const __TIER_DYN = (function(){ try { const o=({ lookup: __tier }); return (o && o.lookup) ? o.lookup : {}; } catch(e){ return {}; } })();
function __adValueFor(medio){ const e=__TIER_DYN[__tierNorm(medio)]; return (e && e.ad_value) ? e.ad_value : null; }
function __fmtAdValue(n){ return '$'+String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,'.')+'-'; }
const __rn = (n, __seccion) => {
  if (!esValido(n)) return '';
  // Fecha defensiva: si URL es Google News redirect Y la URL real no tiene fecha en slug,
// no confiar en pubDate (Google News marca con fecha de re-indexación, no original).
// Evita mostrar "17/05/2026" en notas viejas re-feedeadas (ej. Papa Francisco 2021).
const fecha = (function() {
  if (!n.pubDate) { try { const __m = String(n.url||'').match(/(20\d{2})\/(\d{1,2})\/(\d{1,2})/); if (__m) { const __y=+__m[1], __mo=+__m[2], __d=+__m[3]; if (__mo>=1&&__mo<=12&&__d>=1&&__d<=31) { const __dt=new Date(__y,__mo-1,__d), __now=Date.now(); if (!isNaN(__dt.getTime()) && __dt.getTime()<=__now+86400000 && (__now-__dt.getTime())<63072000000) return String(__d).padStart(2,'0')+'/'+String(__mo).padStart(2,'0')+'/'+__y; } } } catch(e){} try { const __sf = formatNoticiaDate(String(n.snippet||'').slice(0,40)); if (__sf) return __sf; } catch(e){} return ''; }
  let realUrl = String(n.url || '');
  try {
    const u = new URL(realUrl);
    if (u.hostname.includes('google.com')) {
      const inner = u.searchParams.get('url') || u.searchParams.get('q');
      if (inner) { try { realUrl = decodeURIComponent(inner); } catch { realUrl = inner; } }
      else if (u.hostname.includes('news.google.com')) {
        const m = u.pathname.match(/\/(?:rss\/)?articles\/([A-Za-z0-9_\-]+)/);
        if (m) { try { const b64 = m[1].replace(/-/g,'+').replace(/_/g,'/'); const padded = b64 + '='.repeat((4-b64.length%4)%4); const decoded = Buffer.from(padded,'base64').toString('binary'); const um = decoded.match(/https?:\/\/[^\s\x00-\x1f\\"<>]+/); if (um) realUrl = um[0]; } catch {} }
      }
    }
  } catch {}
  const hasDateInSlug = /\/(20\d{2})\/\d{1,2}\//.test(realUrl) || /[\/\-](20\d{6})[\/\-]/.test(realUrl);
  if (hasDateInSlug) return formatNoticiaDate(n.pubDate);
  // URL sin fecha + pubDate sospechosamente reciente (últimas 48h) → ocultar fecha
  try {
    const pub = new Date(n.pubDate);
    if (false) return ''; // [FIX] desactivado: esta rama ocultaba la fecha de casi todas las notas recientes cuya URL no trae slug de fecha (pharmabiz, dib, anmat, etc.). formatNoticiaDate ya valida futuras/viejas.
  } catch {}
  return formatNoticiaDate(n.pubDate);
})();
  const medioRaw = cleanStr(n.medio);
  let dominio = '';
  function decodeGoogleUrl(rawUrl) {
    if (!rawUrl) return rawUrl;
    try {
      const u = new URL(rawUrl);
      if (u.hostname.includes('google.com')) {
        const inner = u.searchParams.get('url') || u.searchParams.get('q');
        if (inner) { try { new URL(inner); return inner; } catch (e) {} }
        const cb = decodeGoogleNewsCBMi(rawUrl);
        if (cb) return cb;
      }
    } catch (e) {}
    return rawUrl;
  }
  function decodeGoogleNewsCBMi(url) {
    try {
      const m = String(url||'').match(/news\.google\.com\/(?:rss\/)?articles\/([A-Za-z0-9_\-]+)/);
      if (!m) return null;
      const b64 = m[1].replace(/-/g,'+').replace(/_/g,'/');
      const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
      const decoded = Buffer.from(padded,'base64').toString('binary');
      const um = decoded.match(/https?:\/\/[^\s\x00-\x1f\\\"<>]+/);
      return um ? um[0] : null;
    } catch(e) { return null; }
  }
  try {
    const urlObj = new URL(n.url);
    if (urlObj.hostname.includes('google.com')) {
      const inner = urlObj.searchParams.get('url') || urlObj.searchParams.get('q');
      if (inner) {
        try { dominio = new URL(inner).hostname.toLowerCase().replace(/^www\./,''); } catch {}
      }
      if (!dominio || dominio.includes('google.com')) {
        const decoded = decodeGoogleNewsCBMi(n.url);
        if (decoded) {
          try { dominio = new URL(decoded).hostname.toLowerCase().replace(/^www\./,''); } catch {}
        }
      }
    }
    if (!dominio) dominio = urlObj.hostname.toLowerCase().replace(/^www\./,'');
  } catch {}
  if (dominio === 'google.com' || dominio === 'news.google.com' || dominio.endsWith('.google.com')) dominio = '';

  if (!dominio) {
    const dCampo = cleanStr(n.dominio).toLowerCase().replace(/^www\./,'');
    if (dCampo && !dCampo.includes('google.com')) dominio = dCampo;
  }

  const medioRawLow = (medioRaw||'').toLowerCase();
  const isBadMarker = !medioRaw || medioRaw === 'sin_dominio' || medioRaw === 'unknown' || medioRaw === 'desconocido' || medioRaw === 'Medio' || medioRaw === 'Fuente' || medioRawLow.includes('google.com') || medioRawLow === 'google news' || medioRawLow === 'news.google.com';
  const medioFinal = isBadMarker ? '' : medioRaw;
  const dominioDetectado = cleanStr(n.dominio_detectado).toLowerCase().replace(/^www\./,'');
  const dominioReal = (dominioDetectado && !dominioDetectado.includes('google.com')) ? dominioDetectado : dominio;
  const dominioRealClean = (dominioReal && !dominioReal.includes('google.com')) ? dominioReal : '';
  const dominioCap = dominioRealClean ? (dominioRealClean.split('.')[0].charAt(0).toUpperCase() + dominioRealClean.split('.')[0].slice(1)) : '';
  const dCampoFallback = String(n.dominio||'').toLowerCase().replace(/^www\./,'').replace(/^https?:\/\//,'').split('/')[0];
  const dCampoClean = (dCampoFallback && !dCampoFallback.includes('google.com')) ? dCampoFallback : '';
  const dCampoCap = dCampoClean ? (dCampoClean.split('.')[0].charAt(0).toUpperCase() + dCampoClean.split('.')[0].slice(1)) : '';
  const __lookedUpName = (dominioReal && __mediosLookup.get(dominioReal)) || (dCampoClean && __mediosLookup.get(dCampoClean)) || null;
// FIX P0: si n.medio parece un dominio crudo (tiene .com/.ar/.org/.gov sin espacios), preferir lookup/dominioCap.
// Esto arregla casos como 'fmfleming887.com.ar' que upstream setea como medio pero deberia mostrar 'FM Fleming 88.7' (si esta en sheet) o 'Fmfleming887' (capitalizado).
const __medioLooksLikeDomain = /^[a-z0-9.-]+\.(com|ar|org|gov|net|info|tv|edu|gob|blog|world|travel|lat|la|mx)\b/i.test(String(medioFinal||'').trim()) && !/\s/.test(String(medioFinal||''));
// FIX: fallback robusto via IIFE (evita issues de scope con function declarations en strict mode de n8n Code node).
const __safeDomain = (function(rawUrl){
  try {
    let u = new URL(String(rawUrl||''));
    if (u.hostname && u.hostname.indexOf('google.com') >= 0) {
      const inner = u.searchParams.get('url') || u.searchParams.get('q');
      if (inner) { try { u = new URL(inner); } catch(e){} }
    }
    return (u.hostname || '').toLowerCase().replace(/^www\./, '');
  } catch(e) { return ''; }
})(n.url);
const __safeDomainFirstSeg = __safeDomain ? __safeDomain.split('.')[0] : '';
const __safeDomainCap = __safeDomainFirstSeg ? __safeDomainFirstSeg.charAt(0).toUpperCase() + __safeDomainFirstSeg.slice(1) : '';
const __safeLookup = __safeDomain && __mediosLookup.get(__safeDomain);
// FIX FINAL: extraccion de medio via REGEX-ONLY (sin new URL que falla silenciosamente en n8n sandbox).
// Esta funcion garantiza extraer SIEMPRE algo legible del URL.
function __extractMedioFromUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let url = rawUrl.trim();
  // Si es Google redirect, extraer URL interna via regex (sin new URL)
  if (/^https?:\/\/[^\/]*google\.com\//i.test(url)) {
    const m = url.match(/[?&](?:url|q)=([^&]+)/);
    if (m) {
      try {
        const decoded = decodeURIComponent(m[1]);
        if (/^https?:\/\//i.test(decoded)) url = decoded;
      } catch(e) {}
    }
  }
  // Extraer host: quitar protocolo, partir en /, ?, #
  let host = url.replace(/^https?:\/\//i, '').split('/')[0].split('?')[0].split('#')[0];
  host = host.replace(/^www\./i, '').toLowerCase().trim();
  if (!host || host.indexOf('google.com') >= 0) return '';
  return host;
}
const __urlHost = __extractMedioFromUrl(n.url);
const __urlHostLookup = __urlHost && __mediosLookup.get(__urlHost);
const __urlHostSeg = __urlHost ? __urlHost.split('.')[0] : '';
const __urlHostCap = __urlHostSeg ? __urlHostSeg.charAt(0).toUpperCase() + __urlHostSeg.slice(1) : '';
// Cascade simplificado: medio limpio del upstream > lookup-by-url > capitalizacion-de-url > 'Fuente'
const __medioFinalIsClean = medioFinal && !__medioLooksLikeDomain;
const medio = (__medioFinalIsClean ? medioFinal : null) || __urlHostLookup || __lookedUpName || __urlHostCap || 'Fuente';
if (!__medioFinalIsClean && medio === 'Fuente') {
  console.log('[BHE FUENTE FALLBACK] n.url=' + JSON.stringify(String(n.url||'').substring(0,120)) + ' n.medio=' + JSON.stringify(medioFinal) + ' urlHost=' + JSON.stringify(__urlHost));
}
  const titulo = escapeHtml(decodeAndClean(cleanStr(n.title)));
  const snippetRaw = cleanStr(n.snippet);
  const esMonitoreado = cleanStr(n.etiqueta).toUpperCase() === 'SITIO MONITOREADO' || cleanStr(n.categoria).toLowerCase() === 'scraping';
  const esGacetilla = cleanStr(n.etiqueta).toUpperCase() === 'GACETILLA BMS' || cleanStr(n.categoria).toLowerCase() === 'gacetilla';
  const badgeGacetilla = false
    ? `<span style="display:inline-block;background:#FFD700;color:#7A5C00;font-family:${FONT_HEADING};font-size:11px;font-weight:bold;letter-spacing:.4px;padding:2px 8px;border-radius:3px;margin-right:8px;text-transform:uppercase">🔔 Gacetilla</span>`
    : '';
  const badgeMonitoreado = (esMonitoreado && !esGacetilla)
    ? ''
    : '';

  const partes = [];
  partes.push(`<strong style="color:${COLOR_LINK};font-weight:bold">${escapeHtml(medio)} (Online)</strong>`);
  if (fecha) partes.push(`<span style="color:${COLOR_LINK};font-weight:bold">${fecha}</span>`);
  if (__seccion === 'Notas Exclusivas') { const __av = __adValueFor(medio) || __adValueFor(cleanStr(n.medio||'')); if (__av) partes.push(`<span style="color:${COLOR_LINK};font-weight:bold">Ad Value: ${__fmtAdValue(__av)}</span>`); }
  const headerLine = partes.join(' ');
  const snippet = escapeHtml(truncateSnippet(decodeAndClean(snippetRaw), 500));

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0">
      <tr>
        <td>
          <p style="margin:0 0 8px 0;font-family:${FONT_HEADING};font-size:15px;line-height:1.4">
            ${badgeGacetilla}${badgeMonitoreado}${headerLine} <span style="color:${COLOR_TEXT_DIM}"> - </span> <a href="${escapeHtml(decodeGoogleUrl(n.url))}" target="_blank" rel="noopener" style="color:${COLOR_LINK};text-decoration:underline;font-weight:bold">${titulo}</a>
          </p>
          ${snippet ? `<p style="margin:0 0 0 0;font-family:${FONT_STACK};font-size:14px;line-height:1.6;color:${COLOR_TEXT}">${snippet}</p>` : ''}
        </td>
      </tr>
    </table>`;
};

const grupos = new Map();
for (const n of articles) {
  if (!esValido(n)) continue;
  const __esGace = String(n.etiqueta||'').toUpperCase()==='GACETILLA BMS' || String(n.categoria||'').toLowerCase()==='gacetilla'; const __mblob=(String(n.title||'')+' '+String(n.snippet||'')).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase(); const __ctxM=/(laborator|farmac|medicament|oncolog|nivolumab|opdivo|opdualag|yervoy|sotyktu|reblozyl|sprycel|orencia|camzyos|breyanzi|squibb|sanofi|bayer|abbott|abbot|pfizer|roche|\bmsd\b|biosimilar|vacuna|inmunoterapia)/; const __esMarca=/\bbristol[\s-]?myers\b/.test(__mblob)||((/\bbristol\b/.test(__mblob)||/\bbms\b/.test(__mblob))&&__ctxM.test(__mblob)); const __esPatente=/(tratado de patentes|ley de patentes|\bpct\b|patentes? de medicament|patentes? farmac|propiedad intelectual farmac|\bpatentes\b|\bpatente\b)/.test(__mblob) && /(laborator|farmac|medicament|caeme|cilfa|anmat|biosimilar|generic|squibb|especialidades medicin)/.test(__mblob); let canon = __esGace ? 'Productos BMS' : (__esMarca ? 'Productos BMS' : (__esPatente ? 'Propiedad Intelectual' : (MAP[norm(n.grupo)] || 'Sector y Gestión')));
  // FIX P1: Demote a Sector si grupo='Productos BMS' pero dominio no whitelisted.
  if (false /* [2026-06-12] demote desactivado: alineado con el editor, que no demota */ && canon === 'Productos BMS' && !__esGace && !__esMarca) {
    const __dom = String(n.dominio_detectado || n.dominio || '').toLowerCase().replace(/^www\./,'');
    if (!EXCLUSIVAS_WHITELIST.has(__dom)) {
      console.log('[BuildHTMLEmail] Demoting Productos BMS->Sector (domain not whitelisted): ' + __dom + ' | ' + String(n.title||'').substring(0,80));
      canon = 'Sector y Gestión';
    }
  }
  const label = SECTION_LABEL[canon] || canon;
  if (!grupos.has(label)) grupos.set(label, []);
  grupos.get(label).push(n);
}

const SECTION_ORDER = ['Notas Exclusivas','Noticias del Sector','Propiedad Intelectual','Competencia','Áreas Terapéuticas','Onco Hematología','CAR-T','Cardiología','Psoriasis','Artritis','Trasplantes'];

const SECTION_IMAGES = {"Notas Exclusivas":"https://ketchum-mailchimp.vercel.app/images/portadas/bms-notas-exclusivas.jpg","Noticias del Sector":"https://ketchum-mailchimp.vercel.app/images/portadas/bms-noticias-del-sector.jpg","Áreas Terapéuticas":"https://ketchum-mailchimp.vercel.app/images/portadas/bms-areas-terapeuticas.jpg","Competencia":"https://ketchum-mailchimp.vercel.app/images/portadas/bms-competencia.jpg","Propiedad Intelectual":"https://ketchum-mailchimp.vercel.app/images/portadas/bms-propiedad-intelectual.jpg","Onco Hematología":"https://ketchum-mailchimp.vercel.app/images/portadas/bms-onco-hematologia.jpg","Cardiología":"https://ketchum-mailchimp.vercel.app/images/portadas/bms-cardiologia.jpg","Psoriasis":"https://ketchum-mailchimp.vercel.app/images/portadas/bms-psoriasis.jpg","Artritis":"https://ketchum-mailchimp.vercel.app/images/portadas/bms-artritis.jpg","CAR-T":"https://ketchum-mailchimp.vercel.app/images/portadas/bms-cart.jpg","Trasplantes":"https://ketchum-mailchimp.vercel.app/images/portadas/bms-trasplantes.jpg"};
const renderSection = (label, arts) => {
  const noticiasHtml = (arts && arts.length) ? arts.map((__n) => renderNoticia(__n, label)).join('') : '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td style="padding:14px 0;font-family:'+FONT_STACK+';font-size:14px;color:'+COLOR_TEXT_DIM+';font-style:italic">No se produjeron menciones</td></tr></table>';
  const logoBMS = label === 'Notas Exclusivas'
    ? `<img src="${BMS_LOGO_URL}" alt="Bristol Myers Squibb" height="28" style="float:right;display:inline-block;margin-top:8px">`
    : '';
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:36px 0 18px 0">
      <tr>
        <td>
          ${SECTION_IMAGES[label] ? `<img src="${SECTION_IMAGES[label]}" alt="${escapeHtml(label)}" width="720" style="display:block;width:100%;max-width:720px;height:auto;border:0">` : `${logoBMS}<h2 style="margin:0;font-family:${FONT_HEADING};font-size:24px;font-weight:bold;color:${COLOR_SECTION};letter-spacing:-.3px">${escapeHtml(label)}</h2>`}
        </td>
      </tr>
    </table>
    ${noticiasHtml}`;
};

const { dia, fecha: fechaHoy } = formatHeaderDate();
const headerHtml = `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0">
    <tr>
      <td style="text-align:center">
        <img src="${IMAGE_URL}" alt="Ketchum Clipping+ - Bristol Myers Squibb" width="${WIDTH}" style="display:block;width:100%;max-width:${WIDTH}px;height:auto;border:0">
      </td>
    </tr>
  </table>`;

const footerHtml = `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:40px 0 0 0;border-top:1px solid #E0E0E0">
    <tr><td style="padding:28px 0 0 0;text-align:center">
      <a href="http://www.twitter.com/KetchumArg" style="display:inline-block;margin:0 7px;text-decoration:none"><img src="https://ketchum-mailchimp.vercel.app/images/social/color-twitter-48.png" alt="X" width="36" height="36" style="display:inline-block;border:0;width:36px;height:36px"></a>
      <a href="https://www.facebook.com/KetchumARG" style="display:inline-block;margin:0 7px;text-decoration:none"><img src="https://ketchum-mailchimp.vercel.app/images/social/color-facebook-48.png" alt="Facebook" width="36" height="36" style="display:inline-block;border:0;width:36px;height:36px"></a>
      <a href="https://www.ketchum.com/" style="display:inline-block;margin:0 7px;text-decoration:none"><img src="https://ketchum-mailchimp.vercel.app/images/social/color-link-48.png" alt="Web" width="36" height="36" style="display:inline-block;border:0;width:36px;height:36px"></a>
    </td></tr>
    <tr><td style="padding:24px 0 0 0;text-align:center;font-family:${FONT_HEADING};font-size:12px;line-height:1.7;color:#9a9a9a">
      This email was sent to <a href="mailto:fedra.cacciamano@ketchum.com.ar" style="color:#9a9a9a;text-decoration:underline">fedra.cacciamano@ketchum.com.ar</a><br>
      
      Ketchum &middot; 11 de septiembre de 1888 N&deg;2173 3C - Buenos Aires, Ciudad de Buenos Aires CP 1428 &middot; Argentina
    </td></tr>
  </table>`;

let seccionesHtml = '';
for (const sec of SECTION_ORDER) {
  // 'Áreas Terapéuticas' es SEPARADOR: agrupa a las secciones terapeuticas que siguen.
  // No recibe notas propias -> se dibuja solo la portada, sin 'No se produjeron menciones'.
  if (sec === 'Áreas Terapéuticas') {
    const __atArr = grupos.has(sec) ? grupos.get(sec) : [];
    seccionesHtml += __atArr.length
      ? renderSection(sec, __atArr)
      : '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:36px 0 18px 0"><tr><td><img src="' + SECTION_IMAGES['Áreas Terapéuticas'] + '" alt="Áreas Terapéuticas" width="720" style="display:block;width:100%;max-width:720px;height:auto;border:0"></td></tr></table>';
    continue;
  }
  const __arr = grupos.has(sec) ? grupos.get(sec) : [];
  if (__arr.length > 0) seccionesHtml += renderSection(sec, __arr);
  else if (sec !== 'Gacetillas BMS') seccionesHtml += renderSection(sec, []);
}
for (const [sec, arr] of grupos) {
  if (!SECTION_ORDER.includes(sec) && arr.length > 0) seccionesHtml += renderSection(sec, arr);
}

const totalItems = [...grupos.values()].reduce((s, a) => s + a.length, 0);

// === Resumen IA (BMS) — síntesis por sección (Exclusivas / Competencia) ===
let resumen = '';
let __resObj = {};
__resObj = (__resumenObj && typeof __resumenObj==='object') ? __resumenObj : {};
resumen = ((__resObj.exclusivas||'') + ' ' + (__resObj.competencia||'')).trim();
const __secsR = [];
if (String(__resObj.exclusivas||'').trim()) __secsR.push(['Exclusivas', String(__resObj.exclusivas).trim()]);
if (String(__resObj.competencia||'').trim()) __secsR.push(['Competencia', String(__resObj.competencia).trim()]);
const __escR = function(t){ return String(t==null?'':t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
const resumenHtml = __secsR.length ? ('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px 0"><tr><td style="background:#FCE4EC;border-left:4px solid '+COLOR_SECTION+';padding:18px 22px;border-radius:4px"><p style="margin:0 0 12px 0;font-family:'+FONT_HEADING+';font-size:12px;font-weight:bold;color:'+COLOR_SECTION+';letter-spacing:.5px;text-transform:uppercase">Síntesis del día</p>' + __secsR.map(function(s){ return '<p style="margin:0 0 4px 0;font-family:'+FONT_HEADING+';font-size:13px;font-weight:bold;color:'+COLOR_SECTION+'">'+s[0]+'</p><p style="margin:0 0 12px 0;font-family:'+FONT_HEADING+';font-size:14px;line-height:1.55;color:'+COLOR_TEXT+'">'+__escR(s[1])+'</p>'; }).join('') + '</td></tr></table>') : '';

const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Clipping BMS</title></head>
<body style="margin:0;padding:0;background:${COLOR_BG};font-family:${FONT_HEADING}">
<table role="presentation" align="center" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0" style="max-width:${WIDTH}px;width:100%;margin:0 auto;background:${COLOR_BG}">
<tr><td style="padding:0 30px 30px 30px">
${headerHtml}
${resumenHtml}
${seccionesHtml || `<p style="text-align:center;font-family:${FONT_HEADING};color:${COLOR_TEXT_DIM};padding:40px 0">No hay artículos relevantes en esta corrida.</p>`}
${footerHtml}
</td></tr>
</table>
</body></html>`;

let finalHtml = html;
if (NO_NOTAS_FLAG) {
  finalHtml = `<!DOCTYPE html><html><body style="font-family:Arial;padding:30px;background:#fff">
    <h2 style="color:#D81B7C">Clipping BMS - ${dia}, ${fechaHoy}</h2>
    <div style="padding:20px;background:#FFF3E0;border-left:4px solid #FF9800;margin:20px 0">
      <h3 style="margin:0 0 10px 0;color:#E65100">⚠️ Sin artículos hoy</h3>
      <p>El clipping de hoy no tiene artículos. Posibles causas:</p>
      <ul>
        <li>AI Filter no aprobó ninguna nota (puede ser rate limit OpenAI 429)</li>
        <li>Fetch falló en múltiples fuentes</li>
        <li>Día con poca cobertura farma real</li>
      </ul>
      <p style="color:#5A5A5A;font-size:13px">Revisar logs del workflow en n8n para diagnosticar.</p>
    </div>
    <p style="color:#5A5A5A;font-size:12px;margin-top:30px">Ketchum Clipping+ - Bristol Myers Squibb</p>
  </body></html>`;
}
return finalHtml;

}
