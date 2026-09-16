# Arnés de golden v3 ↔ v4

El arnés es `scripts/golden-diff.mjs`. Lee el clipping real que produjo la v3 en
`clippings` + `notes` y lo cruza con los veredictos `entra=true` de la v4 en
`candidatas_veredicto` + `candidatas_raw`.

La comparación usa, en este orden:

1. `url_canonica`, con la misma forma que Supabase (`host/path`, sin protocolo y
   sin parámetros de tracking).
2. título normalizado + dominio, necesario para los redirects de Google News
   cuyo token RSS no se puede reconstruir desde `notes.url`.

## Uso

El `.env.local` del proyecto apunta al proxy local de desarrollo. El arnés es
un cliente local y por eso necesita saber a qué Supabase conectarse; esas
variables no son configuración de n8n ni se comparten con sus Credentials.

Para consultar
Ketchum hay que sobreescribir la URL y la clave pública de Ketchum en el entorno:

```powershell
$env:KETCHUM_SUPABASE_URL = 'https://banlcbewinpjtudzdzhm.supabase.co'
$env:KETCHUM_SUPABASE_ANON_KEY = '<publishable-key-de-Ketchum>'
npm run golden -- --client booking --date 2026-09-08 --mode test
```

La clave pública solo funciona si las políticas RLS permiten al rol de la
sesión leer estas tablas. En Ketchum, el ledger y el pool están protegidos
contra ese acceso directo; por eso el primer golden se ejecutó mediante la
consulta privilegiada de Supabase, sin guardar una service key en el repo.
No hay que agregar una service key a `.env.local` ni commitearla.

Clientes disponibles: `bms`, `booking`, `mars`, `msd`. Para automatizar el
reporte se puede agregar `--json`.

El resultado incluye `solo v3`, `solo v4`, matches por URL y matches por
título+dominio. Si la corrida v4 tiene `candidatas_es_muestra=true`, el reporte
lo marca explícitamente: es un diagnóstico de la muestra y no un golden de
cobertura completa.

## Estado de la validación

El 08/09 se comprobó en `ketchum-n8n` que `armado-cliente` ya procesa A2 en
lotes de 12 y ejecuta cada lote como una subcorrida independiente. La prueba de
MSD con 25 candidatas devolvió 25 veredictos guardados, cero repetidos y cerró
sin timeout. El armado completo ya materializa el pool y lo pagina en lotes de
200; el limite explicito de 25 solo queda para pruebas controladas. Sigue sin
ser un golden hasta ejecutar una corrida completa y comparar todas sus decisiones.

## Arquitectura anti-OOM

La migracion `20260908193000_v4_paginas_independientes_anti_oom.sql` agrega una
fila por pagina en `pipeline_run_pages`, un cursor en `pipeline_runs` y dos RPC:
`v4_tomar_pagina` reclama hasta 200 candidatas con lease, y
`v4_terminar_pagina` confirma el avance solo cuando todas tienen veredicto.

El workflow `ORrmePsGxJJxISTo` procesa una sola pagina por ejecucion. Al
confirmarla dispara `POST /webhook/v4-armado` con `rehacer=false` y termina su
propia ejecucion. Asi n8n conserva aproximadamente 200 items por ejecucion,
no el historial de todo el pool. Si una ejecucion cae, el lease vence y la
pagina se puede reintentar sin avanzar el cursor prematuramente.
