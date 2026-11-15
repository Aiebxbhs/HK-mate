# HK Mate

> 给港大研究生的校园生活助手：读邮件、管日程、听懂英文课，再加一个懂香港的 AI 助手。

HK Mate 是一个在自己电脑上运行的 Web 应用，把 Gmail、HKU 课表、课堂实时翻译和港大校园指南放在一起。邮件摘要、回复草稿和课堂翻译都由本机模型完成，私人邮件和课堂录音不会离开这台电脑；只有首页 AI 助手使用云端模型。

## 亮点

- **邮件不漏看**：后台自动检测 Gmail 新邮件，本机 AI 写中文摘要并分类（学校 / 求职 / 账单与账户 / 广告推广 / 其他），可一键起草回复，由你自己检查后发送。
- **日程一目了然**：粘贴 HKU Event Calendar 链接即可导入课表，整学期按周查看；自己添加的日程可编辑，截止事项有随时间变化的进度条。
- **英文课听得懂**：上课时实时生成中英双语字幕，可记带时间点的笔记；课后自动整理重点、作业和考试提醒，每条附老师英文原话和时间点。
- **AI 助手**：问日程、写请假邮件、找附近好吃的、新生办事（身份证、签证、银行开户……），查天气。
- **HKU 指南**：图书馆（含 Main Library 逐层设施图）、交通与校园位置、学生服务与联系方式，只用港大官方来源并注明核对日期。

## 隐私

- Gmail 只申请**只读**权限，HK Mate 不发送、删除、移动邮件，也不修改已读状态。
- 邮件摘要、分类、回复草稿、课堂识别与翻译、课后摘要**全部在本机运行**（Ollama + Qwen3 4B、mlx-whisper），不需要云模型 API Key。
- 课堂录音只在内存中处理，不上传、不保存。
- 邮箱授权令牌、课程记录、AI 对话历史与记忆加密保存在本机，所有数据按账号隔离。
- 只有首页 AI 助手的对话（以及它记住的偏好）会发送给你配置的云端服务商；课表订阅链接用完即弃，不保存。

## 技术栈

| 部分 | 技术 |
|---|---|
| 后端 | Python 3.13 · FastAPI · SQLite · SQLAlchemy · Alembic（uv 管理） |
| 前端 | React · Vite（Node 24，npm 管理） |
| 本机模型 | Ollama + Qwen3 4B Instruct 2507（摘要、分类、草稿、翻译）· mlx-whisper（英文识别，需 Apple Silicon） |
| 云端模型 | AI 助手：OpenAI（默认），预置 Gemini、通义千问、DeepSeek、Kimi、智谱等兼容接口 |
| 外部服务 | Gmail API（只读 OAuth）· Google Places API（找餐厅）· 香港天文台开放数据 |

## 快速开始

前提：macOS（Apple Silicon，课堂翻译需要）、[uv](https://docs.astral.sh/uv/) 和 Python 3.13。依赖写入项目 `.venv`，Node 安装到 Git 忽略的 `.tools`，不修改系统运行时。

```bash
uv sync --locked
.venv/bin/python scripts/setup-node.py
export PATH="$PWD/.tools/node/bin:$PATH"
npm --prefix frontend ci
bash scripts/dev.sh
```

打开 **http://127.0.0.1:5173**，用账号和密码注册（没有预设账号）。账号使用 3–32 位字母、数字或下划线，不区分大小写；注册不需要邮箱。

各功能还需要以下准备，按需配置即可，未配置的功能会提示不可用：

| 功能 | 需要 | 说明 |
|---|---|---|
| 邮件 | Google OAuth 客户端 | [Gmail 接入说明](docs/GMAIL_SETUP.md) |
| 邮件摘要、分类、草稿 | Ollama + Qwen3 4B，运行 `bash scripts/ollama-serve.sh` | [本地模型部署](docs/LOCAL_MODEL.md) |
| 课堂翻译 | `uv sync --group speech` 和本地 Whisper 模型 | [课程实时翻译](docs/LECTURE.md) |
| AI 助手 | 云端服务商 API Key，写入 `private-data/agent.env` | 见下文“AI 助手” |
| 课表 | HKU Portal 的 Event Calendar 订阅链接 | [HKU 课表说明](docs/HKU_CALENDAR.md) |

## 功能说明

导航在桌面端顶部、手机端底部，共 5 项：**今天、日程、邮件、课堂翻译、HKU 指南**；各区的子页面在标题下方切换。右上角头像菜单里有“我的账号”（可修改密码，修改后其他设备上的登录会退出）和“退出登录”。支持浏览器后退 / 前进；地址栏以 `#/inbox` 等形式记录当前页面，刷新后保持不变。

### 今天（首页）

- **问候与日期**：按香港时间显示“早上好 / 下午好 / 晚上好”和日期。
- **AI 助手**：问候下方的输入条，开始对话后展开（见下文）。
- **接下来 5 天**：按天列出课程、自己添加的日程和截止事项；正在上的课标“进行中”，下一节标“x 分钟后”，24 小时内到期的截止事项有橙点。还没有日程时可直接“导入课表”或“添加日程”。

### 邮件

导航“邮件”旁显示还没处理的新邮件数。子页面：统一收件箱、起草邮件、邮箱管理。

- **新邮件通知**（统一收件箱顶部）：后台约每 15 秒检查 Gmail，页面约每 3 秒更新；每封新邮件自动生成摘要和分类，显示排队 / 生成进度。可读取原文、忽略（不改动 Gmail）、失败重试、起草回复，或“加入日程”（打开空白添加表单，由你自己填写）。首次启用补查最近一小时，之后增量检测。见 [自动邮件处理](docs/AUTO_MAIL.md)。
- **统一收件箱**：三栏布局（邮件列表 | 原文 | AI 助手），每封邮件显示类别标签，未读邮件带橙点。可切换收件箱或含归档的已收邮件，分页查看。右栏可按需生成摘要（不保存）和起草回复。
- **邮件分类**：学校邮件、求职邮件、账单与账户、广告推广、其他邮件，全部由本机 Qwen 根据邮件内容判断。新邮件随摘要分类，最近 10 天的已有邮件在后台补分类。
- **回复草稿 / 起草邮件**：选择回复意图、语气、语言和署名，或写下新邮件要点，本机 Qwen 生成可编辑草稿；复制或“在 Gmail 中打开”后自行发送。收件人地址不发给模型，你输入的密码类信息会从草稿中移除。见 [回复草稿与起草新邮件](docs/REPLY_DRAFT.md)。
- **邮箱管理**：添加 / 重新授权 / 解绑 Google 邮箱，最多 5 个。学校邮箱可设置自动转发到已连接的 Gmail。

### 日程

子页面：日程、课表。

- **日程**：按日期分组列出接下来 100 天的 HKU 课程和自己添加的日程，突出开始时间和地点并标明来源。“添加日程”可选**活动**（开始和结束时间，香港时间，当天内）或**截止事项**（只填截止时间，进度条从截止前 14 天开始逐渐填满，3 天内变橙，过期变红）。自己添加的日程可原地编辑；每项可标记完成或撤销，删除前需确认（HKU 课程不可编辑，删除后重新导入课表会恢复）。
- **课表**：只显示 HKU 课程，仿 HKU Portal 课表，整学期一个可上下滚动的长日历，每行一周，打开时定位到本周；课程按代码固定配色，考试另行标出。首次使用时页面提供链接输入框和图文教程：粘贴 HKU Event Calendar 订阅链接即可导入（只接受 hku.hk 链接，链接不保存）。课表是一次性快照，不会自动同步学校的更新，需要时重新导入。见 [HKU 课表说明](docs/HKU_CALENDAR.md)。

### 课堂翻译

子页面：实时翻译、课程记录。

- **实时翻译**：上课时录音，本机 Whisper 识别英文、Qwen 翻译成中文，双语字幕逐句显示（正在说的这句先以灰色英文实时出现）；同时可记录带时间点的笔记。录音不上传、不保存。**需在 Chrome 或 Safari 中使用**（部分应用内置浏览器不允许使用麦克风）。录音前请获得授课老师和学校的允许。
- **课后 AI 摘要**：结束课程后自动生成中文概览、重点，以及作业 / 考试 / 截止 / 通知提醒，每条附课程内时间和老师的英文原话；预览后自己决定是否保存。
- **课程记录**：按课程分组查看、编辑、删除和导出 Markdown。

使用说明、原理、隐私与限制见 [课程实时翻译与课程记录](docs/LECTURE.md)。

### HKU 指南（研究生）

按 3 类整理港大研究生常用信息，只采用港大官方网站，每部分注明来源与核对日期，官方名称只用英文；开放时间、穿梭巴士时刻表等易变信息只给官方链接。

- **图书馆**：各馆一览、借阅规则、讨论室与学习空间预约、打印；Main Library 逐层设施图，可按设施（彩色打印、扫描、自习空间等）筛选楼层。
- **交通与校园位置**：内嵌官方 HKU Campus Map，港铁出口、巴士 / 小巴路线、穿梭巴士路线与车费。
- **学生服务与联系方式**：成绩单、证明信与学生证、缴交学费、University Health Service、CEDARS 心理辅导、残障与特殊学习需要、住宿 / 非本地生 / 就业、紧急与安全。

内容文件在 `backend/app/agent/knowledge/hk/`（`topic: hku`），同时供 AI 助手检索。

### AI 助手

首页问候语下方的输入条，查询过程和结果卡片会显示在对话中。目前可以：

- 查询自己的日程和截止事项；提议新增日程（点“确认添加”才保存）。
- 起草邮件，例如“明天的课要请假，帮我给 Prof. Chan 写封邮件”：先查课程，再由本机 Qwen 写草稿，正文不回传云端；收件人邮箱在卡片中自己填写，复制或在 Gmail 中打开后自行发送。
- 回顾已保存的课程记录。
- 像朋友聊天一样找吃的，例如“帮我找找西营盘美食”：先问想吃什么、给可点击的选项，再用 Google 地图推荐两三家并说明理由，卡片附评分、营业状态和地图链接（每个账号每天最多 30 次）。
- 新生办事（香港身份证、学生签证延期、银行开户、八达通与港铁学生优惠、手机卡实名登记、防骗）、新手行山和购物去处、HKU 指南内容：根据官方资料整理的知识库回答，附官方来源链接与核对日期。
- 查香港天气与警告（查询失败时会明确说明，不会编造）；问 HK Mate 怎么用。

对话会发送给所选云端服务商。对话记录加密保存在本机（最近 20 个，可在“历史”中打开继续或删除）；AI 会记住你提到的长期偏好（如“不吃辣”、住在哪里），回复中提示“已记住”并可撤销，全部记忆可在“记忆”中查看和删除，记忆会随对话发送给云端服务商。长对话会自动把较早的内容压缩成摘要。

**配置**：`private-data/agent.env`（Git 忽略）按类别分为四部分——当前模型（`HKM_AGENT_PROVIDER`、`HKM_AGENT_MODEL`）、各服务商的 Key（每家一行，如 `HKM_AGENT_OPENAI_API_KEY`、`HKM_AGENT_DEEPSEEK_API_KEY`，只使用当前服务商那一行）、Google 服务（`HKM_AGENT_GOOGLE_MAPS_API_KEY`）、高级设置。例如：

```text
HKM_AGENT_PROVIDER=openai
HKM_AGENT_MODEL=gpt-6.1-terra
HKM_AGENT_OPENAI_API_KEY=<你的 API Key>
```

重启 `bash scripts/dev.sh` 生效；可先运行 `.venv/bin/python scripts/agent-model-check.py` 检查密钥与工具调用（会产生一次计费调用）。设计与进度见 [AI 助手开发计划](docs/AI_AGENT_PLAN.md)。

## 运行与部署

### 开发模式

```bash
bash scripts/dev.sh
```

前端使用 5173，后端使用 8000，均只监听本机。Ctrl+C 同时停止两个服务；端口已占用时脚本会提示，不会终止其他程序。数据库迁移在启动前执行，已有账号不会因重启消失。API 文档：http://127.0.0.1:8000/docs。

### 本地部署模式

先构建前端，再让 FastAPI 从同一个地址提供网页和 API：

```bash
export PATH="$PWD/.tools/node/bin:$PATH"
npm --prefix frontend run build
bash scripts/serve.sh
```

访问 **http://127.0.0.1:8000**。不要与开发服务同时占用 8000 端口。此模式仍只供本机访问，没有自动配置公网 HTTPS。

### 在 VS Code 里预览

1. 按 `Cmd+Shift+P`，执行 `Browser: Open Integrated Browser`，地址栏输入 `http://127.0.0.1:5173`。
2. 将浏览器标签拖到编辑器右侧，即可一边修改代码一边看页面。

已提供 `.vscode/launch.json`：服务启动后可在“运行和调试”选择 **HK Mate: 在 VS Code 中预览** 并按 F5；也可通过 `Tasks: Run Task` 选择 **HK Mate: 启动本地页面与 API**。旧版 VS Code 的 `Simple Browser: Show` 对 Cookie 支持可能受限，登录验证优先使用集成浏览器或普通浏览器。

## 检查与测试

```bash
bash scripts/check.sh
```

执行后端 Ruff 检查及格式检查、pytest，以及前端 ESLint、Prettier、Vitest 和生产构建。测试使用临时数据库、合成账号和合成邮件，不访问真实邮箱或模型服务。当前尚未配置 GitHub Actions。

## 配置与数据

- 默认数据库：`private-data/hkumate.sqlite3`。`private-data/`、数据库、日志、`.venv`、`.tools` 和前端构建产物均不提交 Git。
- 配置名见 `.env.example`，通过进程环境变量读取，不自动加载 `.env`（AI 助手的 `private-data/agent.env` 由启动脚本读取）。
- Google OAuth 凭证及令牌加密密钥不提交 Git；首次授权时生成本机加密密钥，后续须保留。测试模式的 Google 授权可能 7 天到期，需要重新连接。
- 本机 HTTP 模式使用非 Secure Cookie；任何公网 HTTPS 部署必须开启 `HKM_COOKIE_SECURE=true` 并设置准确的 `HKM_ALLOWED_ORIGINS`，不能照搬本机开发配置。
- 密码长度 12–128 字符，使用 Argon2id；会话最长 7 天，退出立即撤销当前会话；修改密码后该账号其他设备上的会话失效。CSRF 令牌每次写请求前获取，服务端重启后自动重新获取。
- 限流是持久化的 15 分钟固定窗口：每个账号登录 10 次、注册 5 次、修改密码 5 次，每类操作每个来源地址 40 次。返回 429 时稍后再试，不要清空数据库规避。
- 单实例运行，暂不支持多个后端 worker。
- 未实现找回密码、第三方登录和邮件发送。
- 备份 SQLite 时应使用在线备份 API 或停机正确备份 WAL，不在运行中只复制数据库主文件。

## 项目结构

```text
backend/app/            FastAPI 接口、业务逻辑、数据库与认证
  agent/                AI 助手：服务商、模型适配、工具循环、工具与知识库
  agent/knowledge/hk/   香港与 HKU 指南知识库（官方来源）
backend/migrations/     Alembic 数据库迁移
backend/tests/          后端测试
frontend/src/pages/     页面（今天、日程、课表、邮件、课堂翻译、HKU 指南）
frontend/src/components/ 组件（AI 对话、日程表单、新邮件通知、图书馆楼层图等）
scripts/                启动、部署、检查与模型脚本
docs/                   功能说明、开发计划与决策记录
```

## 文档

| 文档 | 内容 |
|---|---|
| [GMAIL_SETUP](docs/GMAIL_SETUP.md) | Gmail OAuth 配置、备份、解绑与常见问题 |
| [AUTO_MAIL](docs/AUTO_MAIL.md) | 新邮件自动检测、摘要与分类 |
| [REPLY_DRAFT](docs/REPLY_DRAFT.md) | 回复草稿与起草新邮件 |
| [LOCAL_MODEL](docs/LOCAL_MODEL.md) | 本机 Ollama + Qwen 部署与测试 |
| [HKU_CALENDAR](docs/HKU_CALENDAR.md) | HKU 课表导入与日程 |
| [LECTURE](docs/LECTURE.md) | 课程实时翻译、课后摘要与课程记录 |
| [AI_AGENT_PLAN](docs/AI_AGENT_PLAN.md) | AI 助手设计与进度 |
| [LOCAL_DEVELOPMENT](docs/LOCAL_DEVELOPMENT.md) | 本地环境与账号方案 |
| [DEVELOPMENT_STANDARDS](docs/DEVELOPMENT_STANDARDS.md) | 开发规范与 API 列表 |
| [MAC_APP_AND_WEBSITE_PLAN](docs/MAC_APP_AND_WEBSITE_PLAN.md) | Mac App 与介绍网站计划（待确认） |
| [decisions/](docs/decisions/) | 架构决策记录 |

开发规则见 [AGENTS.md](AGENTS.md)。
