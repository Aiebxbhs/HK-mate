# 本地环境检查与注册登录方案

检查日期：2026-11-12。阶段：环境检查完成；后续已实施注册登录、本地页面与运行脚本，详见 README。

## 1. 已核实的本机环境

| 项目 | 检查结果 |
|---|---|
| 系统 | macOS 26.6.2，Apple Silicon arm64 |
| 芯片与内存 | Apple M5，10 核 CPU、10 核 GPU、32 GiB 统一内存 |
| 磁盘 | 工作区所在卷约 729 GiB 可用 |
| 默认 Python | `/usr/bin/python3` 为 3.9.6，不用于本项目 |
| 项目 Python | uv 已安装的 CPython 3.13.15，创建 `.venv` 后验证可用 |
| 虚拟环境 | 根目录 `.venv/`；SQLite 3.53.1、TLS 标准库可正常导入 |
| Python 环境工具 | uv 0.12.19 |
| 前端运行环境 | 初检未发现 Node/npm；现已在 `.tools/node` 安装 Node 24，前端采用 React JavaScript + Vite + npm |
| Docker | Docker 29.9.3、Compose 5.7.0；Linux arm64 虚拟机约分配 7.75 GiB 内存 |
| 已有容器 | `comp7503-mongodb-1` 和 `comp7503-nodered-1`，属于其他项目，不复用或修改 |
| 本次端口快照 | 5000、7000、1880 已占用；8000、5173 在检查时未见监听 |

资源足以开展当前 Web 开发。小模型的容量、速度和算子兼容性尚未测试，不能仅凭内存推断具体模型可运行。

## 2. 本地部署和环境隔离

- 本阶段后端原生运行于 macOS 的 `.venv`，不修改系统 Python。
- 前端后续使用独立 Node 运行环境及项目 `node_modules`；Python 虚拟环境不管理 Node。
- 开发服务默认绑定 `127.0.0.1`，计划后端 8000、前端 5173，启动前重新检查端口。
- 后续前端通过开发代理访问 `/api`，本地部署使用同源入口，减少 Cookie 和跨域配置复杂度。
- 原生本地启动为基础能力，Docker 作为未来可选交付方式，不要求用户先搭建云服务器。
- 模型依赖、权重和推理服务后续单独管理，避免让 Web 登录服务依赖大模型启动。
- 后续已按用户授权在项目内安装原生 Ollama 与 Qwen3 4B 量化模型，使用 Metal；模型服务与 Web 虚拟环境分离，详见 [本地模型部署](LOCAL_MODEL.md)。
- 不修改已有容器、不安装全局 Python 包。模型权重与私有报告存放在 Git 忽略目录。

激活已创建的环境：

```bash
source .venv/bin/activate
python --version
```

也可直接使用 `.venv/bin/python`，无需激活。业务依赖已安装于 `.venv`，声明与锁文件为 `pyproject.toml` 和 `uv.lock`。

## 3. 当前数据库决定

本地单实例版本采用 **SQLite + SQLAlchemy + Alembic**：SQLite 存储数据，SQLAlchemy 管理数据库访问，Alembic 管理版本化迁移。不引入 Redis、MongoDB 或独立数据库容器。

- 数据文件计划为 `private-data/hkumate.sqlite3`，禁止提交 Git 或存入静态资源目录；文件路径通过配置管理。
- 启用外键约束、合理的 busy timeout 和 WAL；初始化时验证配置生效。
- 本阶段单实例运行，写事务保持短小；密码哈希和模型调用不在长事务内执行。
- 不把数据库文件放在网络共享目录；不让多个设备直接共享一个 SQLite 文件。
- 测试使用独立临时数据库，验证真实唯一约束、事务、外键和迁移，不接触开发数据。
- SQLite 文件及备份含私人数据，应限制本机访问权限；不能声称 SQLite 默认提供数据库文件加密。
- 备份使用 SQLite 在线备份能力，或停止服务并正确处理 WAL 后备份；运行时不只复制主 `.sqlite3` 文件。
- 若以后出现多实例、持续并发写入或独立数据库服务需求，再评估 PostgreSQL。ORM 有助于隔离实现，但迁移仍需检查类型、约束、数据转换和测试。

依据：[SQLite 适用场景](https://www.sqlite.org/whentouse.html)。

## 4. 注册登录的数据需求

### users

| 字段 | 要求 |
|---|---|
| id | 服务端生成的稳定字符串标识，主键 |
| username | 账号标识，非空、唯一且建立索引；新账号为 3–32 位字母、数字或下划线，归一化为小写 |
| display_name | 用户展示名；当前新账号默认使用账号名，不要求额外填写 |
| password_hash | Argon2id 密码哈希，非空，响应中不可出现 |
| is_active | 账号状态，默认启用 |
| created_at / updated_at | 统一 UTC 时间 |

账号去除首尾空白并按小写存储，以数据库唯一约束处理并发重复注册。不需要邮箱地址或邮箱验证，平台注册不代表获得邮箱读取权限。

新增迁移将旧 email 列更名为 username，并保留原账号、密码、用户 ID 和会话；历史邮箱字符串作为兼容登录标识保留，新注册禁止使用邮箱格式。

### sessions

| 字段 | 要求 |
|---|---|
| id | 内部会话标识，主键 |
| user_id | 外键关联 users，建立索引 |
| token_hash | 随机高熵会话令牌的哈希，唯一；数据库不存原始令牌 |
| created_at | 创建时间 |
| expires_at | 到期时间，建立索引 |

每次登录生成新令牌，默认会话最长有效期 7 天；每次认证都检查会话到期和账号状态。退出删除当前会话记录，旧令牌立即无法再次认证。定期清理过期会话，不依赖清理任务保证过期失效。

### auth_rate_limits

持久化登录、注册限流窗口：`bucket_key`、`window_started_at`、`attempt_count`、`blocked_until`。根据账号摘要和客户端来源组合限流，使用原子更新，不仅依靠进程内字典；不保存输入密码。具体阈值在实现中配置并测试。仅信任显式配置的反向代理提供的客户端来源，不直接相信任意转发头。

## 5. 认证与安全决定

- 使用服务端会话和 HttpOnly Cookie，不将认证令牌存入 localStorage，不引入 JWT 刷新体系。
- Cookie 默认 host-only、SameSite=Lax；HTTPS 部署启用 Secure。纯本机 HTTP 开发可显式关闭 Secure，不将这个配置用于公网部署。
- 修改状态的请求执行 Origin 校验和明确的 CSRF 防护，包括登录、注册、退出；不能仅依赖 SameSite。
- 密码长度初定 12–128 字符，允许粘贴与密码管理器，不去除用户密码首尾字符。使用成熟 Argon2id 实现，不自行编写哈希算法。
- 登录失败统一对外提示；未找到账号时也执行等价密码哈希验证，避免明显的耗时差异。
- 注册、登录都限制尝试频率与输入大小。日志、错误和接口响应不回显密码、会话令牌或哈希。
- 登录失败、过期、退出、未登录访问和不同用户会话隔离必须有集成测试。
- 忘记密码、邮箱验证、第三方登录、管理员权限与邮箱绑定不属于本轮功能；不展示无法使用的按钮。

参考：[FastAPI 密码哈希示例](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/)、[Cookie 安全配置](https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/Cookies)。本项目仅参考密码哈希方式，认证选择服务端会话，并不采用该示例的 JWT 方案。

## 6. 下一阶段验收范围

页面：注册、登录、登录后的基础首页及退出入口；处理加载、校验错误、网络异常和会话过期。首页只呈现账号信息和清晰的空状态，不填充虚构邮箱或 Agent 结果。

接口：`GET /api/v1/health`、`POST /api/v1/auth/register`、`POST /api/v1/auth/login`、`POST /api/v1/auth/logout`、`GET /api/v1/users/me`，按现有手册提供统一错误格式和明确 Schema。

前端已采用 React JavaScript + Vite + npm，Node 在项目内安装。Python 3.13 用于当前 Web 环境，模型运行时可按实际兼容性采用单独版本。运行与测试步骤见 README，决策见 `docs/decisions/0001-local-auth-foundation.md`。
