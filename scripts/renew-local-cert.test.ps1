$ErrorActionPreference = 'Stop'
$scriptFile = Join-Path $PSScriptRoot 'renew-local-cert.ps1'
$tokens = $null
$errors = $null
[void][Management.Automation.Language.Parser]::ParseFile($scriptFile, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }

$fixture = Join-Path ([IO.Path]::GetTempPath()) ('luca-cert-test-' + [Guid]::NewGuid())
$archive = Join-Path $fixture 'letsencrypt/archive/lucaplan.cl'
$certs = Join-Path $fixture 'certs'
[void](New-Item -ItemType Directory -Path $archive, $certs)
foreach ($file in @('production.env', 'cloudflare.ini', 'compose.yml')) {
    Set-Content -LiteralPath (Join-Path $fixture $file) -Value 'test'
}
Set-Content -LiteralPath (Join-Path $certs 'fullchain.pem') -Value 'previous-certificate'
Set-Content -LiteralPath (Join-Path $certs 'privkey.pem') -Value 'previous-key'
Set-Content -LiteralPath (Join-Path $archive 'fullchain2.pem') -Value 'invalid-certificate'
Set-Content -LiteralPath (Join-Path $archive 'privkey2.pem') -Value 'invalid-key'
$script:reloadAttempted = $false
function docker {
    if ($args -contains 'reload') { $script:reloadAttempted = $true }
    $global:LASTEXITCODE = if ($args -contains '-t') { 1 } else { 0 }
}
try {
    $failed = $false
    try { & $scriptFile -SelfHostDirectory $fixture -ComposeFile (Join-Path $fixture 'compose.yml') }
    catch { $failed = $true }
    if (-not $failed -or $script:reloadAttempted) { throw 'Debe fallar sin recargar ante nginx -t fallido.' }
    if ((Get-Content -LiteralPath (Join-Path $certs 'fullchain.pem')) -ne 'previous-certificate') {
        throw 'No restauro el certificado anterior.'
    }
    if ((Get-Content -LiteralPath (Join-Path $certs 'privkey.pem')) -ne 'previous-key') {
        throw 'No restauro la llave anterior.'
    }
    Write-Output 'OK: sintaxis y rollback del par TLS cuando Nginx rechaza la renovacion.'
} finally {
    Remove-Item Function:docker
    # Solo elimina la carpeta temporal aleatoria creada por este self-check.
    $resolved = (Resolve-Path -LiteralPath $fixture).Path
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'El directorio de prueba salio de TEMP.'
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
