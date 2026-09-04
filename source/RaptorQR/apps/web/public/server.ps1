# Transfer Hub portable static server.
# Uses Windows built-in .NET HttpListener — no Python/Node/third-party install required.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# Pick a free port between 8765 and 8999 (deliberately avoids 8080).
$listener = $null
$port = 0
for ($attempt = 0; $attempt -lt 100; $attempt++) {
    $candidate = Get-Random -Minimum 8765 -Maximum 8999
    $test = New-Object System.Net.HttpListener
    $test.Prefixes.Add("http://127.0.0.1:$candidate/")
    try {
        $test.Start()
        $listener = $test
        $port = $candidate
        break
    } catch {
        try { $test.Close() } catch {}
    }
}
if (-not $listener) {
    Write-Host "Unable to find a free port." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

$mime = @{
    '.html'        = 'text/html; charset=utf-8'
    '.js'          = 'text/javascript; charset=utf-8'
    '.mjs'         = 'text/javascript; charset=utf-8'
    '.css'         = 'text/css; charset=utf-8'
    '.json'        = 'application/json'
    '.webmanifest' = 'application/manifest+json'
    '.wasm'        = 'application/wasm'
    '.svg'         = 'image/svg+xml'
    '.png'         = 'image/png'
    '.ico'         = 'image/x-icon'
    '.txt'         = 'text/plain; charset=utf-8'
    '.md'          = 'text/plain; charset=utf-8'
    '.ps1'         = 'text/plain'
    '.bat'         = 'text/plain'
    '.zip'         = 'application/zip'
}

Write-Host ""
Write-Host "  Transfer Hub 便携版已启动" -ForegroundColor Green
Write-Host "  本机访问地址: http://127.0.0.1:$port/" -ForegroundColor Cyan
Write-Host "  内网分享: 让其它设备访问本机局域网 IP 的端口 $port"
Write-Host "            (摄像头接收需要 HTTPS，普通 HTTP 仅供发送与 GIF 接收)"
Write-Host "  关闭此窗口即停止服务。" -ForegroundColor Yellow
Write-Host ""
try { Start-Process "http://127.0.0.1:$port/" } catch {}

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $response = $context.Response
    try {
        $request = $context.Request
        $relative = [Uri]::UnescapeDataString($request.Url.AbsolutePath).TrimStart('/')
        if ($relative -eq '') { $relative = 'index.html' }
        $file = [IO.Path]::GetFullPath((Join-Path $root $relative))
        $rootFull = [IO.Path]::GetFullPath($root)
        if (-not $file.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
            $file = Join-Path $rootFull 'index.html'
        }
        if (Test-Path $file -PathType Container) { $file = Join-Path $file 'index.html' }
        if (-not (Test-Path $file)) {
            $response.StatusCode = 404
            $response.Close()
            continue
        }
        $ext = [IO.Path]::GetExtension($file).ToLower()
        $contentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
        $bytes = [IO.File]::ReadAllBytes($file)
        $response.ContentType = $contentType
        $response.ContentLength64 = $bytes.Length
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch {
        $response.StatusCode = 500
    } finally {
        try { $response.Close() } catch {}
    }
}
