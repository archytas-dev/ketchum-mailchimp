"use client";

import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";

type Cli = { id: string; nombre: string };

export default function ActividadFilter({ clients, value }: { clients: Cli[]; value: string }) {
  const router = useRouter();
  const label = clients.find((c) => c.id === value)?.nombre ?? "Cliente";
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (v) router.push(`/actividad?cliente=${v}`);
      }}
    >
      <SelectTrigger className="w-52 font-medium">
        <span>{label}</span>
      </SelectTrigger>
      <SelectContent>
        {clients.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.nombre}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
