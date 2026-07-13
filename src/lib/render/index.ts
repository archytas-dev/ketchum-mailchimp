// Módulos JS copiados del render real de n8n (sin tipos).
import { renderBooking } from "./booking.render.js";
import { renderBms } from "./bms.render.js";
import { renderMsd } from "./msd.render.js";

export type Article = {
  id?: string;
  title: string;
  snippet: string;
  medio: string;
  grupo: string;
  url: string;
  pubDate: string;
  keyword_match?: string;
};

export type RenderInput = {
  articles: Article[];
  tier?: Record<string, { ad_value?: number }>;
  resumen?: { exclusivas?: string; competencia?: string };
};

// Cada cliente tiene su propio render (copia exacta de su Build HTML Email).
const RENDERERS: Record<string, (input: RenderInput) => string> = {
  booking: renderBooking,
  bms: renderBms,
  msd: renderMsd,
};

export function renderClipping(slug: string, input: RenderInput): string | null {
  const fn = RENDERERS[slug];
  if (!fn) return null;
  return fn(input);
}

export function hasRenderer(slug: string): boolean {
  return slug in RENDERERS;
}
