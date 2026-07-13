/* eslint-disable */
// @ts-nocheck
// Render EXACTO del clipping Booking — copia de Build HTML Email (n8n), parametrizado.
// NO reescribir: es el mismo codigo del mail para fidelidad 1:1.
export function renderBooking({ articles: __articles, tier: __tier = {}, resumen: __resumenObj = {} }) {
  const __input = { articles: Array.isArray(__articles) ? __articles : [] };
function renderNoticia(n){ var h = __rn(n); if(typeof h==="string" && h.trim()){ h = h.replace(/^(\s*<(?:div|table|a|p)\b)/i, "$1 data-note-id=\""+((n&&n.id!=null)?String(n.id):"")+"\""); } return h; }

// Build HTML Email — BOOKING (azul Ketchum). Tabla de Tiers completa (turismo+generalistas+negocios).
const out = __input || {};
let articles = Array.isArray(out.articles) ? out.articles : [];
const NO_NOTAS_FLAG = articles.length === 0;
const WIDTH = 720, COLOR_HEADER="#0000FF", COLOR_LINK="#0000FF", COLOR_TEXT="#222222", COLOR_BG="#F5F8FB", COLOR_RED="#D32F2F", COLOR_TAG="#0a7fa3";
const FONT_STACK = "Arial, Helvetica, sans-serif";
const IMAGE_URL = "https://mcusercontent.com/36c5c572bba94d0ff7ebdd653/images/e7a879c8-e852-70d1-a5d2-1bf020e2b6ef.jpg";
const MEDIOS_DATA = {
  "03442 noticias ahora": {tier:"Tier 3",alcance:3000},
  "221": {tier:"Tier 1",alcance:22000},
  "0 223": {tier:"Tier 2",alcance:17000},
  "100 seguro": {tier:"Tier 2",alcance:7000},
  "16 válvulas": {tier:"Tier 2",alcance:32178},
  "19640 noticias": {tier:"Tier 3",alcance:4000},
  "2+2": {tier:"Tier 1 Trade",alcance:1000},
  "30 días de noticias": {tier:"Tier 3",alcance:14000},
  "30 dias de noticias": {tier:"Tier 3",alcance:8000},
  "3dgames": {tier:"Tier 2",alcance:11000},
  "3tres3": {tier:"Tier 1",alcance:6300},
  "a todo motor": {tier:"Tier 3",alcance:1000},
  "a24": {tier:"Tier 2",alcance:37000},
  "abc hoy": {tier:"Tier 3",alcance:1},
  "actualidad": {tier:"Tier 3",alcance:3600},
  "adn empresario": {tier:"Tier 3",alcance:5300},
  "adn sur": {tier:"Tier 2",alcance:7600},
  "agenda salta": {tier:"Tier 3",alcance:5200},
  "agritotal": {tier:"Tier 3",alcance:62372},
  "agro voz": {tier:"Tier 1",alcance:62096},
  "ahora mar del plata": {tier:"Tier 1",alcance:1000},
  "aim digital": {tier:"Tier 3",alcance:1000},
  "aires de santa fe": {tier:"Tier 2",alcance:4000},
  "ambito web": {tier:"TIER 1",alcance:768000},
  "américa retail": {tier:"Tier 2",alcance:3500},
  "an digital": {tier:"Tier 3",alcance:4500},
  "antena 3": {tier:"Tier 2",alcance:31257},
  "apertura": {tier:"Tier 1",alcance:101785},
  "autoblog": {tier:"Tier 1",alcance:23288},
  "autocosmos": {tier:"Tier 1",alcance:16328},
  "aviación en argentina": {tier:"Tier 2",alcance:1000},
  "aviación online": {tier:"Tier 2",alcance:8600},
  "bahía cesar": {tier:"Tier 3",alcance:1000},
  "bank magazine": {tier:"Tier 2",alcance:9400},
  "bariloche 2000": {tier:"Tier 3",alcance:2100},
  "bichos de campo": {tier:"Tier 1",alcance:7500},
  "big bang news": {tier:"Tier 2",alcance:5711},
  "bloomberg línea": {tier:"Tier 1",alcance:14000},
  "brando": {tier:"Tier 3",alcance:18180},
  "buenos aires en vivo": {tier:"Tier 3",alcance:18000},
  "buenos aires no duerme": {tier:"Tier 3",alcance:4500},
  "buenos viajes": {tier:"Tier 2",alcance:1000},
  "c5n": {tier:"TIER 1",alcance:21000},
  "cadena 3": {tier:"Tier 1",alcance:77000},
  "cambio de aire": {tier:"Tier 2",alcance:1000},
  "campeones": {tier:"Tier 1",alcance:1000},
  "canal 26": {tier:"Tier 3",alcance:8900},
  "canal ar": {tier:"Tier 2",alcance:9518},
  "canal c": {tier:"Tier 2",alcance:7000},
  "canal e": {tier:"Tier 2",alcance:417000},
  "cancha llena": {tier:"Tier 3",alcance:844051},
  "carburando": {tier:"Tier 1",alcance:5},
  "cba24": {tier:"Tier 2",alcance:4},
  "chaco dia por dia": {tier:"Tier 3",alcance:2100},
  "chequeado": {tier:"Tier 1",alcance:16000},
  "circuito gastronomico": {tier:"Tier 2",alcance:8300},
  "ciudad magazine": {tier:"Tier 1",alcance:45000},
  "ciudadano news": {tier:"Tier 3",alcance:15000},
  "ciudadanos viajeros": {tier:"Tier 2",alcance:4000},
  "clarin": {tier:"Tier 1",alcance:354000},
  "comercio & justicia": {tier:"Tier 1",alcance:5800},
  "consenso salud": {tier:"Tier 2",alcance:3700},
  "contexto turistico": {tier:"Tier 3",alcance:1000},
  "continental": {tier:"Tier 1",alcance:7100},
  "corrientes info": {tier:"Tier 3",alcance:6200},
  "corta": {tier:"Tier 2",alcance:12000},
  "critica sur": {tier:"Tier 3",alcance:6000},
  "cronica": {tier:"Tier 1",alcance:7400},
  "cronista": {tier:"Tier 1",alcance:762000},
  "cuyo noticias": {tier:"Tier 2",alcance:3900},
  "daily travelling news": {tier:"Tier 2",alcance:3500},
  "dbiz": {tier:"Tier 2",alcance:20000},
  "derf": {tier:"Tier 3",alcance:6091},
  "día a día": {tier:"Tier 2",alcance:9720},
  "diariamente neuquén": {tier:"Tier 2",alcance:13000},
  "diario 26": {tier:"Tier 3",alcance:1000},
  "diario bae": {tier:"Tier 1",alcance:15},
  "diario de cuyo": {tier:"Tier 1",alcance:8755},
  "diario del hotelero": {tier:"Tier 2",alcance:1000},
  "diario del viajero": {tier:"Tier 3",alcance:300000},
  "diario democracia": {tier:"Tier 3",alcance:2953},
  "diario el este": {tier:"Tier 2",alcance:6200},
  "diario hoy": {tier:"Tier 2",alcance:2205},
  "diario huarpe": {tier:"Tier 3",alcance:5600},
  "diario jornada": {tier:"Tier 1",alcance:2913},
  "diario panorama": {tier:"Tier 2",alcance:63000},
  "diario popular": {tier:"Tier 3",alcance:4},
  "diario registrado": {tier:"Tier 3",alcance:24000},
  "diario uno": {tier:"Tier 1",alcance:31000},
  "diarios bonaerenses (dib)": {tier:"Tier 3",alcance:1086},
  "dossier net": {tier:"Tier 2",alcance:6900},
  "ebizlatam": {tier:"Tier 3",alcance:4200},
  "eco cuyo": {tier:"Tier 1",alcance:12000},
  "ecobiz": {tier:"Tier 1",alcance:1000},
  "economis": {tier:"Tier 3",alcance:4100},
  "el ancasti": {tier:"Tier 2",alcance:5032},
  "el atlántico": {tier:"Tier 2",alcance:5900},
  "el chubut": {tier:"Tier 2",alcance:7800},
  "el ciudadano": {tier:"Tier 2",alcance:17000},
  "el cordillerano": {tier:"Tier 2",alcance:3900},
  "el cronista": {tier:"Tier 1",alcance:762000},
  "el destape": {tier:"Tier 2",alcance:58000},
  "el día": {tier:"Tier 1",alcance:22},
  "el diario 24": {tier:"Tier 2",alcance:6000},
  "el diario ar": {tier:"Tier 2",alcance:6},
  "el diario de carlos paz": {tier:"Tier 2",alcance:7200},
  "el diario de turismo": {tier:"Tier 2",alcance:1600},
  "el diario de viaje": {tier:"Tier 2",alcance:4000},
  "el diario del fin del mundo": {tier:"Tier 2",alcance:3387},
  "el doce tv": {tier:"Tier 1",alcance:13000},
  "el economista": {tier:"Tier 2",alcance:7500},
  "el intransigente": {tier:"Tier 2",alcance:4800},
  "el liberal": {tier:"Tier 1",alcance:45502},
  "el litoral": {tier:"Tier 1",alcance:11020},
  "el observador": {tier:"Tier 3",alcance:16000},
  "el once": {tier:"Tier 3",alcance:55000},
  "el país": {tier:"Tier 1",alcance:1294380},
  "el patagonico": {tier:"Tier 2",alcance:6414},
  "el sureño": {tier:"Tier 1",alcance:5900},
  "el territorio": {tier:"Tier 1",alcance:17000},
  "el trece": {tier:"Tier 1",alcance:23000},
  "el tribuno de jujuy/salta": {tier:"Tier 1",alcance:12715},
  "el zonda": {tier:"Tier 1",alcance:8000},
  "elle": {tier:"Tier 1",alcance:1030000},
  "emprendedores news": {tier:"Tier 2",alcance:1206},
  "entremujeres": {tier:"Tier 3",alcance:1590915},
  "espn": {tier:"Tier 1",alcance:37984},
  "filo news": {tier:"Tier 2",alcance:4200},
  "flavia tomaello": {tier:"Tier 1 trade",alcance:1300},
  "flipr": {tier:"Tier 2",alcance:5100},
  "forbes": {tier:"Tier 1",alcance:15000},
  "fortuna (perfil)": {tier:"Tier 1",alcance:150},
  "gente": {tier:"Tier 1",alcance:4675},
  "goal": {tier:"Tier 1",alcance:626195},
  "grupo la provincia": {tier:"Tier 2",alcance:11000},
  "headtopic": {tier:"Tier 2",alcance:2000},
  "host news": {tier:"Tier 2",alcance:0},
  "hosteltur": {tier:"Tier 2",alcance:12043},
  "impulso baires": {tier:"Tier 2",alcance:5600},
  "impulso negocios": {tier:"Tier 2",alcance:1150},
  "info auto": {tier:"Tier 1",alcance:1000},
  "info gremiales": {tier:"Tier 3",alcance:6200},
  "info negocios": {tier:"Tier 1",alcance:14000},
  "info technology": {tier:"Tier 1",alcance:77000},
  "info viajera": {tier:"Tier 2",alcance:2552},
  "infobae": {tier:"Tier 1",alcance:3860000},
  "infoban": {tier:"Tier 2",alcance:10000},
  "infocampo": {tier:"Tier 1",alcance:6000},
  "infocielo": {tier:"Tier 3",alcance:10000},
  "infofueguina": {tier:"Tier 3",alcance:2514},
  "infohotelera": {tier:"Tier 2",alcance:1000},
  "infonews": {tier:"Tier 2",alcance:28726},
  "informate salta": {tier:"Tier 3",alcance:8000},
  "infosertec": {tier:"Tier 2",alcance:9000},
  "infotur latam": {tier:"Tier 2",alcance:3400},
  "inluxus": {tier:"Tier 3",alcance:1000},
  "interlook": {tier:"Tier 3",alcance:1000},
  "intramed": {tier:"Tier 1",alcance:5198},
  "ipro up": {tier:"Tier 1",alcance:71000},
  "iprofesional": {tier:"Tier 1",alcance:147000},
  "jornada online": {tier:"Tier 2",alcance:5000},
  "jujuy gráfico": {tier:"Tier 3",alcance:5100},
  "la 100": {tier:"Tier 3",alcance:52000},
  "la agencia de viajes / ladevi": {tier:"Tier 2",alcance:6000},
  "la arena": {tier:"Tier 1",alcance:5900},
  "la capital de mar del plata": {tier:"Tier 1",alcance:72000},
  "la capital de rosario": {tier:"Tier 1",alcance:8300},
  "la gaceta": {tier:"Tier 3",alcance:74893},
  "la mañana de neuquen (lm neuquen)": {tier:"Tier 2",alcance:21000},
  "la nación": {tier:"Tier 1",alcance:519000},
  "la nacion": {tier:"Tier 1",alcance:519000},
  "la nueva": {tier:"Tier 1",alcance:21000},
  "la opinión austral": {tier:"Tier 1",alcance:4200},
  "la politica online": {tier:"Tier 1",alcance:56000},
  "la prensa": {tier:"Tier 3",alcance:5400},
  "la tecla": {tier:"Tier 2",alcance:4500},
  "la voz del interior": {tier:"Tier 1",alcance:53000},
  "latam noticias": {tier:"Tier 2",alcance:5100},
  "latitud 2000": {tier:"Tier 2",alcance:6100},
  "letra p": {tier:"Tier 2",alcance:9100},
  "lmneuquén": {tier:"Tier 1",alcance:23464},
  "los andes": {tier:"Tier 1",alcance:40000},
  "lt10": {tier:"Tier 2",alcance:6000},
  "lv12": {tier:"Tier 1",alcance:11000},
  "marie claire": {tier:"Tier 1",alcance:67765},
  "marketing registrado": {tier:"Tier 2",alcance:1557},
  "mdz": {tier:"Tier 1",alcance:26000},
  "mendoza post": {tier:"Tier 2",alcance:42000},
  "mendoza today": {tier:"Tier 2",alcance:4400},
  "mensajero web": {tier:"Tier 2",alcance:6000},
  "mercado": {tier:"Tier 1",alcance:13000},
  "minuto fueguino": {tier:"Tier 2",alcance:5800},
  "minuto uno": {tier:"Tier 1",alcance:92000},
  "mirada profesional": {tier:"Tier 2",alcance:22000},
  "misiones online": {tier:"Tier 1",alcance:44000},
  "mnews": {tier:"Tier 3",alcance:1000},
  "nbs": {tier:"Tier 2",alcance:4400},
  "neuquen post": {tier:"Tier 2",alcance:15000},
  "noticias": {tier:"Tier 1",alcance:93000},
  "noticias argentinas": {tier:"Tier 2",alcance:13000},
  "noticias del 6": {tier:"Tier 1",alcance:12000},
  "nosotros el litoral": {tier:"Tier 1",alcance:14232},
  "ohlala": {tier:"Tier 1",alcance:25830},
  "olé": {tier:"Tier 1",alcance:256649},
  "on 24": {tier:"Tier 1",alcance:6400},
  "pagina 12": {tier:"Tier 2",alcance:141000},
  "para ti": {tier:"Tier 1",alcance:24000},
  "parabrisas": {tier:"Tier 1",alcance:67345},
  "parlamentario": {tier:"Tier 3",alcance:6990},
  "perfil": {tier:"Tier 1",alcance:405},
  "pharma biz": {tier:"tier 1",alcance:5400},
  "pinamar 24": {tier:"Tier 3",alcance:7400},
  "planeta joy": {tier:"Tier 2",alcance:1000},
  "planeta urbano": {tier:"Tier 2",alcance:10000},
  "pronto": {tier:"Tier 1",alcance:5100},
  "pulso turístico": {tier:"Tier 3",alcance:1000},
  "puntal": {tier:"Tier 1",alcance:12000},
  "punto a punto": {tier:"Tier 2",alcance:3500},
  "punto biz": {tier:"Tier 2",alcance:5200},
  "que pasa salta": {tier:"Tier 3",alcance:7623},
  "radar viajes": {tier:"Tier 2",alcance:9500},
  "radio mitre": {tier:"Tier 1",alcance:94000},
  "radio nacional": {tier:"Tier 1",alcance:4400},
  "radio rafaela": {tier:"Tier 2",alcance:9000},
  "radio tv turistica": {tier:"Tier 2",alcance:10000},
  "red accion": {tier:"Tier 2",alcance:1178},
  "red users": {tier:"Tier 2",alcance:13913},
  "report news": {tier:"Tier 2",alcance:4700},
  "reportrip": {tier:"Tier 2",alcance:9000},
  "reportur": {tier:"Tier 1",alcance:6284},
  "revista area tres": {tier:"Tier 2",alcance:12000},
  "revista travel gorumet": {tier:"Tier 2",alcance:11000},
  "rio negro": {tier:"Tier 1",alcance:63000},
  "rosario 3": {tier:"Tier 1",alcance:34000},
  "rosario plus": {tier:"Tier 2",alcance:3458},
  "san juan 8": {tier:"Tier 2",alcance:3900},
  "seba rios": {tier:"Tier 1 trade",alcance:3000},
  "semanario extra": {tier:"Tier 3",alcance:13000},
  "sin mordaza": {tier:"Tier 2",alcance:2275},
  "sir chandler": {tier:"Tier 2",alcance:4799},
  "sitemarca": {tier:"Tier 2",alcance:8000},
  "sitio andino": {tier:"Tier 3",alcance:2195},
  "somos pymes": {tier:"Tier 2",alcance:11000},
  "super campo": {tier:"Tier 1",alcance:124031},
  "telam": {tier:"Tier 1",alcance:67},
  "telefe santa fe": {tier:"Tier 1",alcance:34776},
  "terra": {tier:"Tier 1",alcance:86778},
  "tiempo argentino": {tier:"Tier 3",alcance:4186},
  "tiempo de san juan": {tier:"Tier 2",alcance:20000},
  "tiempo sur": {tier:"Tier 1",alcance:16000},
  "time out": {tier:"Tier 1",alcance:291000},
  "tkm": {tier:"Tier 2",alcance:5190},
  "tn": {tier:"Tier 1",alcance:169000},
  "todo agro": {tier:"Tier 1",alcance:7500},
  "totalmedios": {tier:"Tier 2",alcance:5900},
  "trade y retail": {tier:"Tier 2",alcance:5700},
  "travel 2 latam": {tier:"Tier 2",alcance:1134},
  "turismo 12": {tier:"Tier 2",alcance:1000},
  "turismo cero": {tier:"Tier 3",alcance:2300},
  "tyc sports": {tier:"Tier 1",alcance:75185},
  "tyn": {tier:"Tier 2",alcance:13000},
  "uno": {tier:"Tier 1",alcance:44138},
  "uno santa fe": {tier:"Tier 2",alcance:3000},
  "urgente 24": {tier:"Tier 2",alcance:18},
  "vaca muerta news": {tier:"Tier 1",alcance:8500},
  "vía país": {tier:"Tier 1",alcance:22000},
  "via pais": {tier:"Tier 1",alcance:22000},
  "viajes boletin": {tier:"Tier 1",alcance:1000},
  "viva": {tier:"Tier 1",alcance:527110},
  "vivir viajando": {tier:"Tier 2",alcance:9000},
  "voy de viaje": {tier:"Tier 1",alcance:249000},
  "web retail": {tier:"Tier 2",alcance:12000},
  "weekend": {tier:"Tier 1",alcance:150000},
  "world diagnostics news": {tier:"Tier 1",alcance:3800},
  "yahoo": {tier:"Tier 2",alcance:1160000},
  "zona norte visión": {tier:"Tier 3",alcance:5400}
};
const TIER_MULTIPLIER = { "Tier 1":250, "Tier 1 Trade":250, "Tier 2":120, "Tier 3":50 };
const normMedio = (s) => (s||"").toString().normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/^https?:\/\//,"").replace(/^www\./,"").replace(/\s+/g," ").trim();
const stripTld = (s) => String(s||"").replace(/\.(com|ar|net|org|gov|gob|info|tv|edu|lat|la|mx|io|blog|world|travel)\b.*$/i,"").replace(/\.[a-z]{2,3}$/i,"").trim();
function lookupMedio(medio){
  const raw = normMedio(medio);
  const base = stripTld(raw);
  let key = MEDIOS_DATA[raw] ? raw : (MEDIOS_DATA[base] ? base : null);
  if(!key && base){ for(const kk of Object.keys(MEDIOS_DATA)){ if(kk.length>=4 && base.length>=4 && (kk===base||stripTld(kk)===base||kk.includes(base)||base.includes(kk))){ key=kk; break; } } }
  if(!key) return { tier:"Sin clasificar", nombre:null };
  const pretty = key.split(" ").map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(" ");
  return { tier:MEDIOS_DATA[key].tier, nombre:pretty };
}
function lookupTier(medio){ const r=lookupMedio(medio); return { tier:r.tier, ad_value:"" }; }
const JURS_CANON = ["Gacetillas","Exclusiva","Competencia","Turismo"];
const normG = (s) => (s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/\s+/g," ").toUpperCase().trim();
const MAP = {};
for (const j of JURS_CANON) MAP[normG(j)] = j;
MAP["EXCLUSIVA"]="Exclusiva"; MAP["EXCLUSIVAS"]="Exclusiva"; MAP["BOOKING"]="Exclusiva"; MAP["BOOKING.COM"]="Exclusiva";
MAP["COMPETENCIA"]="Competencia"; MAP["SECTOR"]="Turismo"; MAP["TURISMO"]="Turismo"; MAP["GESTION"]="Turismo"; MAP["GESTION/POLITICA"]="Turismo";
MAP["LABORALES Y GREMIALES"]="Turismo"; MAP["MANAGEMENT"]="Turismo";
MAP["GACETILLAS"]="Gacetillas"; MAP["GACETILLA"]="Gacetillas"; MAP["GACETILLA BOOKING"]="Gacetillas"; MAP["GACETILLA BMS"]="Gacetillas";
const esGacetilla = (n) => { const et=normG(n.etiqueta); return et==="GACETILLA BOOKING"||et==="GACETILLA BMS"||et==="GACETILLA"||(n.categoria||"").toString().toLowerCase()==="gacetilla"; };
const cleanStr = (s) => (typeof s === "string" ? s.trim() : "");
const decodeAndClean = (s) => String(s||"").replace(/\[\]\(\s*https?:\/\/[^\s)]+\s+"[^"]*"\s*\)/gi,"").replace(/\[([^\]]*)\]\(\s*https?:\/\/[^\s)]+\s+"[^"]*"\s*\)/gi,"$1").replace(/\[\]\((?:https?:\/\/)?[^\)]*\)/gi,"").replace(/\[([^\]]+)\]\((?:https?:\/\/)?[^\)]*\)/gi,"$1").replace(/\[\]\([^\s]*\s*"?[^"\)]*$/gi,"").replace(/\[\]\([^\)]*$/gi,"").replace(/\(\s*https?:\/\/[^\s\)]+\s+"[^"]*"\s*\)/gi,"").replace(/\(https?:\/\/[^\s\)]+\s+"[^"]*$/gi,"").replace(/<[^>]+>/g,"").replace(/&quot;/gi,'"').replace(/&apos;/gi,"'").replace(/&#39;/gi,"'").replace(/&#34;/gi,'"').replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&nbsp;/gi," ").replace(/&ldquo;/gi,"“").replace(/&rdquo;/gi,"”").replace(/&lsquo;/gi,"‘").replace(/&rsquo;/gi,"’").replace(/&hellip;/gi,"…").replace(/&mdash;/gi,"—").replace(/&ndash;/gi,"–").replace(/&middot;/gi,"·").replace(/&laquo;/gi,"«").replace(/&raquo;/gi,"»").replace(/yldquo;/gi,"“").replace(/yrdquo;/gi,"”").replace(/ylsquo;/gi,"‘").replace(/yrsquo;/gi,"’").replace(/yhellip;/gi,"…").replace(/ymdash;/gi,"—").replace(/yndash;/gi,"–").replace(/ynbsp;/gi," ").replace(/yamp;/gi,"&").replace(/&amp;/gi,"&").replace(/&#?[a-z0-9]+;/gi,"").replace(/\s+/g," ").trim();
const esValido = (n) => n && typeof n === "object" && decodeAndClean(cleanStr(n.title)).length > 0 && cleanStr(n.url).length > 0;
const formatHeaderDate = () => { const d=new Date(); const dias=["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"]; const meses=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"]; const day=String(d.getDate()).padStart(2,"0"); return { dia:dias[d.getDay()], fecha:day+" de "+meses[d.getMonth()]+" "+d.getFullYear() }; };
const __MESf={enero:'01',febrero:'02',marzo:'03',abril:'04',mayo:'05',junio:'06',julio:'07',agosto:'08',septiembre:'09',setiembre:'09',octubre:'10',noviembre:'11',diciembre:'12'};
function __pfFmt(raw){const s=String(raw||'');let m;m=s.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);if(m)return m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');m=s.match(/\b([0-3]?\d)[.\/-]([0-3]?\d)[.\/-](20\d{2})\b/);if(m){let a=+m[1],b=+m[2];if(b>12&&a<=12)return m[3]+'-'+String(a).padStart(2,'0')+'-'+String(b).padStart(2,'0');return m[3]+'-'+String(b).padStart(2,'0')+'-'+String(a).padStart(2,'0');}m=s.match(/\b([0-3]?\d)\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de)?\s+(20\d{2})\b/i);if(m)return m[3]+'-'+__MESf[m[2].toLowerCase()]+'-'+m[1].padStart(2,'0');m=s.match(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+([0-3]?\d),?\s+(20\d{2})\b/i);if(m)return m[3]+'-'+__MESf[m[1].toLowerCase()]+'-'+m[2].padStart(2,'0');const d=new Date(s);if(!isNaN(d.getTime()))return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');return '';}
function __textDateES(raw){const s=String(raw||'');let m;m=s.match(/\b([0-3]?\d)\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de)?\s+(20\d{2})\b/i);if(m)return m[3]+'-'+__MESf[m[2].toLowerCase()]+'-'+m[1].padStart(2,'0');m=s.match(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+([0-3]?\d),?\s+(20\d{2})\b/i);if(m)return m[3]+'-'+__MESf[m[1].toLowerCase()]+'-'+m[2].padStart(2,'0');return '';}
const formatNoticiaDate = (raw) => { if(!raw) return ""; const iso=__pfFmt(String(raw)); if(!iso) return ""; const dt=new Date(iso+'T12:00:00'); const now=Date.now(); if(isNaN(dt.getTime())||dt.getTime()>now+86400000||(now-dt.getTime())>63072000000) return ""; const p=iso.split('-'); return p[2]+'/'+p[1]+'/'+p[0]; };
const escapeRegex = (s) => (s||"").replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const highlight = (text, kw) => { if(!text) return text; const __RED='<span style="color:'+COLOR_RED+';font-weight:bold">'; const __paint1=(s,term)=>{ if(!s||!term) return s; try { return s.replace(new RegExp("("+escapeRegex(term)+")","gi"), __RED+'$1</span>'); } catch { return s; } }; let __out=text; const __k=cleanStr(kw); if(__k && !/scioli/i.test(__k) && !/^booking(\.com)?$/i.test(__k)) __out=__paint1(__out,__k); __out=__paint1(__out,"Booking"); return __out; };
// [2026-06-12 AD VALUE] lookup dinámico desde la planilla de Fedra (nodo 'Build Tier Lookup')
function __tierNorm(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\b(online|web|com|ar|digital|diario|portal|noticias|el|la|los|las)\b/g,' ').replace(/ +/g,' ').trim(); }
const __TIER_DYN = (function(){ try { const o=({ lookup: __tier }); return (o && o.lookup) ? o.lookup : {}; } catch(e){ return {}; } })();
function __adValueFor(medio){ const e=__TIER_DYN[__tierNorm(medio)]; return (e && e.ad_value) ? e.ad_value : null; }
function __fmtAdValue(n){ return '$'+String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,'.')+'-'; }
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
  const kw = cleanStr(n.keyword_match || n.tema);
  const fecha = (function(){ const __body=(n.title||'')+' '+(n.snippet||n.contentSnippet||''); let out=formatNoticiaDate(n.pubDate||n.isoDate||n.date||n.fecha||''); if(out)return out; out=formatNoticiaDate(__textDateES(__body)); if(out)return out; out=formatNoticiaDate(String(n.snippet||'').slice(0,80)); if(out)return out; try{const m=String(n.url||'').match(/(20\d{2})\/(\d{1,2})\/(\d{1,2})/);if(m){const y=+m[1],mo=+m[2],d=+m[3];if(mo>=1&&mo<=12&&d>=1&&d<=31){const dt=new Date(y,mo-1,d),now=Date.now();if(!isNaN(dt.getTime())&&dt.getTime()<=now+86400000&&(now-dt.getTime())<63072000000)return String(d).padStart(2,'0')+'/'+String(mo).padStart(2,'0')+'/'+y;}}}catch(e){} return ''; })();
  const grupoCanon = MAP[normG(n.grupo || n.group || n.jurisdiction)] || "Turismo";
  const esExclusiva = grupoCanon === "Exclusiva";
  const isScrap = cleanStr(n.etiqueta).toUpperCase() === "SITIO MONITOREADO" || cleanStr(n.categoria).toLowerCase() === "scraping";
  const isGace = esGacetilla(n);
  if (isGace && (medio === "Sin medio" || !cleanStr(n.medio))) medio = "Booking.com";
  const t = __lk;
  const partes = ['<strong style="color:'+COLOR_LINK+'">'+medio+' (Online)</strong>'];
  if (fecha) partes.push('<span style="color:'+COLOR_LINK+';font-weight:bold">'+fecha+'</span>');
  const __av = __adValueFor(cleanStr(n.medio) || medio); if ((esExclusiva || grupoCanon === "Competencia") && __av) { partes.push('<span style="color:'+COLOR_LINK+';font-weight:bold">Ad Value: '+__fmtAdValue(__av)+'</span>'); }
  const headLine = partes.join(" ");
  const titleHtml = '<a href="'+url+'" style="color:'+COLOR_LINK+';text-decoration:underline;font-weight:bold">'+highlight(title, kw)+'</a>';
  const tagSitio = "";
  const tagGace = false ? '<span style="display:inline-block;background:#C8A24B;color:#fff;font-size:9px;padding:2px 7px;border-radius:3px;margin-left:6px;letter-spacing:0.5px;font-weight:bold;vertical-align:middle">🔔 GACETILLA</span>' : "";
  const snippetCorto = snippet.length > 800 ? snippet.slice(0,797).replace(/\s+\S*$/,"") + "..." : snippet;
  const snippetHtml = snippetCorto ? '<div style="font-family:'+FONT_STACK+';font-size:12px;color:'+COLOR_TEXT+';margin-top:8px;line-height:1.6">'+highlight(snippetCorto, kw)+'</div>' : "";
  return '<div style="padding:18px 0;border-bottom:1px solid #e0e6ec"><div style="font-family:'+FONT_STACK+';font-size:14px;color:'+COLOR_LINK+';font-weight:bold;line-height:1.45">'+headLine+' - '+titleHtml+tagSitio+tagGace+'</div>'+snippetHtml+'</div>';
};
const SECTION_IMAGES = {"Exclusiva":"https://mcusercontent.com/36c5c572bba94d0ff7ebdd653/images/cd751c34-c6e6-263c-f1ea-2d8183a2063a.jpg","Competencia":"https://mcusercontent.com/36c5c572bba94d0ff7ebdd653/images/467dd0af-9fa8-2ba8-70aa-e59e2dbde4d1.jpg","Turismo":"https://ketchum-mailchimp.vercel.app/images/portadas/booking-turismo.jpg"};
const renderSeccionHeader = (titulo) => { const __img=SECTION_IMAGES[titulo]; if(__img){ return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:24px;margin-bottom:0"><tr><td style="padding:0;line-height:0"><img src="'+__img+'" alt="'+titulo+'" width="720" style="display:block;width:100%;max-width:720px;height:auto;border:0"></td></tr></table>'; } return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:24px;margin-bottom:0"><tr><td style="background:'+COLOR_HEADER+';padding:14px 22px"><span style="font-family:'+FONT_STACK+';font-size:15px;font-weight:bold;color:#ffffff;letter-spacing:2px;text-transform:uppercase">'+titulo.toUpperCase()+'</span></td></tr></table>'; };
const renderSeccion = (titulo, ns, forzar) => { let reales=(ns||[]).map(renderNoticia).filter(Boolean).join(""); if(!reales){ if(!forzar) return ""; reales='<div style="font-family:'+FONT_STACK+';font-size:13px;color:#5A5A5A;font-style:italic;padding:14px 0">No se produjeron menciones</div>'; } return renderSeccionHeader(titulo)+'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:#ffffff;border:1px solid #e0e6ec;border-top:none"><tr><td style="padding:0 22px">'+reales+'</td></tr></table>'; };
const byTema = JURS_CANON.reduce((acc,j)=>(acc[j]=[],acc),{});
const sinTema = [];
for (const n of articles) { if(!esValido(n)) continue; const canon = esGacetilla(n) ? "Exclusiva" : (MAP[normG(n.grupo||n.group||n.jurisdiction)] || "Turismo"); if(byTema[canon]) byTema[canon].push(n); else sinTema.push(n); }
const dateInfo = formatHeaderDate();
const header = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td style="padding:0"><img src="'+IMAGE_URL+'" alt="Ketchum Clipping+ - Booking.com" width="'+WIDTH+'" style="display:block;width:100%;max-width:'+WIDTH+'px;height:auto;border:0"></td></tr><tr><td style="background:'+COLOR_HEADER+';padding:10px 28px" align="right"><span style="font-family:'+FONT_STACK+';font-size:11px;color:#ffffff;letter-spacing:2px;text-transform:uppercase">'+dateInfo.dia+' '+dateInfo.fecha+'</span></td></tr></table>';
const footer = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:40px 0 0 0;border-top:1px solid #E0E0E0"><tr><td style="padding:28px 0 0 0;text-align:center"><a href="http://www.twitter.com/KetchumArg" style="display:inline-block;margin:0 7px;text-decoration:none"><img src="https://ketchum-mailchimp.vercel.app/images/social/color-twitter-48.png" alt="X" width="36" height="36" style="display:inline-block;border:0;width:36px;height:36px"></a><a href="https://www.facebook.com/KetchumARG" style="display:inline-block;margin:0 7px;text-decoration:none"><img src="https://ketchum-mailchimp.vercel.app/images/social/color-facebook-48.png" alt="Facebook" width="36" height="36" style="display:inline-block;border:0;width:36px;height:36px"></a><a href="https://www.ketchum.com/" style="display:inline-block;margin:0 7px;text-decoration:none"><img src="https://ketchum-mailchimp.vercel.app/images/social/color-link-48.png" alt="Web" width="36" height="36" style="display:inline-block;border:0;width:36px;height:36px"></a></td></tr><tr><td style="padding:24px 0 0 0;text-align:center;font-family:'+FONT_STACK+';font-size:12px;line-height:1.7;color:#9a9a9a">This email was sent to <a href="mailto:fedra.cacciamano@ketchum.com.ar" style="color:#9a9a9a;text-decoration:underline">fedra.cacciamano@ketchum.com.ar</a><br>Ketchum &middot; 11 de septiembre de 1888 N&deg;2173 3C - Buenos Aires, Ciudad de Buenos Aires CP 1428 &middot; Argentina</td></tr></table>';
let seccionesHtml = "";
for (const j of JURS_CANON) seccionesHtml += renderSeccion(j, byTema[j], j!=="Gacetillas");
seccionesHtml += renderSeccion("Sin clasificar", sinTema);
const totalItems = articles.filter(esValido).length;
const dia = dateInfo.dia, fechaHoy = dateInfo.fecha;
// === Variante Mailchimp: sin badges + gacetillas en Exclusiva + bloques mc:edit/mc:repeatable ===
const renderNoticiaMC = (n) => { let h = renderNoticia(n); if(!h) return ""; h = h.replace(/<span[^>]*background:#0a7fa3[^>]*>[\s\S]*?<\/span>/gi,"").replace(/<span[^>]*background:#C8A24B[^>]*>[\s\S]*?<\/span>/gi,""); return '<div mc:repeatable="nota" mc:variant="Nota"><div mc:edit="nota">'+h+'</div></div>'; };
const renderSeccionMC = (titulo, ns) => { const reales=(ns||[]).map(renderNoticiaMC).filter(Boolean).join(""); if(!reales) return ""; return renderSeccionHeader(titulo)+'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:#ffffff;border:1px solid #e0e6ec;border-top:none"><tr><td style="padding:0 22px">'+reales+'</td></tr></table>'; };
const byTemaMC = JURS_CANON.reduce((acc,j)=>(acc[j]=[],acc),{});
const sinTemaMC = [];
for (const n of articles) { if(!esValido(n)) continue; const canon = esGacetilla(n) ? "Exclusiva" : (MAP[normG(n.grupo||n.group||n.jurisdiction)] || "Turismo"); if(byTemaMC[canon]) byTemaMC[canon].push(n); else sinTemaMC.push(n); }
let seccionesHtmlMC = "";
for (const j of JURS_CANON) { if (j === "Gacetillas") continue; seccionesHtmlMC += renderSeccionMC(j, byTemaMC[j]); }
seccionesHtmlMC += renderSeccionMC("Sin clasificar", sinTemaMC);
const htmlMailchimp = '<html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:'+COLOR_BG+';font-family:'+FONT_STACK+'"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:'+COLOR_BG+'"><tr><td align="center" style="padding:32px 0"><table role="presentation" width="'+WIDTH+'" cellpadding="0" cellspacing="0" border="0" style="width:'+WIDTH+'px;margin:0 auto;border-collapse:collapse"><tr><td>'+header+'</td></tr><tr><td>'+(seccionesHtmlMC || '<p style="text-align:center;font-family:'+FONT_STACK+';color:#5A5A5A;padding:40px 0">No hay articulos relevantes en esta corrida.</p>')+'</td></tr><tr><td>'+footer+'</td></tr></table></td></tr></table></body></html>';
// === Resumen IA (Booking) — síntesis por sección (Exclusivas / Competencia) ===
let resumen = '';
let __resObj = {};
__resObj = (__resumenObj && typeof __resumenObj==='object') ? __resumenObj : {};
resumen = ((__resObj.exclusivas||'') + ' ' + (__resObj.competencia||'')).trim();
const __secsR = [];
if (String(__resObj.exclusivas||'').trim()) __secsR.push(['Exclusivas', String(__resObj.exclusivas).trim()]);
if (String(__resObj.competencia||'').trim()) __secsR.push(['Competencia', String(__resObj.competencia).trim()]);
const __escR = function(t){ return String(t==null?'':t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
const resumenHtml = __secsR.length ? ('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px 0"><tr><td style="background:#EEF2FB;border-left:4px solid '+COLOR_HEADER+';padding:18px 22px;border-radius:4px"><p style="margin:0 0 12px 0;font-family:'+FONT_STACK+';font-size:12px;font-weight:bold;color:'+COLOR_HEADER+';letter-spacing:.5px;text-transform:uppercase">Síntesis del día</p>' + __secsR.map(function(s){ return '<p style="margin:0 0 4px 0;font-family:'+FONT_STACK+';font-size:13px;font-weight:bold;color:'+COLOR_HEADER+'">'+s[0]+'</p><p style="margin:0 0 12px 0;font-family:'+FONT_STACK+';font-size:14px;line-height:1.55;color:'+COLOR_TEXT+'">'+__escR(s[1])+'</p>'; }).join('') + '</td></tr></table>') : '';
let finalHtml = '<html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:'+COLOR_BG+';font-family:'+FONT_STACK+'"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:'+COLOR_BG+'"><tr><td align="center" style="padding:32px 0"><table role="presentation" width="'+WIDTH+'" cellpadding="0" cellspacing="0" border="0" style="width:'+WIDTH+'px;margin:0 auto;border-collapse:collapse"><tr><td>'+header+'</td></tr>'+(resumenHtml?'<tr><td>'+resumenHtml+'</td></tr>':'')+'<tr><td>'+(seccionesHtml || '<p style="text-align:center;font-family:'+FONT_STACK+';color:#5A5A5A;padding:40px 0">No hay artículos relevantes en esta corrida.</p>')+'</td></tr><tr><td>'+footer+'</td></tr></table></td></tr></table></body></html>';
if (NO_NOTAS_FLAG) {
  finalHtml = '<!DOCTYPE html><html><body style="font-family:Arial;padding:30px;background:#fff"><h2 style="color:'+COLOR_HEADER+'">Clipping Booking - '+dia+', '+fechaHoy+'</h2><div style="padding:20px;background:#FFF3E0;border-left:4px solid #FF9800;margin:20px 0"><h3 style="margin:0 0 10px 0;color:#E65100">Sin artículos hoy</h3><p>El clipping de hoy no tiene artículos. Revisar logs del workflow en n8n.</p></div><p style="color:#5A5A5A;font-size:12px;margin-top:30px">Ketchum Clipping+ - Booking.com</p></body></html>';
}
let destinatario = 'federico@archytas.io';
// destinatario fijo (app no envia mail)
return finalHtml;

}
