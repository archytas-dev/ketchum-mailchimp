/* eslint-disable */
// @ts-nocheck
// Render EXACTO — copia de Build HTML Email (n8n). NO reescribir.
export function renderMsd({ articles: __articles, tier: __tier = {}, resumen: __resumenObj = {} }) {
  const __input = { articles: Array.isArray(__articles) ? __articles : [] };
function renderNoticia(n){ var h = __rn(n); if(typeof h==="string" && h.trim()){ h = h.replace(/^(\s*<(?:div|table|a|p)\b)/i, "$1 data-note-id=\""+((n&&n.id!=null)?String(n.id):"")+"\""); } return h; }

// Build HTML Email — MSD Salud Animal (Ketchum). Template plano estilo Mailchimp del cliente (teal).
const out = __input || {};
let articles = Array.isArray(out.articles) ? out.articles : [];
const NO_NOTAS_FLAG = articles.length === 0;
const CONTENT_WIDTH = "600";
const COLOR_TEAL = "#008080";
const COLOR_LINK = "rgb(0,124,137)";
const COLOR_TEXT = "rgb(32,32,32)";
const COLOR_BG = "#ffffff";
const FONT_STACK = "tahoma, verdana, segoe, sans-serif";
const BANNER_URL = "https://ketchum-mailchimp.vercel.app/images/portadas/msd-banner.jpg";
const BANNER_URL2 = "https://ketchum-mailchimp.vercel.app/images/portadas/msd-innovacion-salud-animal.jpg";

// Tabla de Tier/Alcance conocidos (best-effort). Los medios agro/veterinarios de MSD que no
// figuren acá simplemente no muestran el paréntesis de Alcance/Tier/Ad Value (no se inventan datos).
const MEDIOS_DATA = {
  "la nacion": {tier:"Tier 1",alcance:519000},
  "clarin": {tier:"Tier 1",alcance:354000},
  "infobae": {tier:"Tier 1",alcance:3860000},
  "tn": {tier:"Tier 1",alcance:169000},
  "ambito web": {tier:"Tier 1",alcance:768000},
  "cronista": {tier:"Tier 1",alcance:762000},
  "el cronista": {tier:"Tier 1",alcance:762000},
  "infocampo": {tier:"Tier 1",alcance:6000},
  "agritotal": {tier:"Tier 3",alcance:62372},
  "agro voz": {tier:"Tier 1",alcance:62096},
  "bichos de campo": {tier:"Tier 1",alcance:7500},
  "todo agro": {tier:"Tier 1",alcance:7500},
  "super campo": {tier:"Tier 1",alcance:124031},
  "3tres3": {tier:"Tier 1",alcance:6300}
};
const normMedio = (s) => (s||"").toString().normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/^https?:\/\//,"").replace(/^www\./,"").replace(/\s+/g," ").trim();
const stripTld = (s) => String(s||"").replace(/\.(com|ar|net|org|gov|gob|info|tv|edu|lat|la|mx|io|blog|world)\b.*$/i,"").replace(/\.[a-z]{2,3}$/i,"").trim();
function lookupMedio(medio){
  const raw = normMedio(medio);
  const base = stripTld(raw);
  let key = MEDIOS_DATA[raw] ? raw : (MEDIOS_DATA[base] ? base : null);
  if(!key && base){ for(const kk of Object.keys(MEDIOS_DATA)){ if(kk.length>=4 && base.length>=4 && (kk===base||stripTld(kk)===base||kk.includes(base)||base.includes(kk))){ key=kk; break; } } }
  if(!key) return { tier:null, alcance:null, nombre:null };
  const pretty = key.split(" ").map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(" ");
  return { tier:MEDIOS_DATA[key].tier, alcance:MEDIOS_DATA[key].alcance, nombre:pretty };
}
const JURS_CANON = ["Exclusivas","Corporativas","Salud","Animales de Compañía","Aves","Cerdos","Ganadería","Innovación en Salud Animal"];
const normG = (s) => (s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/\s+/g," ").toUpperCase().trim();
const MAP = {};
for (const j of JURS_CANON) MAP[normG(j)] = j;
MAP["EXCLUSIVA"]="Exclusivas"; MAP["MSD"]="Exclusivas"; MAP["MSD SALUD ANIMAL"]="Exclusivas";
MAP["CORPORATIVA"]="Corporativas"; MAP["COMPETENCIA"]="Corporativas"; MAP["MANAGEMENT"]="Corporativas";
MAP["MASCOTAS"]="Animales de Compañía"; MAP["ANIMALES DE COMPANIA"]="Animales de Compañía";
MAP["AVICULTURA"]="Aves";
MAP["PORCINOS"]="Cerdos"; MAP["PRODUCCION PORCINA"]="Cerdos";
MAP["GANADERIA"]="Ganadería"; MAP["BOVINOS"]="Ganadería";
MAP["GACETILLAS"]="Exclusivas"; MAP["GACETILLA"]="Exclusivas"; MAP["GACETILLA MSD"]="Exclusivas";
MAP["ONE HEALTH"]="Innovación en Salud Animal"; MAP["INNOVACION"]="Innovación en Salud Animal"; MAP["INNOVACION SALUD ANIMAL"]="Innovación en Salud Animal";
const esGacetilla = (n) => { const et=normG(n.etiqueta); return et==="GACETILLA MSD"||et==="GACETILLA"||(n.categoria||"").toString().toLowerCase()==="gacetilla"; };
const cleanStr = (s) => (typeof s === "string" ? s.trim() : "");
const decodeAndClean = (s) => String(s||"").replace(/\[\]\(\s*https?:\/\/[^\s)]+\s+"[^"]*"\s*\)/gi,"").replace(/\[([^\]]*)\]\(\s*https?:\/\/[^\s)]+\s+"[^"]*"\s*\)/gi,"$1").replace(/\[\]\((?:https?:\/\/)?[^\)]*\)/gi,"").replace(/\[([^\]]+)\]\((?:https?:\/\/)?[^\)]*\)/gi,"$1").replace(/<[^>]+>/g,"").replace(/&quot;/gi,'"').replace(/&apos;/gi,"'").replace(/&#39;/gi,"'").replace(/&#34;/gi,'"').replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&nbsp;/gi," ").replace(/&ldquo;/gi,"“").replace(/&rdquo;/gi,"”").replace(/&rsquo;/gi,"’").replace(/&hellip;/gi,"…").replace(/&mdash;/gi,"—").replace(/&ndash;/gi,"–").replace(/&amp;/gi,"&").replace(/&#?[a-z0-9]+;/gi,"").replace(/\s+/g," ").trim();
const esValido = (n) => n && typeof n === "object" && decodeAndClean(cleanStr(n.title)).length > 0 && cleanStr(n.url).length > 0;
const formatHeaderDate = () => { const d=new Date(); const dias=["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"]; const meses=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"]; const day=String(d.getDate()).padStart(2,"0"); return { dia:dias[d.getDay()], fecha:day+" de "+meses[d.getMonth()]+" "+d.getFullYear() }; };
const __MESf={enero:'01',febrero:'02',marzo:'03',abril:'04',mayo:'05',junio:'06',julio:'07',agosto:'08',septiembre:'09',setiembre:'09',octubre:'10',noviembre:'11',diciembre:'12'};
function __pfFmt(raw){const s=String(raw||'');let m;m=s.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);if(m)return m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');m=s.match(/\b([0-3]?\d)[.\/-]([0-3]?\d)[.\/-](20\d{2})\b/);if(m){let a=+m[1],b=+m[2];if(b>12&&a<=12)return m[3]+'-'+String(a).padStart(2,'0')+'-'+String(b).padStart(2,'0');return m[3]+'-'+String(b).padStart(2,'0')+'-'+String(a).padStart(2,'0');}m=s.match(/\b([0-3]?\d)\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de)?\s+(20\d{2})\b/i);if(m)return m[3]+'-'+__MESf[m[2].toLowerCase()]+'-'+m[1].padStart(2,'0');m=s.match(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+([0-3]?\d),?\s+(20\d{2})\b/i);if(m)return m[3]+'-'+__MESf[m[1].toLowerCase()]+'-'+m[2].padStart(2,'0');const d=new Date(s);if(!isNaN(d.getTime()))return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');return '';}
function __textDateES(raw){const s=String(raw||'');let m;m=s.match(/\b([0-3]?\d)\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de)?\s+(20\d{2})\b/i);if(m)return m[3]+'-'+__MESf[m[2].toLowerCase()]+'-'+m[1].padStart(2,'0');m=s.match(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+([0-3]?\d),?\s+(20\d{2})\b/i);if(m)return m[3]+'-'+__MESf[m[1].toLowerCase()]+'-'+m[2].padStart(2,'0');return '';}
const formatNoticiaDate = (raw) => { if(!raw) return ""; const iso=__pfFmt(String(raw)); if(!iso) return ""; const dt=new Date(iso+'T12:00:00'); const now=Date.now(); if(isNaN(dt.getTime())||dt.getTime()>now+86400000||(now-dt.getTime())>63072000000) return ""; const p=iso.split('-'); return p[2]+'/'+p[1]+'/'+p[0]; };
// Ad Value dinámico desde la planilla compartida de Fedra (nodo 'Build Tier Lookup')
function __tierNorm(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\b(online|web|com|ar|digital|diario|portal|noticias|el|la|los|las)\b/g,' ').replace(/ +/g,' ').trim(); }
const __TIER_DYN = (function(){ try { const o=({ lookup: __tier }); return (o && o.lookup) ? o.lookup : {}; } catch(e){ return {}; } })();
function __dynEntryFor(medio){ return __TIER_DYN[__tierNorm(medio)] || null; }
function __fmtAdValue(n){ return '$ '+String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,'.'); }
function __fmtAlcance(n){ return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,'.'); }
function esMencionMSD(n){ const body = String(n.title||'')+' '+String(n.snippet||n.contentSnippet||''); return /\bmsd\b|allflex|bravecto/i.test(body); }
const __rn = (n) => {
  if (!esValido(n)) return "";
  const title = decodeAndClean(cleanStr(n.title));
  const snippet = decodeAndClean(cleanStr(n.snippet || n.contentSnippet));
  let medio = cleanStr(n.medio) || "Sin medio";
  const __lk = lookupMedio(medio);
  const __pareceDominio = /^[a-z0-9.\-]+\.[a-z]{2,}$/i.test(medio) && !/\s/.test(medio);
  if (__pareceDominio) {
    if (__lk.nombre) { medio = __lk.nombre; }
    else { const __b = stripTld(normMedio(medio)).replace(/[-_]+/g," ").trim(); if (__b) medio = __b.split(" ").map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(" "); }
  }
  const url = cleanStr(n.url);
  const fecha = (function(){ const __body=(n.title||'')+' '+(n.snippet||n.contentSnippet||''); let o=formatNoticiaDate(n.pubDate||n.isoDate||n.date||n.fecha||''); if(o)return o; o=formatNoticiaDate(__textDateES(__body)); if(o)return o; o=formatNoticiaDate(String(n.snippet||'').slice(0,80)); if(o)return o; try{const m=String(n.url||'').match(/(20\d{2})\/(\d{1,2})\/(\d{1,2})/);if(m){const y=+m[1],mo=+m[2],d=+m[3];if(mo>=1&&mo<=12&&d>=1&&d<=31){const dt=new Date(y,mo-1,d),now=Date.now();if(!isNaN(dt.getTime())&&dt.getTime()<=now+86400000&&(now-dt.getTime())<63072000000)return String(d).padStart(2,'0')+'/'+String(mo).padStart(2,'0')+'/'+y;}}}catch(e){} return ''; })();
  const isGace = esGacetilla(n);
  if (isGace && (medio === "Sin medio" || !cleanStr(n.medio))) medio = "MSD Salud Animal";
  const __esMSD = esMencionMSD(n);
  const __dynEntry = __dynEntryFor(cleanStr(n.medio) || medio);
  const __av = (__dynEntry && __dynEntry.ad_value) || null;
  const __alcance = (__dynEntry && __dynEntry.alcance) || __lk.alcance;
  const __tier = (__dynEntry && __dynEntry.tier) ? String(__dynEntry.tier) : (__lk.tier||'').replace(/^Tier\s*/i,'');
  const mostrarMeta = __esMSD && __av && __alcance && __tier;
  const metaHtml = mostrarMeta
    ? ' (Alcance: '+__fmtAlcance(__alcance)+' Tier: '+__tier+')<strong> Ad. Value: '+__fmtAdValue(__av)+' - </strong>'
    : '<strong> - </strong>';
  const headLine = '<font color="'+COLOR_TEAL+'" face="'+FONT_STACK+'"><span style="font-size:14px"><strong>'+medio+' (Online) '+(fecha||'')+'</strong>'+metaHtml+'</span></font>';
  const titleHtml = '<a href="'+url+'" style="color:'+COLOR_LINK+';text-decoration:none" target="_blank"><span style="font-size:14px;font-family:'+FONT_STACK+'">'+title+'</span></a>';
  const snippetCorto = snippet.length > 800 ? snippet.slice(0,797).replace(/\s+\S*$/,"") + "..." : snippet;
  const snippetHtml = snippetCorto ? '<br><span style="font-size:12px;font-family:'+FONT_STACK+';color:'+COLOR_TEXT+'">'+snippetCorto+'</span>' : "";
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td style="word-break:break-word;color:'+COLOR_TEXT+';font-family:Helvetica;font-size:16px;line-height:24px;padding:9px 0;text-align:justify">'+headLine+' '+titleHtml+snippetHtml+'</td></tr></table>';
};
const SECTION_BANNERS = {
  "Exclusivas": "https://ketchum-mailchimp.vercel.app/images/portadas/msd-exclusivas.jpg",
  "Corporativas": "https://ketchum-mailchimp.vercel.app/images/portadas/msd-corporativas.jpg",
  "Salud": "https://ketchum-mailchimp.vercel.app/images/portadas/msd-salud.jpg",
  "Animales de Compañía": "https://ketchum-mailchimp.vercel.app/images/portadas/msd-animales-de-compania.jpg",
  "Aves": "https://ketchum-mailchimp.vercel.app/images/portadas/msd-aves.jpg",
  "Cerdos": "https://ketchum-mailchimp.vercel.app/images/portadas/msd-cerdos.jpg",
  "Ganadería": "https://ketchum-mailchimp.vercel.app/images/portadas/msd-ganaderia.jpg",
  "Innovación en Salud Animal": "https://ketchum-mailchimp.vercel.app/images/portadas/msd-innovacion-salud-animal.jpg"
};
const renderSeccionHeader = (titulo) => {
  const imgUrl = SECTION_BANNERS[titulo];
  if (imgUrl) return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:18px"><tr><td style="padding:0"><img src="'+imgUrl+'" alt="'+titulo+'" width="100%" style="display:block;width:100%;height:auto;border:0"></td></tr></table>';
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:18px"><tr><td style="background-color:'+COLOR_TEAL+';padding:10px 18px"><span style="font-family:'+FONT_STACK+';font-size:15px;font-weight:bold;color:#ffffff;text-transform:uppercase;letter-spacing:1px">'+titulo+'</span></td></tr></table>';
};
const renderSeccion = (titulo, ns) => {
  let reales = (ns||[]).map(renderNoticia).filter(Boolean).join("");
  if (!reales) reales = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td style="padding:9px 0"><font color="'+COLOR_TEAL+'" face="'+FONT_STACK+'"><span style="font-size:14px"><strong>No se produjeron menciones.</strong></span></font></td></tr></table>';
  return renderSeccionHeader(titulo) + reales;
};
const byTema = JURS_CANON.reduce((acc,j)=>(acc[j]=[],acc),{});
const sinTema = [];
for (const n of articles) { if(!esValido(n)) continue; const canon = esGacetilla(n) ? "Exclusivas" : (MAP[normG(n.grupo||n.group||n.jurisdiction)] || null); if (canon && byTema[canon]) byTema[canon].push(n); else sinTema.push(n); }
const dateInfo = formatHeaderDate();
const header = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td style="padding:0"><img src="'+BANNER_URL+'" alt="Ketchum Clipping - MSD Salud Animal" width="100%" style="display:block;width:100%;height:auto;border:0"></td></tr></table>';
const footer = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0 0;border-top:2px solid rgb(238,238,238)"><tr><td style="padding:20px 0 0 0;text-align:center"><a href="http://www.twitter.com/KetchumArg" style="display:inline-block;margin:0 6px;text-decoration:none"><img src="https://cdn-images.mailchimp.com/icons/social-block-v2/color-twitter-48.png" alt="X" width="24" height="24" style="display:inline-block;border:0;width:24px;height:24px"></a><a href="https://www.facebook.com/KetchumARG" style="display:inline-block;margin:0 6px;text-decoration:none"><img src="https://cdn-images.mailchimp.com/icons/social-block-v2/color-facebook-48.png" alt="Facebook" width="24" height="24" style="display:inline-block;border:0;width:24px;height:24px"></a><a href="https://www.ketchum.com/" style="display:inline-block;margin:0 6px;text-decoration:none"><img src="https://cdn-images.mailchimp.com/icons/social-block-v2/color-link-48.png" alt="Web" width="24" height="24" style="display:inline-block;border:0;width:24px;height:24px"></a></td></tr><tr><td style="padding:18px 18px 9px 18px;text-align:center;font-family:Helvetica;font-size:12px;line-height:1.5;color:rgb(101,101,101)">This email was sent to <a href="mailto:fedra.cacciamano@ketchum.com.ar" style="color:rgb(101,101,101)">fedra.cacciamano@ketchum.com.ar</a><br>Ketchum &middot; 11 de septiembre de 1888 N&deg;2173 3C - Buenos Aires, Ciudad de Buenos Aires CP 1428 &middot; Argentina</td></tr></table>';
let seccionesHtml = "";
for (const j of JURS_CANON) seccionesHtml += renderSeccion(j, byTema[j]);
const totalItems = articles.filter(esValido).length;
const dia = dateInfo.dia, fechaHoy = dateInfo.fecha;
let finalHtml = '<html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:'+COLOR_BG+';font-family:'+FONT_STACK+'"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:'+COLOR_BG+'"><tr><td style="padding:24px 0"><table role="presentation" width="'+CONTENT_WIDTH+'" cellpadding="0" cellspacing="0" border="0" style="width:'+CONTENT_WIDTH+'px;margin:0;border-collapse:collapse;background:#ffffff"><tr><td>'+header+'</td></tr><tr><td>'+(seccionesHtml || '<p style="text-align:center;font-family:'+FONT_STACK+';color:#5A5A5A;padding:40px 0">No hay artículos relevantes en esta corrida.</p>')+'</td></tr><tr><td>'+footer+'</td></tr></table></td></tr></table></body></html>';
if (NO_NOTAS_FLAG) {
  finalHtml = '<!DOCTYPE html><html><body style="font-family:Arial;padding:30px;background:#fff"><h2 style="color:'+COLOR_TEAL+'">Clipping MSD Salud Animal - '+dia+', '+fechaHoy+'</h2><div style="padding:20px;background:#FFF3E0;border-left:4px solid #FF9800;margin:20px 0"><h3 style="margin:0 0 10px 0;color:#E65100">Sin artículos hoy</h3><p>El clipping de hoy no tiene artículos. Revisar logs del workflow en n8n.</p></div><p style="color:#5A5A5A;font-size:12px;margin-top:30px">Ketchum Clipping - MSD Salud Animal</p></body></html>';
}
let destinatario = 'adrian@archytas.io';
// destinatario fijo (app)
return finalHtml;

}
