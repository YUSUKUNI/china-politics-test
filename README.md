# china-politics-test

中国政治立场测试网站，当前包含 47 道题。原 30 题保持不变，新增 17 题位于“扩展题组”。

线上方案采用 GitHub Pages 静态前端 + Cloudflare Worker API + Cloudflare D1 数据库，不需要维护长期运行的服务器。前端只提交原始答案，Worker 使用共享题库重新计分后写入 D1。

## 线上数据流

1. 页面从 GitHub Pages 加载，浏览器在 `localStorage` 中保存一个匿名 UUID。
2. 前端调用 `POST /api/results`，通过 `X-Client-Id` 请求头发送匿名标识和 47 个答案。
3. Worker 校验版本、同意信息和答案，并使用 `questionnaire.js` 重新计算八轴分数。
4. 结果写入 D1 的 `results` 表；`(client_id, test_version)` 唯一约束保证同一浏览器每个版本只入库一次。
5. `admin.html` 使用管理令牌下载 CSV。不会从公开页面链接该管理页面。

Cloudflare 免费域名（`workers.dev`）和 GitHub Pages 在中国大陆的访问稳定性不作保证。若以后有正式域名，只需更新 Worker 的 `ALLOWED_ORIGINS` 和 `api-config.js`。

## 本地运行

需要 Node.js 22.17 或更高版本。

```powershell
npm install
npm start
```

本地 Node 服务仍使用 SQLite，默认数据库为 `.data/results.sqlite`。该目录和数据库文件不会进入 Git。

阻止自动打开浏览器：

```powershell
npm start -- --no-open
```

本地 Node 服务环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 监听地址 |
| `PORT` | `0` | 监听端口；`0` 表示随机端口 |
| `DATA_DIR` | `.data` | SQLite 数据目录 |
| `DB_PATH` | `.data/results.sqlite` | SQLite 完整路径，优先级高于 `DATA_DIR` |
| `COOKIE_SECURE` | 未设置 | 设为 `1` 时 Cookie 仅通过 HTTPS 发送 |

运行检查与测试：

```powershell
npm run check
npm test
```

本地 Cloudflare 环境：

```powershell
Copy-Item .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev:worker
```

`.dev.vars` 已忽略，不能提交。Worker 默认监听 `http://127.0.0.1:8787`。

## 首次部署

1. 创建或登录 Cloudflare 免费账号，并执行 `npx wrangler login`。
2. 创建 D1 数据库：

```powershell
npx wrangler d1 create china-politics-test-results
```

3. 将命令输出的 `database_id` 写入 `wrangler.jsonc`，替换全零占位值。
4. 应用远程 migration：

```powershell
npm run db:migrate:remote
```

5. 生成并设置管理令牌：

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npx wrangler secret put ADMIN_EXPORT_TOKEN
```

6. 部署 Worker：

```powershell
npm run deploy
```

7. 将输出中的 Worker 地址填入 `api-config.js` 的 `apiBase`，例如：

```js
globalThis.POLITICS_TEST_CONFIG = {
  apiBase: "https://china-politics-test-api.example.workers.dev",
};
```

8. 提交并推送 `api-config.js`。GitHub Pages 更新后，公开测试页会把结果写入 D1。

### CORS 配置

生产环境只允许 `https://yusukuni.github.io`，配置位于 `wrangler.jsonc` 的 `ALLOWED_ORIGINS`。需要允许多个来源时使用英文逗号分隔。本地测试可在 `.dev.vars` 中覆盖该变量。

如果 GitHub Pages 地址变化，必须同时更新 `ALLOWED_ORIGINS` 并重新部署 Worker。

## 接口

### `POST /api/results`

请求头必须包含：

```text
Content-Type: application/json
X-Client-Id: <UUID>
```

请求体：

```json
{
  "testVersion": "2026-11-03",
  "consent": true,
  "consentVersion": "2026-10-29",
  "answers": [0, 1, 2, 3, 4],
  "startedAt": "2026-11-03T10:00:00.000Z",
  "completedAt": "2026-11-03T10:08:00.000Z",
  "durationMs": 480000
}
```

`answers` 必须是 47 个 `0` 到 `4` 的整数。成功返回 `201`；同版本重复提交返回 `409`；客户端上传的任何分数都会被忽略。

### `GET /api/client-status`

请求头需要 `X-Client-Id`。返回：

```json
{
  "submitted": false,
  "completedAt": null,
  "testVersion": "2026-11-03"
}
```

### `GET /api/admin/results.csv`

请求头需要：

```text
Authorization: Bearer <ADMIN_EXPORT_TOKEN>
```

CSV 使用 UTF-8 BOM，包含结果 ID、匿名客户端 ID、版本、时间、耗时、八轴分数、各轴百分比，以及 `q01` 至 `q47` 的数值答案。

### `GET /api/health`

返回 Worker 所使用的测试版本，用于部署后的基本检查。

## 数据与备份

- D1 数据独立于 Worker 部署，重新部署 Worker 不会清空结果。
- Cloudflare D1 Time Travel 可恢复最近 30 天内的数据。
- 每个收集阶段结束前，应从 `admin.html` 下载完整 CSV，并在 Git 仓库之外另行保存。
- 数据库、CSV、`.dev.vars` 和管理令牌不得提交到 Git。
- Cloudflare 控制台也可以直接查询 D1；这是辅助方式，不替代离线备份。

CSV 的“受保护”依赖 HTTPS 和 `ADMIN_EXPORT_TOKEN`，不是额外的文件密码加密。

## 题库与版本

- `questionnaire.js` 同时供浏览器、Node 和 Worker 使用，集中保存题目、八轴定义、选项和计分逻辑。
- 当前测试版本为 `2026-11-03`，同意书版本为 `2026-10-29`。
- 47 题完整题干、数组下标与八轴权重总表见 `docs/question-axis-weight-list.md`；扩展题设计说明见 `docs/new-question-axis-mapping.md`。分析不同版本数据时应按 `test_version` 分组。

## 唯一标识限制

匿名 UUID 和数据库唯一约束可以阻止普通重复提交，但不能阻止用户清除浏览器存储、换浏览器或伪造新 UUID。需要严格一人一份时，应增加账号登录或其他身份验证。

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
