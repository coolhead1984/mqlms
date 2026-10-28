param(
    [switch]$Server,
    [int]$Port = 49583
)

$ErrorActionPreference = 'Stop'
if ($Server) {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    $listener.Start()

    $routes = @{
        '/' = 'index.html'
        '/index.html' = 'index.html'
        '/styles.css' = 'styles.css'
        '/app.js' = 'app.js'
        '/manifest.json' = 'manifest.json'
        '/sw.js' = 'sw.js'
        '/favicon.ico' = 'assets/icon.svg'
        '/assets/icon.svg' = 'assets/icon.svg'
        '/assets/la-casa-logo.png' = 'assets/la-casa-logo.png'
    }
    $contentTypes = @{
        '.html' = 'text/html; charset=utf-8'
        '.css' = 'text/css; charset=utf-8'
        '.js' = 'application/javascript; charset=utf-8'
        '.json' = 'application/manifest+json; charset=utf-8'
        '.svg' = 'image/svg+xml; charset=utf-8'
        '.png' = 'image/png'
    }
    $utf8 = [System.Text.Encoding]::UTF8
    $ascii = [System.Text.Encoding]::ASCII

    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $client.ReceiveTimeout = 3000
            $client.SendTimeout = 3000
            $stream = $client.GetStream()
            $request = [System.Text.StringBuilder]::new()
            while ($request.Length -lt 8192) {
                $nextByte = $stream.ReadByte()
                if ($nextByte -lt 0) { break }
                [void]$request.Append([char]$nextByte)
                if ($request.ToString().EndsWith("`r`n`r`n")) { break }
            }

            $requestLine = ($request.ToString() -split "`r?`n", 2)[0]
            $match = [regex]::Match($requestLine, '^(GET|HEAD)\s+(\S+)\s+HTTP/1\.[01]$')
            $route = if ($match.Success) {
                [uri]::UnescapeDataString(($match.Groups[2].Value -split '\?', 2)[0])
            } else {
                ''
            }

            $statusCode = 200
            $reason = 'OK'
            $body = [byte[]]@()
            $contentType = 'text/plain; charset=utf-8'

            if (-not $match.Success) {
                $statusCode = 400
                $reason = 'Bad Request'
                $body = $utf8.GetBytes('A valid GET or HEAD request is required.')
            } elseif (-not $routes.ContainsKey($route)) {
                $statusCode = 404
                $reason = 'Not Found'
                $body = $utf8.GetBytes('Not found.')
            } else {
                $fileName = $routes[$route]
                $filePath = Join-Path $PSScriptRoot $fileName
                $body = [System.IO.File]::ReadAllBytes($filePath)
                $contentType = $contentTypes[[System.IO.Path]::GetExtension($fileName)]
                if ($match.Groups[1].Value -eq 'HEAD') { $body = [byte[]]@() }
            }

            $headers = $ascii.GetBytes(
                "HTTP/1.1 $statusCode $reason`r`nContent-Length: $($body.Length)`r`n" +
                "Content-Type: $contentType`r`nConnection: close`r`n" +
                "X-Content-Type-Options: nosniff`r`n" +
                "Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' https://accounts.google.com/gsi/client; connect-src 'self' https://www.googleapis.com https://oauth2.googleapis.com https://accounts.google.com; frame-src https://accounts.google.com; form-action 'self' https://accounts.google.com; manifest-src 'self'; worker-src 'self'`r`n" +
                "Referrer-Policy: no-referrer`r`nServer: LaCasaQuoteStudio/1.0`r`n`r`n"
            )
            $stream.Write($headers, 0, $headers.Length)
            if ($body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
        } catch [System.IO.IOException] {
        } finally {
            $client.Close()
        }
    }
}

$url = "http://127.0.0.1:$Port/"
$iconPath = Join-Path $PSScriptRoot 'assets\la-casa.ico'
$applicationTitle = 'La Casa Quote Studio'

function Ensure-DesktopShortcut {
    $desktopPath = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
    $powershellPath = Join-Path $PSHOME 'powershell.exe'

    if (-not $desktopPath -or -not [System.IO.Directory]::Exists($desktopPath)) {
        throw "Could not locate the Windows Desktop folder to create the Quote Studio icon."
    }
    if (-not [System.IO.File]::Exists($iconPath)) {
        throw "The Quote Studio app icon is missing: $iconPath"
    }
    if (-not [System.IO.File]::Exists($powershellPath)) {
        throw "Could not locate Windows PowerShell to launch Quote Studio."
    }

    $shortcutPath = Join-Path $desktopPath 'La Casa Quote Studio.lnk'
    $argumentValue = '-NoLogo -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $PSCommandPath
    $shell = $null
    $shortcut = $null

    try {
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $powershellPath
        $shortcut.Arguments = $argumentValue
        $shortcut.Description = 'Open La Casa Quotation Studio as a desktop app.'
        $shortcut.WorkingDirectory = $PSScriptRoot
        $shortcut.WindowStyle = 7
        $shortcut.IconLocation = "$iconPath,0"
        $shortcut.Save()
    } catch {
        throw "Could not create the Quote Studio desktop icon at '$shortcutPath'. Check your Windows Desktop permissions. $($_.Exception.Message)"
    } finally {
        if ($shortcut -and [System.Runtime.InteropServices.Marshal]::IsComObject($shortcut)) {
            [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut)
        }
        if ($shell -and [System.Runtime.InteropServices.Marshal]::IsComObject($shell)) {
            [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
        }
    }
}

Ensure-DesktopShortcut
$existingServer = $false
$probe = [System.Net.Sockets.TcpClient]::new()
try {
    $connection = $probe.BeginConnect([System.Net.IPAddress]::Loopback, $Port, $null, $null)
    if ($connection.AsyncWaitHandle.WaitOne(400)) {
        $probe.EndConnect($connection)
        $probe.ReceiveTimeout = 1200
        $probe.SendTimeout = 1200
        $probeStream = $probe.GetStream()
        $probeBytes = [System.Text.Encoding]::ASCII.GetBytes(
            "GET / HTTP/1.1`r`nHost: 127.0.0.1`r`nConnection: close`r`n`r`n"
        )
        $probeStream.Write($probeBytes, 0, $probeBytes.Length)
        $reader = [System.IO.StreamReader]::new($probeStream, [System.Text.Encoding]::ASCII)
        $responseHeaders = $reader.ReadLine()
        while ($null -ne ($header = $reader.ReadLine()) -and $header.Length -gt 0) {
            if ($header -eq 'Server: LaCasaQuoteStudio/1.0') {
                $existingServer = $responseHeaders -match '^HTTP/1\.[01] 200 '
            }
        }
    }
} catch [System.Net.Sockets.SocketException] {
    $existingServer = $false
} catch [System.IO.IOException] {
    $existingServer = $false
} finally {
    $probe.Close()
}

if (-not $existingServer) {
    $serverArgs = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Server -Port {1}' -f $PSCommandPath, $Port
    Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -WindowStyle Hidden -ArgumentList $serverArgs | Out-Null

    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 150
        $check = [System.Net.Sockets.TcpClient]::new()
        try {
            $checkConnection = $check.BeginConnect([System.Net.IPAddress]::Loopback, $Port, $null, $null)
            if ($checkConnection.AsyncWaitHandle.WaitOne(250)) {
                $check.EndConnect($checkConnection)
                $check.SendTimeout = 500
                $check.ReceiveTimeout = 500
                $checkStream = $check.GetStream()
                $checkBytes = [System.Text.Encoding]::ASCII.GetBytes(
                    "GET / HTTP/1.1`r`nHost: 127.0.0.1`r`nConnection: close`r`n`r`n"
                )
                $checkStream.Write($checkBytes, 0, $checkBytes.Length)
                $checkReader = [System.IO.StreamReader]::new($checkStream, [System.Text.Encoding]::ASCII)
                $checkResponse = $checkReader.ReadLine()
                while ($null -ne ($checkHeader = $checkReader.ReadLine()) -and $checkHeader.Length -gt 0) {
                    if ($checkHeader -eq 'Server: LaCasaQuoteStudio/1.0') {
                        $ready = $checkResponse -match '^HTTP/1\.[01] 200 '
                    }
                }
            }
        } catch [System.Net.Sockets.SocketException] {
            $ready = $false
        } catch [System.IO.IOException] {
            $ready = $false
        } finally {
            $check.Close()
        }
        if ($ready) { break }
    }

    if (-not $ready) {
        throw "Quote Studio could not start its private server on port $Port. Please restart the application or ask for IT assistance."
    }
}

$browserCandidates = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe')
)
$browser = $browserCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1

if (-not $browser) {
    throw 'Quote Studio needs Microsoft Edge or Google Chrome to open its desktop app window. Install one of these applications and try again.'
}

if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    throw 'Quote Studio could not locate your local Windows application-data folder.'
}

$profilePath = Join-Path (Join-Path $env:LOCALAPPDATA 'La Casa Quote Studio') 'Browser Profile'
[void][System.IO.Directory]::CreateDirectory($profilePath)
$browserArguments = '--no-first-run --user-data-dir="{0}" --app="{1}"' -f $profilePath, $url
Start-Process -FilePath $browser -ArgumentList $browserArguments | Out-Null
