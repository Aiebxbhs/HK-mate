# AI 助手：按账号配置服务商与 API Key（计划，待确认）

2026-11-16 起草。状态：**方案已拟好，尚未获得确认，未改任何代码。**

## 背景

打包给他人试用时，不把开发者自己的 Key 放进安装包。改为每个账号在“我的账号”里填写自己的 Key，在 AI 助手里选择服务商。Key 加密保存在使用者自己的电脑上，只发给所选的服务商，开发者和安装包都接触不到。

## 现状

- 服务商、模型和 Key 只从环境变量读取（`HKM_AGENT_*`，本机放在 `private-data/agent.env`），整台机器共用一套，页面上不能改。
- `backend/app/agent/providers.py` 已有服务商预置：OpenAI、Gemini、通义千问（国内 / 国际）、DeepSeek、Kimi、智谱、自定义 OpenAI 兼容接口；Anthropic 标为 planned，需要单独适配器。
- `main.py` 启动时读取一次 `AgentSettings.from_env()`，`agent/api.py` 用 `app.state.agent_settings` 和 `app.state.agent_model_factory`。
- 只有 OpenAI（GPT-6.1 Terra，Responses API）用真实 Key 验证过。

## 方案

### 账号页“AI 助手设置”

- 列出可用的服务商（不列 Anthropic），每家可填 API Key 和模型名称；“自定义”多一个服务地址（必须是 https）。
- Key 保存后不再显示，只显示“已配置”，可替换或删除。
- 每家有“测试连接”按钮：发一条极短的请求确认 Key 和模型名可用，会消耗极少量额度；结果用现有的错误码提示（Key 无效、模型不存在、地区不支持、额度用完等）。
- 未用真实 Key 验证过的服务商标注“未验证”。

### AI 助手里选择服务商

- 输入条旁的下拉只列已配置好的服务商；选中的那家记在账号上。
- 一家都没配时提示“去我的账号配置”，其他功能照常。

### 存储（数据库结构变更，需确认）

- 新增表 `agent_provider_configs`：`user_id`、`provider`（两者联合唯一）、`encrypted_api_key`、`model`、`base_url`、`selected`、`updated_at`；`user_id` 外键级联删除。只新增表，不动现有数据。迁移前备份本地数据库。
- 用现有 Fernet 密钥（`TokenVault`）加密，与邮箱授权码相同；Key 不写日志，不出现在任何接口返回或错误信息里。

### 接口（均需登录，写操作验证 Origin 和 CSRF）

- `GET /api/v1/agent/providers`：服务商列表，含是否已配置、模型名、是否当前选择、是否已验证；不返回 Key。
- `PUT /api/v1/agent/providers/{name}`：保存 Key（可省略以保留原 Key）、模型名、服务地址。
- `DELETE /api/v1/agent/providers/{name}`：删除该服务商的配置。
- `PUT /api/v1/agent/selection`：选择当前服务商（只能选已配置的）。
- `POST /api/v1/agent/providers/{name}/test`：测试连接，带频率限制。
- `/api/v1/agent/status` 与 `/api/v1/agent/chat` 改为按当前账号解析设置。

### 环境变量保留为兜底

账号没有配置时仍用 `agent.env` 的设置，现有本机用法不受影响；安装包里没有这个文件，只能用使用者自己填的。

## 已替用户做的选择（可改）

- **模型名称自己填**，不做下拉：各家模型名更新快，写死的列表容易过时；填错由“测试连接”报出。
- **Google 地图 Key 这次不做**：助手“找地方”用的是另一把 Google Key（`HKM_AGENT_GOOGLE_MAPS_API_KEY`），不填则只有这一项不可用。需要的话可以一起放进设置页。

## 验证要点

- 跨账号：一个账号不能读取、使用、测试或删除另一个账号的配置。
- Key 不出现在响应、日志和错误信息中；数据库中为密文。
- 未登录、缺 CSRF、非 https 的自定义地址、未知服务商、选择未配置的服务商均被拒绝。
- 没有账号配置时回退到环境变量；两者都没有时助手给出明确提示。
- 测试使用模拟的模型服务，不调用真实收费接口。

## 待确认

- [ ] 同意新增 `agent_provider_configs` 表
- [ ] 模型名称自己填，还是要预置建议值
- [ ] Google 地图 Key 是否一并放进设置页

## 相关

打包的整体安排见 `docs/MAC_APP_AND_WEBSITE_PLAN.md`。打包前另外还需确认：新增依赖 pywebview 与 PyInstaller、是否签名、Ollama 是否打进 App。
