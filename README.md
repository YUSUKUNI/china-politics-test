# china-politics-test

中国政治立场测试网站。当前版本包含 47 道题，其中原 30 题保持不变，新增 17 道题作为“扩展题组”。前端为单页应用，后端负责匿名结果收集、按版本唯一校验、服务端计分和 SQLite 持久化。

## 运行

需要 Node.js 22.17 或更高版本。

```powershell
npm start
```

未设置 `PORT` 时使用随机可用端口，启动后终端会打印实际地址。启动后可用：

```powershell
npm start -- --no-open
```

阻止自动打开浏览器。

## 结果收集

- 首次访问时，服务端签发 `HttpOnly` 匿名客户端 Cookie：`political_test_client`。
- 测试完成后，前端调用 `POST /api/results` 提交 47 个答案、测试时间和耗时；服务端根据共享题库重新计算分数和百分比，不采信客户端上传的分数。
- `results` 表对 `(client_id, test_version)` 建立唯一约束，同一客户端每个测试版本只能提交一次，同版本重复提交会返回 `409`。
- `GET /api/client-status` 用于判断当前客户端是否已经提交过当前测试版本。
- 应用不主动保存姓名、账号、邮箱或 IP 地址。
- 数据库默认存储于 `.data/results.sqlite`，该目录和数据库文件不会进入 Git。

## 题库与版本

- `questionnaire.js` 同时供浏览器和 Node.js 使用，集中保存题目、八轴定义、选项和计分逻辑。
- 当前测试版本为 `2026-11-03`，同意书版本保持 `2026-10-29`。
- 旧版数据库在启动时会自动迁移为按版本唯一，并在迁移前生成带时间戳的 `.bak` 备份；原结果不会被删除或改写。
- 新增题与八轴的对应关系见 `docs/new-question-axis-mapping.md`。分析旧版与 47 题版数据时应按 `test_version` 分组。

### 提交接口

`POST /api/results` 接收：

```json
{
  "testVersion": "2026-11-03",
  "consent": true,
  "consentVersion": "2026-10-29",
  "answers": [0, 1, 2, 3, 4],
  "startedAt": "ISO 8601 时间",
  "completedAt": "ISO 8601 时间",
  "durationMs": 600000
}
```

`answers` 实际必须是 47 个 `0` 到 `4` 的整数；上例仅展示字段结构。

### 服务端环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 监听地址 |
| `PORT` | `0` | 监听端口，`0` 表示随机端口 |
| `DATA_DIR` | `.data` | SQLite 数据目录 |
| `DB_PATH` | `.data/results.sqlite` | SQLite 文件完整路径，优先级高于 `DATA_DIR` |
| `COOKIE_SECURE` | 未设置 | 设为 `1` 时客户端标识 Cookie 仅通过 HTTPS 发送 |

正式部署应使用 Node 22 主机和持久磁盘，并设置 `HOST=0.0.0.0` 让服务可从外部访问。GitHub Pages 只能托管静态页面，无法运行 `index.js`、API 或保存 SQLite 数据库。

## 唯一标识限制

当前方案可阻止同一浏览器针对同一版本重复提交，但不能完全阻止用户清除 Cookie、切换浏览器或使用无痕模式后再次提交。需要更强约束时，应增加登录账号、邀请码或服务端限流/风控。

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
