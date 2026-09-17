/**
 * Aviso para el plano operativo v4: las tablas de entrega son nuevas y arrancan vacías,
 * así que Historial y Estadísticas solo muestran lo que generó la versión nueva. Sin este
 * cartel, la pantalla parece rota (un historial de meses que de golpe tiene dos días).
 *
 * Presentacional a propósito: quién lo ve lo decide la página, que es la que puede leer
 * el plano del lado servidor.
 */
export default function AvisoMigracionV4({ superficie }: { superficie: "historial" | "estadisticas" }) {
  const queFalta =
    superficie === "historial"
      ? "Los clippings anteriores todavía no están migrados"
      : "Las estadísticas de los clippings anteriores todavía no están migradas";

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <p className="font-medium">{queFalta}.</p>
      <p className="mt-1 text-amber-900">
        Por ahora acá vas a ver solo lo que generó la versión nueva del clipping. El historial y
        las estadísticas de antes se migran más adelante; no se perdió nada.
      </p>
    </div>
  );
}
