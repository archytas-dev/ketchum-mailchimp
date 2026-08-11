"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { tierDotClasses, tierBadgeClasses } from "@/lib/tier";
import StaffOnlySection from "@/components/StaffOnlySection";
import EstadoBadge from "@/components/EstadoBadge";
import { useCachedList, invalidateCached } from "@/lib/use-cached-list";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  listMedios,
  addMedio,
  toggleMedioActivo,
  updateMedioTier,
  listKeywords,
  addKeyword,
  toggleKeywordActiva,
  listSecciones,
  addSeccion,
  toggleSeccionActiva,
  listGoogleAlerts,
  addGoogleAlert,
  toggleGoogleAlertActiva,
  listSeguimiento,
  addSeguimiento,
  updateSeguimientoEstado,
  type MedioRow,
  type KeywordRow,
  type SeccionRow,
  type AlertRow,
  type SeguimientoRow,
} from "./actions";

export type ClientOpt = { id: string; slug: string; nombre: string };

export default function BaseDatosClient({
  clients,
  isStaff,
}: {
  clients: ClientOpt[];
  isStaff: boolean;
}) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");

  if (!clients.length) {
    return <p className="text-sm text-muted-foreground">No hay clientes visibles para tu usuario.</p>;
  }

  return (
    <div className="space-y-6">
      <Select value={clientId} onValueChange={(v) => v && setClientId(v)}>
        <SelectTrigger className="w-56">
          <SelectValue placeholder="Elegí un cliente">
            {(value: string) => clients.find((c) => c.id === value)?.nombre ?? ""}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {clients.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.nombre}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Tabs key={clientId} defaultValue="nicho">
        <TabsList>
          <TabsTrigger value="nicho">Medios de nicho</TabsTrigger>
          <TabsTrigger value="generales">Medios generales</TabsTrigger>
          <TabsTrigger value="keywords">Palabras clave</TabsTrigger>
          <TabsTrigger value="secciones">Secciones</TabsTrigger>
          {isStaff && (
            <TabsTrigger value="alerts" className="text-purple-700 data-active:text-purple-700 dark:text-purple-400">
              Google Alerts
            </TabsTrigger>
          )}
          {isStaff && (
            <TabsTrigger value="seguimiento" className="text-purple-700 data-active:text-purple-700 dark:text-purple-400">
              Seguimiento
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="nicho" className="pt-6">
          <MediosTab clientId={clientId} tipo="monitoreado" />
        </TabsContent>
        <TabsContent value="generales" className="pt-6">
          <MediosTab clientId={clientId} tipo="adicional" />
        </TabsContent>
        <TabsContent value="keywords" className="pt-6">
          <KeywordsTab clientId={clientId} />
        </TabsContent>
        <TabsContent value="secciones" className="pt-6">
          <SeccionesTab clientId={clientId} />
        </TabsContent>
        {isStaff && (
          <TabsContent value="alerts" className="pt-6">
            <StaffOnlySection label="Solo staff — el cliente nunca ve esto">
              <GoogleAlertsTab clientId={clientId} />
            </StaffOnlySection>
          </TabsContent>
        )}
        {isStaff && (
          <TabsContent value="seguimiento" className="pt-6">
            <StaffOnlySection label="Solo staff — el cliente nunca ve esto">
              <SeguimientoTab clientId={clientId} />
            </StaffOnlySection>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------

// Los dominios se guardan a veces con esquema y a veces sin el; para el href hace falta uno.
function hrefDeDominio(dominio: string): string {
  const d = dominio.trim();
  return /^https?:\/\//i.test(d) ? d : `https://${d}`;
}

function DominioLink({ dominio }: { dominio: string }) {
  return (
    <a
      href={hrefDeDominio(dominio)}
      target="_blank"
      rel="noopener noreferrer"
      className="group inline-flex items-center gap-1 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
    >
      <span className="truncate">{dominio}</span>
      <ExternalLink className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-70" />
    </a>
  );
}

function MediosTab({ clientId, tipo }: { clientId: string; tipo: "monitoreado" | "adicional" }) {
  const cacheKey = `medios:${clientId}:${tipo}`;
  const { rows, setRows, loading, refresh } = useCachedList<MedioRow>(cacheKey, () =>
    listMedios(clientId, tipo),
  );
  const [open, setOpen] = useState(false);
  const [dominio, setDominio] = useState("");
  const [nombre, setNombre] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    setSaving(true);
    const res = await addMedio(clientId, tipo, { dominio, nombre });
    setSaving(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Medio agregado — entra al scrapeo desde la próxima corrida.");
    setOpen(false);
    setDominio("");
    setNombre("");
    // El alta puede mover el conteo de la otra pestaña de medios (mismo cliente), asi que se
    // invalida su cache tambien.
    invalidateCached(`medios:${clientId}:${tipo === "monitoreado" ? "adicional" : "monitoreado"}`);
    refresh();
  }

  async function handleToggle(row: MedioRow) {
    const res = await toggleMedioActivo(row.id, !row.activo);
    if (!res.ok) return toast.error(res.error);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, activo: !r.activo } : r)));
  }

  async function handleTier(row: MedioRow, patch: { tier?: number | null; ad_value?: number | null }) {
    const nuevoTier = patch.tier !== undefined ? patch.tier : row.tier;
    const nuevoAdValue = patch.ad_value !== undefined ? patch.ad_value : row.ad_value;
    const res = await updateMedioTier(clientId, row.nombre || row.dominio, { tier: nuevoTier, ad_value: nuevoAdValue });
    if (!res.ok) return toast.error(res.error);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, tier: nuevoTier, ad_value: nuevoAdValue } : r)));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {tipo === "monitoreado"
            ? "Medios que pediste vigilar puntualmente."
            : "Medios que el sistema fue descubriendo solo."}{" "}
          {rows.length} en total.
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button size="sm" />}>
            <Plus className="size-4" /> Sumar nuevo
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Sumar medio {tipo === "monitoreado" ? "de nicho" : "general"}</DialogTitle>
              <DialogDescription>Se agrega activo — entra al scrapeo desde la próxima corrida.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Dominio</label>
                <Input value={dominio} onChange={(e) => setDominio(e.target.value)} placeholder="ejemplo.com.ar" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Nombre</label>
                <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del medio" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleAdd} disabled={saving || !dominio.trim()}>
                {saving ? "Guardando…" : "Sumar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Medio</TableHead>
              <TableHead>Dominio</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Ad Value</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.nombre || "—"}</TableCell>
                <TableCell className="max-w-md">
                  <DominioLink dominio={r.dominio} />
                </TableCell>
                <TableCell>
                  <Select
                    value={r.tier ? String(r.tier) : "none"}
                    onValueChange={(v) => handleTier(r, { tier: v === "none" ? null : Number(v) })}
                  >
                    <SelectTrigger className={"h-8 w-28 border-transparent font-medium " + tierBadgeClasses(r.tier as 1 | 2 | 3 | 4 | null)}>
                      <SelectValue>
                        {(value: string) => (
                          <span className="flex items-center gap-1.5">
                            <span className={"size-1.5 rounded-full " + tierDotClasses(value === "none" ? null : (Number(value) as 1 | 2 | 3 | 4))} />
                            {value === "none" ? "Sin asignar" : `Tier ${value}`}
                          </span>
                        )}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin asignar</SelectItem>
                      <SelectItem value="1">Tier 1</SelectItem>
                      <SelectItem value="2">Tier 2</SelectItem>
                      <SelectItem value="3">Tier 3</SelectItem>
                      <SelectItem value="4">Tier 4</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Input
                    className="h-8 w-32"
                    type="number"
                    defaultValue={r.ad_value ?? ""}
                    placeholder="Sin asignar"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      const parsed = v ? Number(v) : null;
                      if (parsed !== r.ad_value) handleTier(r, { ad_value: parsed });
                    }}
                  />
                </TableCell>
                <TableCell>
                  <EstadoBadge activo={r.activo} onClick={() => handleToggle(r)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function KeywordsTab({ clientId }: { clientId: string }) {
  const { rows, setRows, loading, refresh } = useCachedList<KeywordRow>(`keywords:${clientId}`, () =>
    listKeywords(clientId),
  );
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [grupo, setGrupo] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    setSaving(true);
    const res = await addKeyword(clientId, { keyword, grupo });
    setSaving(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Palabra clave agregada.");
    setOpen(false);
    setKeyword("");
    setGrupo("");
    // La keyword nueva cambia el contador de keywords de su seccion.
    invalidateCached(`secciones:${clientId}`);
    refresh();
  }

  async function handleToggle(row: KeywordRow) {
    const res = await toggleKeywordActiva(row.id, !row.activa);
    if (!res.ok) return toast.error(res.error);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, activa: !r.activa } : r)));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{rows.length} palabras clave.</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button size="sm" />}>
            <Plus className="size-4" /> Sumar nueva
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Sumar palabra clave</DialogTitle>
              <DialogDescription>La sección tiene que existir o coincidir con una ya cargada.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Palabra clave</label>
                <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="ej. artritis" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Sección</label>
                <Input value={grupo} onChange={(e) => setGrupo(e.target.value)} placeholder="ej. Competencia" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleAdd} disabled={saving || !keyword.trim() || !grupo.trim()}>
                {saving ? "Guardando…" : "Sumar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Palabra clave</TableHead>
              <TableHead>Sección</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.keyword}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{r.grupo}</Badge>
                </TableCell>
                <TableCell>
                  <EstadoBadge
                    activo={r.activa}
                    onClick={() => handleToggle(r)}
                    labelActivo="Activa"
                    labelInactivo="Inactiva"
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function SeccionesTab({ clientId }: { clientId: string }) {
  const { rows, setRows, loading, refresh } = useCachedList<SeccionRow>(`secciones:${clientId}`, () =>
    listSecciones(clientId),
  );
  // Misma clave que usa KeywordsTab: si ya pasaste por esa pestaña, esto no vuelve al servidor.
  const { rows: keywords, refresh: refreshKeywords } = useCachedList<KeywordRow>(
    `keywords:${clientId}`,
    () => listKeywords(clientId),
  );
  const [open, setOpen] = useState(false);
  const [nombre, setNombre] = useState("");
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    setSaving(true);
    const res = await addSeccion(clientId, nombre, selectedKeywords);
    setSaving(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Sección creada.");
    setOpen(false);
    setNombre("");
    setSelectedKeywords([]);
    // Las keywords elegidas cambiaron de sección: la lista de keywords quedó vieja.
    await Promise.all([refresh(), refreshKeywords()]);
  }

  async function handleToggle(row: SeccionRow) {
    const res = await toggleSeccionActiva(row.id, !row.activa);
    if (!res.ok) return toast.error(res.error);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, activa: !r.activa } : r)));
  }

  function toggleKeywordSelection(id: string) {
    setSelectedKeywords((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {rows.length} secciones. Son los títulos que dividen el clipping.
        </p>
        <Dialog
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) {
              setNombre("");
              setSelectedKeywords([]);
            }
          }}
        >
          <DialogTrigger render={<Button size="sm" />}>
            <Plus className="size-4" /> Sumar nueva
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Sumar sección</DialogTitle>
              <DialogDescription>
                Elegí al menos una palabra clave — una sección sin ninguna asignada queda siempre vacía en el mail.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Nombre</label>
                <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="ej. Dermatología" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Palabras clave que van a esta sección
                </label>
                <div className="max-h-48 overflow-y-auto rounded-md border p-2 space-y-1">
                  {keywords.length === 0 && (
                    <p className="text-xs text-muted-foreground px-1">No hay palabras clave todavía.</p>
                  )}
                  {keywords.map((k) => (
                    <label key={k.id} className="flex items-center gap-2 text-sm px-1 py-0.5 rounded hover:bg-muted/50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedKeywords.includes(k.id)}
                        onChange={() => toggleKeywordSelection(k.id)}
                      />
                      <span>{k.keyword}</span>
                      <span className="text-xs text-muted-foreground ml-auto">actualmente: {k.grupo}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleAdd} disabled={saving || !nombre.trim() || !selectedKeywords.length}>
                {saving ? "Guardando…" : "Sumar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Orden</TableHead>
              <TableHead>Sección</TableHead>
              <TableHead>Keywords</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-muted-foreground">{r.orden}</TableCell>
                <TableCell className="font-medium">
                  {r.nombre}
                  {r.es_exclusiva && <Badge className="ml-2" variant="secondary">Exclusiva</Badge>}
                </TableCell>
                <TableCell>
                  {r.keywords_count === 0 ? (
                    <span className="text-xs text-amber-600">0 — va a salir vacía</span>
                  ) : (
                    r.keywords_count
                  )}
                </TableCell>
                <TableCell>
                  <EstadoBadge
                    activo={r.activa}
                    onClick={() => handleToggle(r)}
                    labelActivo="Activa"
                    labelInactivo="Inactiva"
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Solo staff (dev/pm) llega a ver estas dos — KET-46.

function GoogleAlertsTab({ clientId }: { clientId: string }) {
  const { rows, setRows, loading, refresh } = useCachedList<AlertRow>(`alerts:${clientId}`, () =>
    listGoogleAlerts(clientId),
  );
  const [open, setOpen] = useState(false);
  const [tema, setTema] = useState("");
  const [urlRss, setUrlRss] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    setSaving(true);
    const res = await addGoogleAlert(clientId, { tema, url_rss: urlRss });
    setSaving(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Alerta agregada.");
    setOpen(false);
    setTema("");
    setUrlRss("");
    refresh();
  }

  async function handleToggle(row: AlertRow) {
    const res = await toggleGoogleAlertActiva(row.id, !row.activa);
    if (!res.ok) return toast.error(res.error);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, activa: !r.activa } : r)));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {rows.length} alertas de Google. El cliente no ve esta pestaña.
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button size="sm" />}>
            <Plus className="size-4" /> Sumar nueva
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Sumar Google Alert</DialogTitle>
              <DialogDescription>URL del feed RSS que genera la alerta de Google.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Tema</label>
                <Input value={tema} onChange={(e) => setTema(e.target.value)} placeholder="ej. Bristol Myers Squibb Argentina" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">URL RSS</label>
                <Input value={urlRss} onChange={(e) => setUrlRss(e.target.value)} placeholder="https://www.google.com/alerts/feeds/..." />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleAdd} disabled={saving || !tema.trim() || !urlRss.trim()}>
                {saving ? "Guardando…" : "Sumar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tema</TableHead>
              <TableHead>Feed</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.tema}</TableCell>
                <TableCell className="max-w-md">
                  <DominioLink dominio={r.url_rss} />
                </TableCell>
                <TableCell>
                  <EstadoBadge
                    activo={r.activa}
                    onClick={() => handleToggle(r)}
                    labelActivo="Activa"
                    labelInactivo="Inactiva"
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

const ESTADO_LABEL: Record<SeguimientoRow["estado"], string> = {
  pendiente: "Pendiente",
  en_revision: "En revisión",
  resuelto: "Resuelto",
  descartado: "Descartado",
};

function SeguimientoTab({ clientId }: { clientId: string }) {
  const { rows, setRows, loading, refresh } = useCachedList<SeguimientoRow>(
    `seguimiento:${clientId}`,
    () => listSeguimiento(clientId),
  );
  const [open, setOpen] = useState(false);
  const [medio, setMedio] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    setSaving(true);
    const res = await addSeguimiento(clientId, { medio, descripcion });
    setSaving(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Registrado.");
    setOpen(false);
    setMedio("");
    setDescripcion("");
    refresh();
  }

  async function handleEstado(row: SeguimientoRow, estado: SeguimientoRow["estado"]) {
    const res = await updateSeguimientoEstado(row.id, estado, row.resolucion ?? undefined);
    if (!res.ok) return toast.error(res.error);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, estado } : r)));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Medios/notas que avisaron que faltaron, fuera del sistema (Slack, mail). El cliente
          no ve esta pestaña.
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button size="sm" />}>
            <Plus className="size-4" /> Registrar
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Registrar medio/nota que faltó</DialogTitle>
              <DialogDescription>Para investigar y, si corresponde, sumarlo a la base para que no vuelva a pasar.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Medio</label>
                <Input value={medio} onChange={(e) => setMedio(e.target.value)} placeholder="Nombre del medio" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Qué avisaron</label>
                <Input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="ej. Salió una nota el 5/8 y no la vimos" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleAdd} disabled={saving || !medio.trim() || !descripcion.trim()}>
                {saving ? "Guardando…" : "Registrar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nada registrado todavía.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Medio</TableHead>
              <TableHead>Qué avisaron</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.medio}</TableCell>
                <TableCell className="max-w-md">{r.descripcion}</TableCell>
                <TableCell>
                  <Select value={r.estado} onValueChange={(v) => v && handleEstado(r, v as SeguimientoRow["estado"])}>
                    <SelectTrigger className="h-8 w-36">
                      <SelectValue>
                        {(value: string) => ESTADO_LABEL[value as SeguimientoRow["estado"]] ?? value}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ESTADO_LABEL).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
