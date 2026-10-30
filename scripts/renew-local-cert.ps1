param(
    [string]$SelfHostDirectory = 'C:/Users/welli/selfhost/lucaplan',
    [string]$ComposeFile = (Join-Path $PSScriptRoot '../compose.production.yml'),
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
function Invoke-Docker {
    & docker @args
    if ($LASTEXITCODE -ne 0) { throw "Docker fallo ($LASTEXITCODE): $($args[0])" }
}

$root = (Resolve-Path -LiteralPath $SelfHostDirectory).Path
$config = Join-Path $root 'production.env'
$credentials = Join-Path $root 'cloudflare.ini'
$letsencrypt = Join-Path $root 'letsencrypt'
$certs = Join-Path $root 'certs'
foreach ($path in @($config, $credentials, $letsencrypt, $certs, $ComposeFile)) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Falta $path" }
}

$renew = @('run', '--rm', '--mount', "type=bind,source=$letsencrypt,target=/etc/letsencrypt",
    '--mount', "type=bind,source=$credentials,target=/run/secrets/cloudflare.ini,readonly",
    'certbot/dns-cloudflare:latest', 'renew', '--cert-name', 'lucaplan.cl', '--non-interactive',
    '--dns-cloudflare', '--dns-cloudflare-credentials', '/run/secrets/cloudflare.ini',
    '--dns-cloudflare-propagation-seconds', '60')
if ($DryRun) { $renew += '--dry-run' }
Invoke-Docker @renew
if ($DryRun) { return }

# archive evita los symlinks de live, que Docker/Windows no siempre resuelven igual.
$archive = Join-Path $letsencrypt 'archive/lucaplan.cl'
$chain = Get-ChildItem -LiteralPath $archive -Filter 'fullchain*.pem' |
    Where-Object { $_.BaseName -match '^fullchain\d+$' } |
    Sort-Object { [int]($_.BaseName -replace '^fullchain', '') } -Descending |
    Where-Object { Test-Path -LiteralPath (Join-Path $archive ($_.Name -replace '^fullchain', 'privkey')) } |
    Select-Object -First 1
if (-not $chain) { throw 'No hay una pareja completa de certificado y llave en archive.' }
$sources = @($chain.FullName, (Join-Path $archive ($chain.Name -replace '^fullchain', 'privkey')))
$targets = @((Join-Path $certs 'fullchain.pem'), (Join-Path $certs 'privkey.pem'))
$previous = @($targets | ForEach-Object { [Convert]::ToBase64String([IO.File]::ReadAllBytes($_)) })
$changed = $false
for ($i = 0; $i -lt 2; $i++) {
    if ((Get-FileHash -LiteralPath $sources[$i]).Hash -ne (Get-FileHash -LiteralPath $targets[$i]).Hash) {
        $changed = $true
    }
}
if (-not $changed) { Write-Output 'Certificado vigente sin cambios.'; return }

$compose = @('compose', '--env-file', $config, '-f', $ComposeFile, 'exec', '-T', 'proxy')
try {
    for ($i = 0; $i -lt 2; $i++) { Copy-Item -LiteralPath $sources[$i] -Destination $targets[$i] -Force }
    Invoke-Docker @compose nginx -t
    Invoke-Docker @compose nginx -s reload
    Write-Output 'Certificado actualizado y Nginx recargado.'
} catch {
    for ($i = 0; $i -lt 2; $i++) {
        [IO.File]::WriteAllBytes($targets[$i], [Convert]::FromBase64String($previous[$i]))
    }
    throw
}
