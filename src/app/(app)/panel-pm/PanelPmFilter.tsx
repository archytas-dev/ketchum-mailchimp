"use client";

import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";

type Cli = { id: string; nombre: string };
type Clip = { id: string; fecha: string };

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fechaBonita(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return `${DIAS[dt.getUTCDay()]} ${d} ${MESES[m - 1]}`;
}

export default function PanelPmFilter({
  clients,
  clientId,
  clippings,
  clippingId,
}: {
  clients: Cli[];
  clientId: string;
  clippings: Clip[];
  clippingId: string | null;
}) {
  const router = useRouter();
  const clienteLabel = clients.find((c) => c.id === clientId)?.nombre ?? "Cliente";
  const clipLabel = clippings.find((c) => c.id === clippingId)?.fecha;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={clientId}
        onValueChange={(v) => {
          if (v) router.push(`/panel-pm?cliente=${v}`);
        }}
      >
        <SelectTrigger className="w-44 font-medium">
          <span>{clienteLabel}</span>
        </SelectTrigger>
        <SelectContent>
          {clients.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.nombre}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        // "" en vez de undefined -- Base UI decide controlado/no-controlado en el primer
        // render según si value es undefined o no, así que si clippingId arranca en null y
        // después pasa a tener un id (ej. la lista de clippings tarda en resolver), el Select
        // pasaría de no-controlado a controlado a mitad de vida y React tira este warning.
        value={clippingId ?? ""}
        onValueChange={(v) => {
          if (v) router.push(`/panel-pm?cliente=${clientId}&clipping=${v}`);
        }}
      >
        <SelectTrigger className="w-40">
          <span>{clipLabel ? fechaBonita(clipLabel) : "Día"}</span>
        </SelectTrigger>
        <SelectContent>
          {clippings.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {fechaBonita(c.fecha)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
