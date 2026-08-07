# Genera supabase/seed.sql con datos del proyecto remoto, para desarrollar contra una
# copia local realista.
#
# QUE SE COPIA (y por que):
#   - Config real: kw_keywords, google_alerts, medios, tiers, tier_defaults, secciones,
#     gacetillas, gacetilla_capturas. Es exactamente lo que administra la pestania
#     "Base de Datos" (KET-45/46), y no es dato sensible: son listados de medios,
#     palabras clave y gacetillas de prensa ya publicadas.
#   - Clippings + notes SOLO de los 4 clientes *-test. Son datos que generamos nosotros
#     en las corridas de prueba de los workflows v3, no contenido real de Ketchum.
#
# QUE NO SE COPIA (a proposito):
#   - clippings/notes de los 4 clientes REALES: es el trabajo diario de Fedra, no hace
#     falta para construir estas pestanias (mandamiento #4: no probar contra datos del cliente).
#   - profiles / auth.users / user_client_access: mails de personas reales. En local se
#     crea un usuario dev sintetico aparte (ver scripts/seed-local-user.ps1).
#   - Telemetria (activity, run_stats, notas_descartadas, exports, export_metrics).
#
# Uso: powershell -ExecutionPolicy Bypass -File scripts/pull-remote-seed.ps1

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot '.env.mgmt'
if (-not (Test-Path $envFile)) { throw "Falta .env.mgmt con SUPABASE_ACCESS_TOKEN" }
$token = ((Get-Content $envFile | Where-Object { $_ -match '^SUPABASE_ACCESS_TOKEN=' }) -replace '^SUPABASE_ACCESS_TOKEN=', '').Trim()
if (-not $token) { throw "SUPABASE_ACCESS_TOKEN vacio" }
$projectRef = (Get-Content (Join-Path $repoRoot 'supabase/.temp/project-ref')).Trim()

function Invoke-RemoteSql([string]$sql) {
  $body = @{ query = $sql } | ConvertTo-Json -Compress -Depth 5
  # Ver nota en pull-remote-migrations.ps1: Invoke-RestMethod en PS 5.1 no decodifica UTF-8
  # y arruina los acentos. Los datos de config estan llenos de acentos (nombres de medios,
  # titulos de gacetillas, secciones tipo "Onco Hematologia"), asi que esto es critico aca.
  $raw = Invoke-WebRequest -Method Post -UseBasicParsing `
    -Uri "https://api.supabase.com/v1/projects/$projectRef/database/query" `
    -Headers @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' } `
    -Body $body
  return [System.Text.Encoding]::UTF8.GetString($raw.RawContentStream.ToArray()) | ConvertFrom-Json
}

# Orden respetando FKs. `where` opcional por tabla.
$tables = @(
  # clients va primero y se REEMPLAZA por completo. Dos razones:
  #  1) La migracion `seed_clients` inserta los clientes SIN id, asi que cada entorno genera
  #     sus propios UUIDs con gen_random_uuid(). Los UUIDs de produccion son un accidente
  #     historico de cuando corrio esa migracion alla. Pero TODO referencia los UUIDs reales:
  #     los datos de config, y los workflows de n8n que los tienen hardcodeados
  #     (Prep Supabase Rows, Leer Precarga Pendiente, los PATCH a medios...). Si local usa
  #     otros ids, el seed explota por FK y nada de lo que probemos se parece a produccion.
  #  2) Deriva real: `bms-test` se creo a mano antes de las migraciones y no esta en ninguna,
  #     asi que sin esto el entorno local queda con 7 de los 8 clientes.
  # El delete es seguro porque corre antes de cargar cualquier dato que dependa de clients.
  @{ name = 'clients';            where = ''; replaceAll = $true },
  @{ name = 'kw_keywords';        where = '' },
  @{ name = 'google_alerts';      where = '' },
  @{ name = 'medios';             where = '' },
  @{ name = 'tiers';              where = '' },
  @{ name = 'tier_defaults';      where = '' },
  @{ name = 'secciones';          where = '' },
  @{ name = 'gacetillas';         where = '' },
  @{ name = 'gacetilla_capturas'; where = '' },
  @{ name = 'clippings';          where = "where client_id in (select id from clients where slug like '%-test')" },
  @{ name = 'notes';              where = "where clipping_id in (select id from clippings where client_id in (select id from clients where slug like '%-test'))" }
)

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("-- GENERADO por scripts/pull-remote-seed.ps1 - no editar a mano.")
[void]$sb.AppendLine("-- Copia de config real del proyecto Ketchum remoto para desarrollo local.")
[void]$sb.AppendLine("-- Ver el encabezado del script para que se copia y que NO.")
[void]$sb.AppendLine("")

foreach ($t in $tables) {
  $name = $t.name
  # to_jsonb por fila -> array JSON. coalesce para tabla vacia.
  $q = "select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text as j from (select * from public.$name $($t.where)) t"
  $res = Invoke-RemoteSql $q
  $json = $res[0].j
  if ($json -match '\$seed\$') { throw "La data de $name contiene el delimitador \$seed\$; cambiar el dollar-quoting." }
  $rows = ([regex]::Matches($json, '(?<!\\)\{')).Count  # aproximado, solo para el log
  [void]$sb.AppendLine("-- $name")
  if ($t.replaceAll) {
    [void]$sb.AppendLine("-- Se reemplaza por completo para que los ids coincidan con produccion (ver script).")
    [void]$sb.AppendLine("delete from public.$name;")
  }
  [void]$sb.AppendLine("insert into public.$name")
  [void]$sb.AppendLine("select * from jsonb_populate_recordset(null::public.$name, `$seed`$$json`$seed`$::jsonb)")
  [void]$sb.AppendLine("on conflict do nothing;")
  [void]$sb.AppendLine("")
  Write-Output ("{0,-20} {1,8} chars json" -f $name, $json.Length)
}

$outPath = Join-Path $repoRoot 'supabase/seed.sql'
[System.IO.File]::WriteAllText($outPath, $sb.ToString(), (New-Object System.Text.UTF8Encoding($false)))
Write-Output "--- seed.sql escrito ($([math]::Round((Get-Item $outPath).Length/1KB,1)) KB) ---"
