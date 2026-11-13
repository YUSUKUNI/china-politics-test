# china-politics-test

中国政治立场测试网站，当前包含 60 道题和 8 个坐标轴。题目分为财政问题、社会制度、税收、政治制度、民族文化、地缘外交、扩展题组、性别议题和公共政策九个部分。每题可以标记为“非常重要”，标记后该题权重按 `1.5` 倍计入。直接涉及财政支出的题目会在对应选项下提示“该选项会增加财政支出”或“该选项会减少财政支出”。

线上方案采用 GitHub Pages 静态前端 + Cloudflare Pages Functions API + Cloudflare D1 数据库，不需要维护长期运行的服务器。前端只提交原始答案和重要题标记，服务端使用共享题库重新计分后写入 D1。`worker/index.mjs` 同时提供 Cloudflare Worker 备用入口。

## 线上数据流

1. 页面从 GitHub Pages 加载，浏览器在 `localStorage` 中保存一个匿名 UUID。
2. 前端调用 `POST /api/results`，通过 `X-Client-Id` 请求头发送匿名标识、60 个答案和每题的重要题标记。
3. 服务端校验版本、同意信息、答案和重要题标记，并使用 `questionnaire.js` 重新计算八轴分数。
4. 结果写入 D1 的 `results` 表；`(client_id, test_version)` 唯一约束保证同一浏览器每个版本只入库一次。
5. `admin.html` 是受管理令牌保护的“民意数据作战室”，采用档案纸、委员会印章与深色指挥台视觉；可查看提交概况、八轴倾向、每题倾向、每日趋势、重点题排行和逐份答卷，支持删除单份异常答卷并立即重新统计，也可导出完整 CSV。不会从公开页面链接该管理页面。

当前线上地址：

- 测试页面：`https://yusukuni.github.io/china-politics-test/`
- 管理后台：`https://yusukuni.github.io/china-politics-test/admin.html`
- 数据接口：`https://china-politics-test-data.pages.dev`

当前网络下 `pages.dev` 可正常访问，而 `workers.dev` 会被拦截，因此线上正式数据入口使用 Pages。若以后有正式域名，只需更新 `ALLOWED_ORIGINS` 和 `api-config.js`。

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

## 部署与更新

### Cloudflare Pages API（当前正式入口）

1. 创建或登录 Cloudflare 免费账号，并执行 `npx wrangler login`。
2. 首次部署时创建 D1 数据库：

```powershell
npx wrangler d1 create china-politics-test-results
```

3. 将命令输出的 `database_id` 同时写入 `wrangler.jsonc` 和 `cloudflare-pages/wrangler.jsonc`。
4. 应用远程 migration：

```powershell
npm run db:migrate:remote
```

已有 D1 数据库必须在部署新版服务端前执行 migration；`0002` 会新增 `importance_json` 字段。

5. 首次部署时创建 Pages 项目：

```powershell
npx wrangler pages project create china-politics-test-data --production-branch main
```

6. 设置 Pages 管理令牌。令牌生成后只保存在本机 `.data/admin-token.txt` 或密码管理器中，不能提交到 Git：

```powershell
$token = (Get-Content .data/admin-token.txt -Raw).Trim()
$token | npx wrangler pages secret put ADMIN_EXPORT_TOKEN --project-name china-politics-test-data
```

7. 部署或更新 Pages API：

```powershell
npm run deploy:pages
```

8. `api-config.js` 的 `apiBase` 必须指向实际接口地址。当前配置为：

```js
globalThis.POLITICS_TEST_CONFIG = {
  apiBase: "https://china-politics-test-data.pages.dev",
};
```

9. 提交并推送前端文件。GitHub Pages 更新后，公开测试页会把结果写入 D1。

### Cloudflare Worker（备用入口）

同一份服务端代码也可以通过 Worker 部署。首次部署需单独设置 Worker Secret：

```powershell
Get-Content .data/admin-token.txt | npx wrangler secret put ADMIN_EXPORT_TOKEN
npm run deploy
```

若切换 Worker 地址，必须同步修改 `api-config.js`。免费 `workers.dev` 域名是否可访问取决于所在网络。

### CORS 配置

生产环境只允许 GitHub Pages 和 Pages API 自身来源。Pages 的配置位于 `cloudflare-pages/wrangler.jsonc`，Worker 备用入口的配置位于 `wrangler.jsonc` 的 `ALLOWED_ORIGINS`。需要允许多个来源时使用英文逗号分隔。本地测试可在 `.dev.vars` 中覆盖该变量。

如果 GitHub Pages 地址变化，必须同时更新两处 `ALLOWED_ORIGINS`，并分别重新部署 Pages 和 Worker。

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
  "testVersion": "2026-11-13.1",
  "consent": true,
  "consentVersion": "2026-10-29",
  "answers": [0, 1, 2, 3, 4],
  "importantQuestions": [false, true, false, false, true],
  "startedAt": "2026-11-10T10:00:00.000Z",
  "completedAt": "2026-11-10T10:08:00.000Z",
  "durationMs": 480000
}
```

`answers` 必须是 60 个 `0` 到 `4` 的整数；`importantQuestions` 必须是 60 个布尔值。被标记为 `true` 的题目按 `questionnaire.js` 中 `importanceMultiplier = 1.5` 的倍率计分。成功返回 `201`；同版本重复提交返回 `409`；客户端上传的任何分数都会被忽略。

上例中的 `answers` 和 `importantQuestions` 仅用于展示编码，实际请求都必须包含完整的 60 项。

### `GET /api/client-status`

请求头需要 `X-Client-Id`。返回：

```json
{
  "submitted": false,
  "completedAt": null,
  "testVersion": "2026-11-13.1"
}
```

### `GET /api/admin/results.csv`

请求头需要：

```text
Authorization: Bearer <ADMIN_EXPORT_TOKEN>
```

CSV 使用 UTF-8 BOM，包含结果 ID、匿名客户端 ID、版本、时间、耗时、`importance_count`、八轴分数、各轴百分比、`q01` 至 `q60` 的数值答案，以及 `important_q01` 至 `important_q60` 的 `0/1` 标记。

### `GET /api/admin/results`

请求头与 CSV 导出相同，必须携带 `Authorization: Bearer <ADMIN_EXPORT_TOKEN>`。支持 `page`、`pageSize`、`version`、`from`、`to` 和 `q` 查询参数，返回汇总指标、八轴均值与范围、每题倾向、最近每日趋势、重点题排行、版本分布、分页后的答卷列表和逐题答案。管理页面 `admin.html` 通过该接口加载数据。

`summary.questionTendencies` 按当前筛选范围内的原始答案聚合，固定返回全部 60 题。每项包含题号、部分、题干、样本数、五级选项计数、支持/中立/反对人数与百分比，以及净倾向 `tendencyPercentage`。净倾向按下式计算，范围为 `-100` 至 `100`，正数表示整体偏支持，负数表示整体偏反对：

```text
（很支持×2 + 一般支持×1 − 一般不支持×1 − 很不支持×2）÷（2 × 样本数）× 100
```

### `DELETE /api/admin/results/:resultId`

请求头需要 `Authorization: Bearer <ADMIN_EXPORT_TOKEN>`。永久删除指定结果；成功返回 `200`，结果不存在返回 `404`，结果 ID 格式错误返回 `400`。后台删除成功后会重新请求汇总接口，因此总数、独立设备数、重点题统计、八轴均值和每题倾向都会按剩余数据重新计算。

### `GET /api/health`

返回服务端所使用的测试版本，用于部署后的基本检查。

## 数据与备份

- D1 数据独立于 Pages 和 Worker 部署，重新部署不会清空结果。
- Cloudflare D1 Time Travel 可恢复最近 30 天内的数据。
- 每个收集阶段结束前，应从 `admin.html` 下载完整 CSV，并在 Git 仓库之外另行保存。后台登录令牌只保存在当前标签页，不写入 URL 或浏览器长期存储。
- 数据库、CSV、`.dev.vars` 和管理令牌不得提交到 Git。
- Cloudflare 控制台也可以直接查询 D1；这是辅助方式，不替代离线备份。

CSV 的“受保护”依赖 HTTPS 和 `ADMIN_EXPORT_TOKEN`，不是额外的文件密码加密。

## 题库与版本

- `questionnaire.js` 同时供浏览器、Node 和 Worker 使用，集中保存题目、八轴定义、选项和计分逻辑。
- 当前测试版本为 `2026-11-13.1`，同意书版本为 `2026-10-29`，重要题权重倍率为 `1.5`。
- 民族文化轴两端为“多元民族文化—汉民族文化”；性别立场轴两端为“利男—利女”。新版第 46、49 题的性别轴方向已按“利男/利女”重新校准，旧版性别轴数据不能直接与新数据合并比较。
- 财政支出提示只用于解释选项方向，不额外改变题目权重；实际计分仍以 `effects` 为准。
- 60 题完整题干、数组下标与八轴权重总表见 `docs/question-axis-weight-list.md`；题库结构、方向校准和数据分析说明见 `docs/new-question-axis-mapping.md`。分析不同版本数据时应按 `test_version` 分组。

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
