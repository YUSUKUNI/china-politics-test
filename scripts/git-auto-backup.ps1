param(
    [int]$IntervalSeconds = 20,
    [int]$QuietSeconds = 20,
    [switch]$Once
)

$ErrorActionPreference = "Continue"
$repoPath = Split-Path -Parent $PSScriptRoot
$logPath = Join-Path $repoPath ".git\auto-backup.log"
$lockPath = Join-Path $repoPath ".git\auto-backup.lock"

$gitCommand = (Get-Command git.exe -ErrorAction SilentlyContinue).Source
if (-not $gitCommand) {
    $gitCommand = "D:\Git\cmd\git.exe"
}

$env:GIT_TERMINAL_PROMPT = "0"
$env:GCM_INTERACTIVE = "never"

function Write-Log {
    param([string]$Message)
    $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

function Invoke-RepoGit {
    param([string[]]$GitArguments)
    $output = & $gitCommand -C $repoPath @GitArguments 2>&1
    return [PSCustomObject]@{
        ExitCode = $LASTEXITCODE
        Output = @($output)
    }
}

if (Test-Path -LiteralPath $logPath) {
    $logItem = Get-Item -LiteralPath $logPath
    if ($logItem.Length -gt 1MB) {
        Remove-Item -LiteralPath $logPath -Force
    }
}

if (Test-Path -LiteralPath $lockPath) {
    $existingPid = 0
    [void][int]::TryParse((Get-Content -LiteralPath $lockPath -Raw).Trim(), [ref]$existingPid)
    if ($existingPid -gt 0 -and (Get-Process -Id $existingPid -ErrorAction SilentlyContinue)) {
        Write-Log "Backup watcher already running (PID $existingPid)."
        exit 0
    }
    Remove-Item -LiteralPath $lockPath -Force
}

Set-Content -LiteralPath $lockPath -Value $PID -Encoding ASCII
Write-Log "Backup watcher started (PID $PID, interval ${IntervalSeconds}s, quiet ${QuietSeconds}s)."

try {
    $branchResult = Invoke-RepoGit @("branch", "--show-current")
    $branch = (($branchResult.Output | ForEach-Object { $_.ToString() }) -join "").Trim()
    if (-not $branch) {
        $branch = "main"
    }

    $lastFingerprint = ""
    $lastChangeAt = Get-Date

    while ($true) {
        $statusResult = Invoke-RepoGit @("status", "--porcelain=v1")
        $statusText = (($statusResult.Output | ForEach-Object { $_.ToString() }) -join "`n").Trim()

        if ($statusResult.ExitCode -ne 0) {
            Write-Log "git status failed: $statusText"
        }
        elseif ($statusText) {
            $shouldCommit = $false
            if ($Once) {
                $shouldCommit = $true
            }
            elseif ($statusText -ne $lastFingerprint) {
                $lastFingerprint = $statusText
                $lastChangeAt = Get-Date
                Write-Log "Detected changes; waiting for files to settle."
            }
            elseif (((Get-Date) - $lastChangeAt).TotalSeconds -ge $QuietSeconds) {
                $shouldCommit = $true
            }

            if ($shouldCommit) {
                $addResult = Invoke-RepoGit @("add", "-A")
                if ($addResult.ExitCode -ne 0) {
                    Write-Log "git add failed: $((($addResult.Output | ForEach-Object { $_.ToString() }) -join "`n").Trim())"
                }
                else {
                    $stagedResult = Invoke-RepoGit @("diff", "--cached", "--quiet")
                    if ($stagedResult.ExitCode -eq 1) {
                        $message = "Auto backup: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
                        $commitResult = Invoke-RepoGit @("commit", "-m", $message)
                        if ($commitResult.ExitCode -eq 0) {
                            Write-Log "Committed $message"
                            $lastFingerprint = ""
                        }
                        else {
                            Write-Log "git commit failed: $((($commitResult.Output | ForEach-Object { $_.ToString() }) -join "`n").Trim())"
                        }
                    }
                }
            }
        }
        else {
            $lastFingerprint = ""
        }

        $aheadResult = Invoke-RepoGit @("rev-list", "--count", "origin/$branch..HEAD")
        $aheadText = (($aheadResult.Output | ForEach-Object { $_.ToString() }) -join "").Trim()
        $aheadCount = 0
        [void][int]::TryParse($aheadText, [ref]$aheadCount)

        if ($aheadResult.ExitCode -eq 0 -and $aheadCount -gt 0) {
            $pushResult = Invoke-RepoGit @("push", "origin", $branch)
            if ($pushResult.ExitCode -eq 0) {
                Write-Log "Pushed $aheadCount commit(s) to origin/$branch."
            }
            else {
                Write-Log "git push failed: $((($pushResult.Output | ForEach-Object { $_.ToString() }) -join "`n").Trim())"
            }
        }

        if ($Once) {
            break
        }

        Start-Sleep -Seconds $IntervalSeconds
    }
}
finally {
    if ((Test-Path -LiteralPath $lockPath) -and ((Get-Content -LiteralPath $lockPath -Raw).Trim() -eq "$PID")) {
        Remove-Item -LiteralPath $lockPath -Force
    }
    Write-Log "Backup watcher stopped (PID $PID)."
}
