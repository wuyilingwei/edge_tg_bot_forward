# edge-tg-bot-forward

> 部署在 **Cloudflare Workers** 上的 Telegram Bot API 边缘透传代理。
> 通过环境变量白名单控制允许使用该代理的 Bot Token，未授权请求静默丢弃。

## 功能特性

- 🌍 **全球边缘节点**：Cloudflare 200+ 数据中心，绕过地区封锁
- 🔐 **Token 白名单**：只有 `ALLOWED_TOKENS` 中的 bot 才能通过代理
- 📁 **文件下载代理**：同时支持 `/file/bot{token}/{path}` 文件路径
- 🔄 **流式透传**：请求 body / 响应 body 均流式转发，支持大文件
- 🌐 **CORS 支持**：自动注入 CORS 头，支持浏览器直接调用
- 🚫 **静默拒绝**：未授权 token 返回通用 404，不泄露任何信息

## URL 格式

代理支持以下三种请求路径格式：

| 代理路径 | 上游转发目标 |
|----------|-------------|
| `/{token}/{method}` | `https://api.telegram.org/bot{token}/{method}` |
| `/bot{token}/{method}` | `https://api.telegram.org/bot{token}/{method}` |
| `/file/bot{token}/{path}` | `https://api.telegram.org/file/bot{token}/{path}` |

## 快速部署

### 前置要求

- [Node.js](https://nodejs.org/) 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)（`npm install -g wrangler`）
- Cloudflare 账号（免费套餐即可）

### 步骤

```bash
# 1. 克隆仓库
git clone <repo-url>
cd edge-tg-bot-forward

# 2. 安装依赖
npm install

# 3. 登录 Cloudflare
npx wrangler login

# 4. 设置允许的 Bot Token（通过 secret，不会出现在代码中）
npx wrangler secret put ALLOWED_TOKENS
# 输入逗号分隔的 token 列表，例如：
# 123456789:AABBccDDeeFF-your-token,987654321:ZZYYxxWWvv-other-token

# 5. 部署
npm run deploy
```

部署成功后会输出：
```
✅ Deployed to https://edge-tg-bot-forward.<your-subdomain>.workers.dev
```

### 本地开发

```bash
# 在 wrangler.toml 中临时添加 [vars] 段进行本地测试（勿提交）
# [vars]
# ALLOWED_TOKENS = "your_test_token"

npm run dev
# 访问 http://localhost:8787/bot{your_token}/getMe
```

## 在 Bot 中使用

将 Telegram Bot SDK 的 API 基础 URL 替换为 Worker 地址：

### Python (python-telegram-bot)

```python
from telegram import Bot
from telegram.request import HTTPXRequest

bot = Bot(
    token="YOUR_BOT_TOKEN",
    base_url="https://edge-tg-bot-forward.your-subdomain.workers.dev/bot",
)
```

### Node.js (telegraf)

```javascript
const { Telegraf } = require('telegraf')

const bot = new Telegraf('YOUR_BOT_TOKEN', {
  telegram: {
    apiRoot: 'https://edge-tg-bot-forward.your-subdomain.workers.dev',
  },
})
```

### grammY (TypeScript)

```typescript
import { Bot } from "grammy";

const bot = new Bot("YOUR_BOT_TOKEN", {
  client: {
    apiRoot: "https://edge-tg-bot-forward.your-subdomain.workers.dev",
  },
});
```

### 手动 HTTP 请求

```bash
curl "https://edge-tg-bot-forward.your-subdomain.workers.dev/bot{TOKEN}/getMe"
# 或
curl "https://edge-tg-bot-forward.your-subdomain.workers.dev/{TOKEN}/getMe"
```

## 环境变量

| 变量名 | 必须 | 说明 |
|--------|------|------|
| `ALLOWED_TOKENS` | ✅ | 逗号分隔的授权 Bot Token，空值会导致所有请求返回 404 |

**推荐方式**：通过 `wrangler secret put` 或 Cloudflare Dashboard 的 **Settings → Variables → Secret** 设置，避免 token 出现在版本控制中。

## 免费套餐限制

Cloudflare Workers 免费套餐（Free Plan）：
- **每日请求**：100,000 次
- **CPU 时间**：10ms / 请求（透传几乎不消耗 CPU）
- **内存**：128MB

对于大多数 Bot 场景绰绰有余。如需更高并发，升级到 Workers Paid（$5/月，1,000 万次/月）。

## 测试

```bash
npm test
```

## 许可证

MIT
