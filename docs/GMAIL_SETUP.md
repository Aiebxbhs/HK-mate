# Gmail 只读接入

## 当前功能

- 邮箱管理：添加 Google 邮箱、查看状态、重新授权和解绑，最多 5 个邮箱。
- 统一收件箱：跨邮箱按收到时间合并，每页 20 封；支持按邮箱和邮件范围筛选、刷新与继续加载。
- 默认范围为 Gmail 的 INBOX。“已收邮件（含归档）”使用 `-in:sent -in:drafts -in:trash`，默认不包括垃圾邮件，不代表导出整个邮箱。
- 详情展示主题、发件人、收件人、来源邮箱、时间和纯文本正文。附件只显示文件名，不自动下载；远程图片和 HTML 脚本不执行。
- Gmail 只读权限不能修改原邮箱状态；在平台查看不会把 Gmail 原邮件标为已读。不实现发送、删除或移动邮件。

## Google Cloud 配置

使用 Web application OAuth 客户端，启用 Gmail API；测试状态下将要连接的 Gmail 加入测试用户。只申请：

```text
https://www.googleapis.com/auth/gmail.readonly
```

注册的回调地址必须与后端一致：

```text
http://127.0.0.1:8000/api/v1/email-connections/google/callback
```

客户端 JSON 放在 `private-data/google-oauth-client.json`。应用只读取该文件，绝不向前端返回 client_secret。配置错误时添加按钮不可用并提示修复。

## 操作步骤

1. `bash scripts/dev.sh` 启动，或使用已经运行的服务。
2. 在 Chrome/Safari 打开 `http://127.0.0.1:5173`，使用平台账号登录。
3. 菜单 → 邮箱管理 → 添加 Google 邮箱。
4. 在 Google 页面选取已加入测试名单的邮箱并授权 Gmail 只读访问。
5. 回到邮箱管理，确认邮箱状态，然后进入统一收件箱。

不要混用 localhost 和 127.0.0.1，否则登录 Cookie 可能不随回调发送。OAuth 状态与发起用户及登录会话绑定，有效期 10 分钟，一次性使用；中途退出或重新登录后请重新发起授权。

Google 登录可能限制内嵌浏览器；授权流程优先使用普通 Chrome/Safari。Google 设置变更、缺少测试用户、未授权完整只读权限或网络故障，都会导致连接失败，不应通过修改数据库伪造连接成功。

## 本地密钥、缓存与解绑

- 第一次发起授权时自动生成 `private-data/mail-token.key`，文件权限为仅当前用户可读写。密钥与凭证都由 Git 忽略。
- OAuth PKCE verifier、访问/刷新令牌与分页缓存均使用 Fernet 加密；不要删除或替换已有密钥。数据库中已有邮箱但密钥丢失时拒绝自动重建，须恢复原密钥。
- 备份数据库时单独妥善备份密钥及客户端 JSON；仅备份数据库无法恢复邮箱授权。默认仍属于同一台设备的本地保护，不提供系统级密钥库或全盘加密。
- 不持久化邮件正文。为多邮箱稳定合并，短期加密保存尚未显示的邮件头、预览及 Gmail 分页位置；分页有效期 20 分钟，后续分页写入时清理过期缓存。新邮件通过刷新首屏获取。
- 同一 Gmail 地址只能绑定一个平台账号；不同平台用户之间的连接、正文、缓存游标均隔离。
- 解绑先停止本地访问、清除该用户分页缓存，再向 Google 撤销刷新令牌。撤销失败时保留“解绑待完成”，不继续读邮件；可重试完成撤销。
- 某个邮箱失败不阻止其他邮箱展示，列表会提示对应邮箱的问题。失败邮箱需刷新重试；授权失效需重新授权。
- 测试模式的 Gmail 刷新令牌可能在 7 天后失效，页面会提示重新授权。网络失败不直接当成授权失效。
- 不在日志记录邮件正文、授权码、令牌或 OAuth 客户端密钥；启动脚本关闭 Uvicorn 访问日志，避免回调查询参数被自动记录。

## 配置与 API

配置项：`HKM_GOOGLE_CLIENT_FILE`、`HKM_GOOGLE_REDIRECT_URI`、`HKM_TOKEN_KEY_FILE`、`HKM_WEB_URL`，默认值见 `.env.example`。生产构建同源运行在 8000 时，应将 `HKM_WEB_URL` 设为 `http://127.0.0.1:8000`；OAuth 回调仍保持 Google 注册的完整地址。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/v1/email-connections` | 当前用户连接及 Google 配置状态 |
| POST | `/api/v1/email-connections/google/authorize` | 生成绑定当前登录会话的授权地址，需 CSRF |
| GET | `/api/v1/email-connections/google/callback` | 校验 state/PKCE，回调后跳回固定本地页面 |
| DELETE | `/api/v1/email-connections/{id}` | 停止访问并撤销授权，需 CSRF |
| GET | `/api/v1/messages` | scope=inbox/received，可带 connection_id、cursor |
| GET | `/api/v1/email-connections/{id}/messages/{message_id}` | 校验归属后读取正文 |

开发与回归测试使用合成数据和模拟 Google 服务，不要求真实凭证；真实 OAuth 和 Gmail 正文读取需用户完成授权后手动验收。

来源：[Google OAuth Web 流程](https://developers.google.com/identity/protocols/oauth2/web-server)、[Gmail 权限](https://developers.google.com/workspace/gmail/api/auth/scopes)、[Gmail 邮件分页](https://developers.google.com/workspace/gmail/api/guides/list-messages)、[刷新令牌有效期](https://developers.google.com/identity/protocols/oauth2#expiration)。
