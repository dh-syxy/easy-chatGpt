# Easy Chat

本地 Web 聊天应用：React 前端 + FastAPI 后端，通过 CloseAI（或其他 OpenAI 兼容中转）调用大模型完成对话。

默认使用 **Responses API**（`/v1/responses`），内置 `web_search` 工具，并由模型按需决定是否联网（`tool_choice: auto`）。

## 功能

- 多轮对话、流式输出（SSE）
- 新建 / 切换 / 删除会话，历史持久化（SQLite）
- Markdown 渲染与代码高亮
- 停止生成、重新生成、编辑消息后重答
- 模型可配置（环境变量 + 前端下拉）
- 按需联网搜索（含公开网页信息）
- 导出当前对话为 Word（`.docx`）或 PDF

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React + TypeScript + Vite |
| 后端 | FastAPI + SQLAlchemy（异步）+ SQLite |
| 上游 | OpenAI 兼容 `/v1/responses`（CloseAI 等中转） |

## 快速开始

### 1. 配置环境变量

```bash
cp .env.example .env
```

编辑项目根目录 `.env`，至少填写：

```bash
OPENAI_API_KEY=sk-your-api-key
OPENAI_BASE_URL=https://api.openai-proxy.org/v1
OPENAI_DEFAULT_MODEL=gpt-4o-mini
OPENAI_AVAILABLE_MODELS=gpt-4o-mini,gpt-4o,gpt-4.1
```

> 请使用你自己的 Key 与可用模型名；不要把 `.env` 提交到 Git。

### 2. 启动后端

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

健康检查：http://127.0.0.1:8000/api/health

### 3. 启动前端

另开一个终端：

```bash
cd frontend
npm install
npm run dev
```

浏览器打开：http://127.0.0.1:5173

前端通过 Vite 将 `/api` 代理到后端 `8000` 端口。

## 目录结构

```
easy-chatGpt/
├── .env.example          # 环境变量示例
├── backend/
│   ├── requirements.txt
│   ├── data/             # SQLite 数据库（本地生成，不入库）
│   └── app/
│       ├── main.py       # FastAPI 入口
│       ├── config.py
│       ├── db.py / models.py / schemas.py
│       ├── routers/      # sessions / chat / settings
│       └── services/     # 聊天、上游调用、导出
└── frontend/
    └── src/
        ├── api/          # REST + SSE 客户端
        └── components/   # 侧栏、聊天区、输入框等
```

## 主要接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/settings` | 可读配置（不含 API Key） |
| GET/POST/PATCH/DELETE | `/api/sessions` | 会话管理 |
| POST | `/api/sessions/{id}/chat` | 流式对话（SSE） |
| POST | `/api/sessions/{id}/messages/{mid}/edit` | 编辑后重生成 |
| POST | `/api/sessions/{id}/messages/{mid}/regenerate` | 重新生成 |
| GET | `/api/sessions/{id}/export?format=docx\|pdf` | 导出对话 |

上游模型调用统一走：`{OPENAI_BASE_URL}/responses`。

## 注意事项

- API Key 只放在后端 `.env`，前端不接触密钥
- 默认绑定 `127.0.0.1`，适合本地使用
- 联网搜索依赖上游是否支持 Responses 的 `web_search` 工具；不支持时会返回上游错误信息
- `backend/data/`、`.env` 已在 `.gitignore` 中忽略

## License

仅供学习与个人使用。
