-- Bug encontrado al probar con datos reales: "Karol G y Bruno Mars se ponen cariñosos"
-- entraba como PRIORITARIA para Mars. La regla de marca (\ymars\y) es entra_si_o_si y
-- se evalúa primero, así que ganaba sobre la regla de farándula.
--
-- El arreglo NO es hacer el regex más astuto (lookbehind no existe en POSIX y además
-- el problema volvería con el próximo caso ambiguo). Es reconocer que hay DOS clases
-- de descarte duro y que no tienen la misma precedencia:
--
--   'no_entra_nunca'  -> el tema no le sirve al cliente. La marca gana: si la nota
--                        menciona al cliente, entra igual.
--   'desambiguacion'  -> la palabra que parece la marca NO es la marca (Bruno Mars,
--                        el planeta Marte, el escritor Roemmers). Gana sobre todo,
--                        porque si no la marca nunca fue mencionada de verdad.
--
-- Sin esta distinción, toda marca ambigua es una puerta abierta.

alter table public.reglas_filtro drop constraint if exists reglas_filtro_compuerta_check;
alter table public.reglas_filtro add constraint reglas_filtro_compuerta_check
  check (compuerta in ('entra_si_o_si','no_entra_nunca','puntua','desambiguacion'));

-- Las tres reglas que son desambiguación de marca, no filtro de tema.
update public.reglas_filtro
set compuerta = 'desambiguacion',
    motivo = motivo || ' — se evalúa ANTES que entra_si_o_si: la palabra parece la marca pero no lo es',
    updated_at = now()
where compuerta = 'no_entra_nunca'
  and (valor ~ 'bruno\\s\\+mars' or valor ~ 'Alejandro\\\\s\\+Roemmers');

comment on column public.reglas_filtro.compuerta is
  'entra_si_o_si: ninguna otra regla la puede sacar · no_entra_nunca: descarte duro por tema, pero la marca del cliente le gana · desambiguacion: la palabra parece la marca y no lo es (Bruno Mars, el planeta Marte, el escritor Roemmers) — gana sobre TODO, incluido entra_si_o_si · puntua: suma o resta, no decide sola';
