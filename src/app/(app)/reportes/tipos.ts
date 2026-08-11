// Archivo aparte y SIN "use server" a proposito: un modulo con esa directiva solo puede
// exportar funciones async. Si esta constante vive en actions.ts, Next la convierte en una
// referencia de server action y en el cliente deja de ser un array -- el build pasa igual y
// revienta recien en runtime con "TIPOS_REPORTE.map is not a function".

// Los cuatro casos que nombro Fedra + "otro". Los tipos finos del TDD (sin_subtitulo,
// doble_link, medio_extranjero, duplicada) siguen siendo validos en la base pero no se
// ofrecen en el formulario: clasificar a ese nivel es trabajo nuestro, no de quien reporta.
export const TIPOS_REPORTE = [
  { value: "falta_nota", label: "Noticia que no entró" },
  { value: "nota_extra", label: "Noticia extra (no correspondía)" },
  { value: "seccion_incorrecta", label: "Noticia mal categorizada" },
  { value: "formato", label: "Error de formato" },
  { value: "otro", label: "Otro" },
] as const;

export type TipoReporte = (typeof TIPOS_REPORTE)[number]["value"];

export type ReporteRow = {
  id: string;
  client_id: string;
  fecha: string | null;
  tipo: string | null;
  descripcion: string;
  nota_url: string | null;
  estado: "abierto" | "en_revision" | "resuelto" | "descartado";
  resolucion: string | null;
  created_at: string;
  resuelto_at: string | null;
};
