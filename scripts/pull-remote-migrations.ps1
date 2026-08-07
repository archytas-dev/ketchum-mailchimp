# Baja el SQL de las migraciones ya aplicadas en el proyecto remoto y las escribe
# como archivos locales en supabase/migrations/, para poder reproducir el schema real
# en el Supabase local sin necesitar la password de la base (el `supabase link` no
# interactivo no la captura, y `db pull`/`db dump` no funcionan sin ella).
#
# Fuente: supabase_migrations.schema_migrations en el remoto, leido via Management API.
# Uso: pwsh scripts/pull-remote-migrations.ps1

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot '.env.mgmt'
if (-not (Test-Path $envFile)) { throw "Falta .env.mgmt con SUPABASE_ACCESS_TOKEN" }

$token = (Get-Content $envFile | Where-Object { $_ -match '^SUPABASE_ACCESS_TOKEN=' }) -replace '^SUPABASE_ACCESS_TOKEN=', ''
$token = $token.Trim()
if (-not $token) { throw "SUPABASE_ACCESS_TOKEN vacio en .env.mgmt" }

$projectRef = (Get-Content (Join-Path $repoRoot 'supabase/.temp/project-ref')).Trim()
$outDir = Join-Path $repoRoot 'supabase/migrations'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$sql = @'
select version, name, array_to_string(statements, E';\n') as sql
from supabase_migrations.schema_migrations
order by version
'@

$body = @{ query = $sql } | ConvertTo-Json -Compress

# OJO: Invoke-RestMethod en Windows PowerShell 5.1 NO decodifica la respuesta como UTF-8
# (asume ISO-8859-1 si el header no trae charset), y los acentos llegan como mojibake
# ("MigraciÃ³n"). Eso no es solo cosmetico: hay migraciones con acentos DENTRO del SQL
# (ej. un translate() que saca acentos para deduplicar en precarga_notes_infra), asi que
# corromperlos rompe logica real. Por eso se leen los bytes crudos y se decodifican a mano.
$raw = Invoke-WebRequest -Method Post -UseBasicParsing `
  -Uri "https://api.supabase.com/v1/projects/$projectRef/database/query" `
  -Headers @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' } `
  -Body $body
$resp = [System.Text.Encoding]::UTF8.GetString($raw.RawContentStream.ToArray()) | ConvertFrom-Json

# Fixups para que las migraciones sean PORTABLES (aplicables en un entorno limpio).
# El remoto tiene statements que insertan perfiles de usuarios reales por UUID; esos UUIDs
# solo existen en auth.users de produccion, asi que en local el insert viola el FK y el
# `supabase start` aborta. Se los envuelve en un `where exists` para que sean no-op donde el
# usuario no existe. En prod el efecto es identico (el usuario si existe).
function Convert-ToPortableSql([string]$sql) {
  $pattern = "(?ms)insert\s+into\s+profiles\s*\(\s*id\s*,\s*nombre\s*,\s*rol\s*\)\s*values\s*\(\s*'([0-9a-f-]{36})'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)\s*on\s+conflict\s*\(\s*id\s*\)\s*do\s+update\s+set\s+rol\s*=\s*'([^']*)'"
  return [regex]::Replace($sql, $pattern, {
    param($m)
    $id = $m.Groups[1].Value; $nombre = $m.Groups[2].Value
    $rol = $m.Groups[3].Value; $rolUpd = $m.Groups[4].Value
    @"
insert into profiles (id, nombre, rol)
select '$id', '$nombre', '$rol'
where exists (select 1 from auth.users u where u.id = '$id')  -- [portabilidad] no-op si el usuario no existe (entornos limpios / local)
on conflict (id) do update set rol = '$rolUpd'
"@
  })
}

$n = 0
$patched = 0
foreach ($row in $resp) {
  $fileName = "$($row.version)_$($row.name).sql"
  $path = Join-Path $outDir $fileName
  # El campo statements ya trae el SQL sin el ';' final de cada statement.
  $content = $row.sql
  $before = $content
  $content = Convert-ToPortableSql $content
  if ($content -ne $before) { $patched++; Write-Output "  [portabilidad] guardado insert a profiles en $fileName" }
  if (-not $content.TrimEnd().EndsWith(';')) { $content = $content.TrimEnd() + ';' }
  [System.IO.File]::WriteAllText($path, $content + "`n", (New-Object System.Text.UTF8Encoding($false)))
  $n++
  Write-Output "$fileName  ($($content.Length) chars)"
}
Write-Output "--- $n migraciones escritas en supabase/migrations/ ---"
