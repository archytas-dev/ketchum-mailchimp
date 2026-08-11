"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// Cache en memoria para las listas de la pestaña Base de Datos.
//
// Base UI desmonta el panel de la tab inactiva, asi que sin esto cada ida y vuelta entre tabs
// (o entre clientes) redispara el fetch entero -- lo que reporto Fede. Con el cache, volver a
// una tab ya visitada es instantaneo y solo se refetchea cuando algo cambio de verdad: toda
// escritura invalida su clave via `invalidateCached` o la reescribe con el dato nuevo.
//
// Vive a nivel de modulo (no de componente) para sobrevivir al desmontaje del panel; se pierde
// con el reload de la pagina, que es justamente el gesto que hace el usuario cuando si quiere
// datos frescos.
const cache = new Map<string, unknown[]>();
// Claves cuya ultima carga fallo: sin esto la tab quedaria en "Cargando…" para siempre.
const fallidas = new Set<string>();

export function invalidateCached(key: string) {
  cache.delete(key);
  fallidas.delete(key);
}

type ListResult<T> = { ok: true; data: T[] } | { ok: false; error: string };

export function useCachedList<T>(key: string, loader: () => Promise<ListResult<T>>) {
  // El estado real vive en el cache; esto solo fuerza el re-render cuando el cache cambia.
  const [, forceRender] = useState(0);
  const bump = () => forceRender((n) => n + 1);

  // El loader es una closure nueva en cada render. Se guarda en un ref (actualizado en un
  // efecto, no en render) para que el efecto de carga dependa solo de la clave.
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  });

  useEffect(() => {
    if (cache.has(key) || fallidas.has(key)) return;
    let alive = true;
    loaderRef.current().then((res) => {
      if (!alive) return;
      if (res.ok) cache.set(key, res.data);
      else {
        fallidas.add(key);
        toast.error(res.error);
      }
      bump();
    });
    return () => {
      alive = false;
    };
  }, [key]);

  const cached = cache.get(key) as T[] | undefined;

  // Actualiza cache y vista a la vez: los toggles optimistas no tienen que volver al servidor.
  function setRows(update: T[] | ((cur: T[]) => T[])) {
    const cur = (cache.get(key) as T[] | undefined) ?? [];
    const next = typeof update === "function" ? (update as (c: T[]) => T[])(cur) : update;
    cache.set(key, next);
    bump();
  }

  // Para despues de un alta: la fila nueva la arma el servidor (id, defaults), no la app.
  async function refresh() {
    const res = await loaderRef.current();
    if (!res.ok) return toast.error(res.error);
    fallidas.delete(key);
    cache.set(key, res.data);
    bump();
  }

  return {
    rows: cached ?? [],
    setRows,
    loading: cached === undefined && !fallidas.has(key),
    refresh,
  };
}
