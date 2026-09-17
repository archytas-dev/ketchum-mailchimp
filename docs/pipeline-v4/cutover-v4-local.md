# Cutover local v4 -> herramienta Ketchum

Estado al 17/09/2026: **preparación local**. No habilitar a Fedra, no cambiar
destinatarios reales, no activar Slack y no escribir sobre las entidades de
entrega de v3.

## Decisiones ya tomadas

- La primera cuenta interna que operará el plano `public_v4` será
  `testv4@archytas.io`. Su contraseña inicial se entrega por un canal seguro;
  no se versiona ni se copia en scripts, documentación o workflows.
- Cuando Fedra pase a v4, v3 seguirá disponible únicamente como respaldo:
  conservará sus tablas y sus workflows legacy, pero sus envíos irán sólo a
  `adrian@archytas.io`, nunca a Fedra ni a clientes.
- v3 seguirá escribiendo exclusivamente sus propias tablas legacy; v4 escribirá
  exclusivamente `public_*_v4`. Comparten el mismo proyecto Supabase, no los
  resultados operativos ni sus estados de envío.
- Los permisos editoriales quedan como hoy: sólo usuarios internos autorizados
  pueden modificar la configuración compartida.
- Las fallas de la instancia AWS de Ketchum se reportarán con el Error Handler
  Global mediante `POST https://archytasai.app.n8n.cloud/webhook/error-aws`,
  usando `cliente: "ketchum"`. Por convención llega a Slack
  `#customer-ketchum`, igual que v3.

## Decisión de arquitectura vigente

La v4 **comparte la configuración editorial vigente** con la v3. No se clonarán
keywords, secciones ni Google Alerts: son la misma definición de qué busca cada
cliente y deben tener una única fuente de verdad.

- La v4 lee `public.kw_keywords`, `public.secciones` y
  `public.google_alerts`.
- Mientras Fedra opere sobre v3, la cuenta interna v4 las ve sólo en lectura:
  ningún test puede cambiar lo que usa v3.
- Cuando v3 quede desactivada y Fedra pase a v4, v4 podrá editar esa misma
  configuración compartida. No habrá copia que luego pueda quedar desalineada.
- Medios, suscripciones y valorización continúan en el modelo v4 por dominio.
  No se vuelve a `public.medios` ni a los matchings frágiles por nombre de la
  v3.
- Lo que sí queda aislado es el resultado operativo: clipping, notas, precarga,
  actividad, exportaciones, resúmenes, reportes y trazabilidad.

## Verificado hoy

| Superficie | Plano v4 | Estado |
|---|---|---|
| Principal `/hoy` y export desde ahí | `test.clippings_v4`, `notes_v4`, `exports_v4`, `activity_v4`, `summaries_v4` | Conectado; falta una exportación real de prueba para poblar métricas |
| Historial | `test.clippings_v4`, `notes_v4`, `exports_v4` | Lista y renderiza v4; el editor histórico aún no está migrado |
| Estadísticas | tablas de entrega `test.*_v4` | Conectado; por eso hoy muestra 0 ediciones/exportaciones |
| Actividad | corridas, trazas y cobertura v4 | Conectado; el snapshot debe correr al cierre de cada run |
| Reporte de errores | `test.reportes_v4` | Conectado y aislado; falta prueba de alta/resolución |
| Base de Datos: medios / valor | catálogo, suscripción y valorización v4 | Conectado y editable sin tocar v3 |
| Base de Datos: keywords / secciones / alerts | configuración compartida de v3 | Lectura v4; escritura bloqueada hasta el corte |

## Verificación local del plano `public_v4`

- Las ocho tablas de entrega `public.*_v4` ya se crearon y validaron en Docker
  local: RLS está activa y forzada en todas; `anon` no tiene privilegios SQL;
  y no hay claves foráneas hacia `public.clippings`, `public.notes` ni `test`.
- El selector ya puede reconocer `app_metadata.ketchum_data_plane = public_v4`.
  Ese atributo lo asigna sólo un administrador de Supabase, nunca el navegador.
  Fedra no tiene ese atributo y por defecto sigue en v3.
- **Bloqueo intencional antes de crear `testv4@archytas.io`:** Actividad,
  cobertura, trazas y repesca ya tienen sus proyecciones aisladas en
  `public.v4_*_public`. El guardador `v4_public_guardar_clipping_run(run_id)`
  persiste esa foto junto al clipping, antes del mail. Falta una ejecución
  real controlada para validar el contenido de la foto, no su estructura.

### Evidencia local 17/09

- `supabase db reset --local` aplicó desde cero las migraciones de entrega y
  proyección `20260917150000` y `20260917153000`.
- La fixture canónica BMS se importó en `public_v4`: 6 notas, orden global
  1..6 y una URL repetida descartada. Cuatro notas conservaron tier y ad value.
- La reimportación fue idempotente: `public_v4` siguió con un clipping y seis
  notas. Los conteos legacy antes/después fueron idénticos: 6 clippings, 302
  notas y 0 actividades.
- Pendiente: ejecutar `v4_public_guardar_clipping_run(run_id)` con una corrida
  v4 real para validar los datos de Actividad, y probar RLS con sesiones reales.

- RLS simulada localmente: un cliente no pudo ver una fixture de otro cliente;
  el usuario interno sí pudo verla; y, al importar temporalmente una fixture
  para BMS, el cliente BMS vio exactamente un clipping propio. Las pruebas se
  ejecutaron dentro de transacciones con rollback.

## Orden obligatorio

1. **Cerrar el editor histórico antes de habilitarlo.**
   - Las lecturas, excluir, reordenar, pintar, exportar y actividad ya usan
     `tabla()` y Server Actions en local. Falta agregar nota individual y
     confirmar la precarga masiva contra el plano v4.
   - Probar que un ID v4 no puede escribir `public.notes`, `public.activity`,
     `public.exports` ni `public.clippings`.

2. **Mantener una configuración editorial compartida y protegida.**
   - v4 debe seguir leyendo keywords, secciones y Google Alerts desde `public`.
   - No crear copias `*_v4`, no copiar snapshots y no cambiar n8n para otra
     tabla de configuración.
   - En modo interno, comprobar que las pantallas no ofrecen escritura sobre
     esa configuración. Cualquier alta o cambio debe hacerse aún por v3.
   - Antes del corte final, habilitar la edición de esa misma configuración en
     v4 y probarla con una modificación reversible, sólo cuando v3 ya no sea
     la operación activa.

3. **Crear entrega real v4, separada de test y de v3.**
   - Crear `public_*_v4` con la misma forma, RLS, índices y policies de
     `test.*_v4`. No reutilizar `public.clippings` ni `public.notes`.
   - Parametrizar el importador: `test` para pruebas y `public_v4` para la
     operación v4. Rechazar cualquier otro destino.
   - Importar antes de enviar el mail; el mail, `/hoy` e Historial deben salir
     de la misma foto guardada.

4. **Selector de plano por usuario/cliente, reversible.**
   - Mantener Fedra en v3 hasta que el paso 5 esté aprobado.
   - Agregar un flag de plano por usuario/cliente en servidor; el navegador no
     puede elegir schema ni plano.
   - Activar primero `testv4@archytas.io` sobre `public_v4`; luego Fedra. El
     rollback es cambiar el flag, nunca copiar ni borrar datos.
   - Al activar Fedra en v4, dejar v3 disponible solamente para Archytas con
     destinatarios internos. No usarla para enviar a Fedra o clientes.

5. **Prueba de corte antes de notificar a nadie.**
   - Cuatro corridas end-to-end sobre `public_v4` con mails internos.
   - Confirmar: mail = `/hoy` = Historial = Estadísticas = Actividad.
   - Confirmar que las tablas de entrega v3 no cambiaron con snapshots
     antes/después.
   - Confirmar una precarga individual, una masiva, una edición, una
     exportación y un reporte de error.
   - Confirmar que la v4 usa las mismas keywords, secciones y Alerts activas
     que v3, sin permitir que la prueba las modifique.

6. **Último paso, fuera del código local.**
   - Crear/configurar el mini-flujo Error Workflow de la instancia AWS de
     Ketchum: `Error Trigger` -> `Code` con `cliente: "ketchum"` -> `POST`
     al Error Handler Global. Dejarlo como error workflow global de la
     instancia y verificar un aviso en `#customer-ketchum`.
   - Cambiar destinatarios de los cuatro clippings a usuarios reales de
     Ketchum.
   - Habilitar Fedra y dejar v3 desactivada sólo después de aprobación explícita
     del resultado del paso 5.

## Regla de seguridad

Mientras este documento diga “preparación local”, está prohibido ejecutar una
migración o workflow que modifique las entregas v3: `public.clippings`,
`public.notes`, `public.notes_precarga`, `public.activity`, `public.exports`,
`public.summaries` o `public.reportes`.

También está prohibido desde la cuenta de prueba modificar la configuración
compartida: `public.kw_keywords`, `public.secciones` y
`public.google_alerts`. La lectura es deliberadamente compartida; la escritura
se habilita recién en el corte final, cuando v3 deje de operar.
