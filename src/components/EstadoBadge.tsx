"use client";

// "Activo"/"Inactivo" son palabras parecidas y se leen igual de reojo (pedido de Fede): el
// color hace el trabajo. Sigue siendo un boton -- se toca para cambiar el estado.
export default function EstadoBadge({
  activo,
  onClick,
  labelActivo = "Activo",
  labelInactivo = "Inactivo",
  disabled = false,
}: {
  activo: boolean;
  onClick: () => void;
  labelActivo?: string;
  labelInactivo?: string;
  // En la version que se envia hoy la config se muestra pero no se edita: el badge sigue
  // comunicando el estado con color, sin invitar a tocarlo.
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={
        disabled
          ? "Esta versión no se edita desde acá"
          : activo
            ? "Tocá para desactivar"
            : "Tocá para activar"
      }
      className={
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium transition-colors " +
        (disabled ? "cursor-not-allowed opacity-70 " : "cursor-pointer ") +
        (activo
          ? "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-400"
          : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400") +
        (disabled ? "" : activo ? " hover:bg-green-100" : " hover:bg-red-100")
      }
    >
      <span className={"size-1.5 rounded-full " + (activo ? "bg-green-500" : "bg-red-500")} />
      {activo ? labelActivo : labelInactivo}
    </button>
  );
}
