# china-politics-test
China political issues test website

## Automatic Git backup

This repository is connected to GitHub and can back up changes automatically on Windows.

- The background watcher checks for changes every 20 seconds and pushes after files remain unchanged for about 20 seconds.
- Auto-backup commits are sent to the current branch (`main`).
- Push failures retry automatically on the next check.
- Logs are written to `.git/auto-backup.log`.
- Run a one-time backup manually with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\git-auto-backup.ps1 -Once
```

- The scheduled task name is `ChinaPoliticsTestGitAutoBackup`.
