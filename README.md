# china-politics-test

中国政治立场测试网站。前端为单页应用，后端负责匿名结果收集、唯一客户端校验和 SQLite 持久化。

## 运行

需要 Node.js 22.17 或更高版本。

```powershell
npm start
```

默认地址为 `http://127.0.0.1:3000`；未设置 `PORT` 时使用随机可用端口。启动后可用：

```powershell
npm start -- --no-open
```

阻止自动打开浏览器。

## 结果收集

- 首次访问时，服务端签发 `HttpOnly` 匿名客户端 Cookie：`political_test_client`。
- 测试完成后，前端调用 `POST /api/results` 提交答案、分数、百分比、测试时间和耗时。
- `results.client_id` 有唯一约束，同一客户端重复提交会返回 `409`，不会写入第二条记录。
- `GET /api/client-status` 用于判断当前客户端是否已经提交过结果。
- 应用不主动保存姓名、账号、邮箱或 IP 地址。
- 数据库默认存储于 `.data/results.sqlite`，该目录和数据库文件不会进入 Git。

### 服务端环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 监听地址 |
| `PORT` | `0` | 监听端口，`0` 表示随机端口 |
| `DATA_DIR` | `.data` | SQLite 数据目录 |
| `DB_PATH` | `.data/results.sqlite` | SQLite 文件完整路径，优先级高于 `DATA_DIR` |
| `COOKIE_SECURE` | 未设置 | 设为 `1` 时客户端标识 Cookie 仅通过 HTTPS 发送 |

正式部署应使用 Node 22 主机和持久磁盘。GitHub Pages 只能托管静态页面，无法运行 `index.js`、API 或保存 SQLite 数据库。

## 唯一标识限制

当前方案可阻止同一浏览器中的重复提交，但不能完全阻止用户清除 Cookie、切换浏览器或使用无痕模式后再次提交。需要更强约束时，应增加登录账号、邀请码或服务端限流/风控。

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
