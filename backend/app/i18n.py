"""Interface language: Chinese (default) or English.

The browser sends the account's language in the ``X-HKM-Language`` header; background jobs read
``User.language``. Messages are written in Chinese in the code and translated here on the way
out, so a missing entry falls back to the Chinese text rather than failing.
"""

from typing import Literal

from starlette.requests import HTTPConnection

Language = Literal["zh", "en"]
LANGUAGES: tuple[Language, ...] = ("zh", "en")
DEFAULT_LANGUAGE: Language = "zh"
HEADER = "x-hkm-language"


def normalize(value: str | None) -> Language:
    return "en" if (value or "").strip().lower().startswith("en") else "zh"


def request_language(connection: HTTPConnection) -> Language:
    """The language the page is shown in; a query parameter serves WebSockets."""
    return normalize(connection.headers.get(HEADER) or connection.query_params.get("lang"))


def tr(text: str, language: str) -> str:
    """English text for a fixed Chinese message, or the original when there is none."""
    if language != "en":
        return text
    return EN.get(text, text)


EN: dict[str, str] = {
    # Accounts, sessions and request checks
    "尝试次数过多，请稍后再试。": "Too many attempts. Please try again later.",
    "无法使用这些信息注册，请尝试登录。": "Can't register with these details. Try signing in.",
    "账号或密码不正确。": "Incorrect username or password.",
    "登录已过期，请重新登录。": "Your session has expired. Please sign in again.",
    "当前密码不正确。": "The current password is incorrect.",
    "新密码不能与当前密码相同。": "The new password must differ from the current one.",
    "请求验证已失效，请刷新后重试。": "The request check expired. Refresh and try again.",
    "请求内容过大。": "The request is too large.",
    "服务暂时不可用，请稍后重试。": "The service is unavailable. Please try again later.",
    "请检查填写的信息。": "Please check the information you entered.",
    "请求无法完成。": "The request couldn't be completed.",
    # Calendar
    "HKU 课表": "HKU timetable",
    "日历查询范围应为 1–100 天。": "The calendar range must be 1–100 days.",
    "日程过多，请缩小查询日期范围。": "Too many events. Please narrow the date range.",
    "请填写日程标题。": "Please enter a title.",
    "日期超出可保存的范围。": "The date is outside the range that can be saved.",
    "截止事项只需要一个截止时间。": "A deadline only needs a due time.",
    "结束时间需要晚于开始时间。": "The end time must be after the start time.",
    "自建日程已达上限，请先删除旧日程。": (
        "You've reached the event limit. Delete old events first."
    ),
    "日程不存在或已被删除。": "This event doesn't exist or was deleted.",
    "HKU 课程来自学校课表，不能编辑；可以删除或标记完成。": (
        "HKU classes come from the university timetable and can't be edited; "
        "you can delete them or mark them done."
    ),
    "请粘贴 HKU Event Calendar 的订阅链接（hku.hk 网址，以 https:// 或 webcal:// 开头）。": (
        "Paste your HKU Event Calendar subscription link "
        "(an hku.hk address starting with https:// or webcal://)."
    ),
    "没能从 HKU 下载课表，请确认链接完整、已在 HKU 页面点击 SAVE，稍后再试。": (
        "Couldn't download the timetable from HKU. Check that the link is complete and that "
        "you clicked SAVE on the HKU page, then try again later."
    ),
    "日历文件过大。": "The calendar file is too large.",
    "本次导入暂不支持重复规则，请先展开事件。": (
        "Repeating events aren't supported in this import. Expand them first."
    ),
    "日历格式、时间或事件标识无效，未修改已有日程。": (
        "The calendar format, times or event IDs are invalid. Your events were not changed."
    ),
    "日历所属账号不可用。": "The calendar's account is unavailable.",
    # Gmail and mailboxes
    "邮箱加密密钥不可用，请检查本机配置。": (
        "The mailbox encryption key is unavailable. Check the local setup."
    ),
    "无法解密邮箱授权，请恢复原加密密钥。": (
        "Can't decrypt the mailbox authorization. Restore the original encryption key."
    ),
    "请配置 Google Web OAuth 凭证及本地回调地址。": (
        "Set up the Google Web OAuth credentials and the local callback address."
    ),
    "需要完整授予 Gmail 只读权限，请重新连接。": (
        "Full Gmail read-only access is required. Please reconnect."
    ),
    "Google 授权未完成，请重新连接。": "Google authorization wasn't completed. Please reconnect.",
    "Google 客户端已变更，请重新授权邮箱。": (
        "The Google client has changed. Please reauthorize the mailbox."
    ),
    "邮箱授权已过期或被撤销，请重新连接。": (
        "Mailbox access has expired or was revoked. Please reconnect."
    ),
    "暂时无法更新邮箱授权，请稍后重试。": (
        "Can't refresh mailbox access right now. Try again later."
    ),
    "邮箱授权无效，请重新连接。": "Mailbox access is invalid. Please reconnect.",
    "邮箱授权已失效，请重新连接。": "Mailbox access has expired. Please reconnect.",
    "Google 暂时限制了访问，请检查权限或稍后重试。": (
        "Google is limiting access for now. Check permissions or try again later."
    ),
    "邮件不存在或已从 Gmail 移除。": "This email doesn't exist or was removed from Gmail.",
    "暂时无法读取 Gmail，请稍后重试。": "Can't read Gmail right now. Please try again later.",
    "无法确认 Google 邮箱身份。": "Couldn't confirm the Google account.",
    "（无主题）": "(No subject)",
    "（未知发件人）": "(Unknown sender)",
    "（暂无可显示的正文）": "(No body to display)",
    "邮箱连接不存在。": "This mailbox connection doesn't exist.",
    "授权请求已过期或不属于当前登录，请重新连接。": (
        "The authorization request expired or belongs to another sign-in. Please reconnect."
    ),
    "Google 授权已取消。": "Google authorization was cancelled.",
    "授权请求无效。": "Invalid authorization request.",
    "该邮箱已绑定其他平台账号，请先解绑。": (
        "This mailbox is linked to another HK Mate account. Unlink it there first."
    ),
    "请重新登录后连接邮箱。": "Please sign in again before connecting a mailbox.",
    "当前最多连接 5 个邮箱。": "You can connect up to 5 mailboxes.",
    "该邮箱已连接，请刷新邮箱管理。": "This mailbox is already connected. Refresh Mailboxes.",
    "该邮箱已停止访问，请重试完成解绑。": (
        "Access to this mailbox has stopped. Retry to finish unlinking."
    ),
    "邮箱已断开，请刷新页面。": "The mailbox is disconnected. Please refresh the page.",
    "本地访问已停止，Google 撤销暂未完成，请重试解绑。": (
        "Local access has stopped, but Google revocation isn't finished. Retry unlinking."
    ),
    "邮件分页已过期，请刷新列表。": "The mail page expired. Please refresh the list.",
    "分页条件已改变，请刷新列表。": "The list filters changed. Please refresh the list.",
    "Gmail 返回的数据暂时无法处理，请刷新重试。": (
        "Gmail returned data that can't be processed. Refresh and try again."
    ),
    "这封邮件暂时无法解析，请稍后重试。": "This email can't be read right now. Try again later.",
    # Local model: summaries and drafts
    "本地模型正在处理其他邮件，请稍后重试。": (
        "The local model is busy with another email. Please try again shortly."
    ),
    "本地模型生成超时，请稍后重试。": "The local model timed out. Please try again later.",
    "请启动本地 Ollama 并确认模型已下载。": (
        "Start the local Ollama service and make sure the model is downloaded."
    ),
    "邮件过长，超出本地模型可处理的长度。": "The email is too long for the local model.",
    "本次摘要未通过内容或格式检查，请重试并核对原邮件。": (
        "This summary failed the content or format check. Retry and compare with the email."
    ),
    "请先写下想回复的内容要点。": "Write the points you want to reply with first.",
    "无法识别原邮件的发件人地址，不能起草回复。": (
        "Can't identify the sender's address, so a reply can't be drafted."
    ),
    "本次草稿未通过格式检查，请重新生成。": (
        "This draft failed the format check. Please regenerate."
    ),
    "请先写下这封邮件要说的内容。": "Write what this email should say first.",
    "内容过长，超出本地模型可处理的长度。": "The content is too long for the local model.",
    # New mail notifications
    "Gmail 授权已失效，请在邮箱管理中重新连接。": (
        "Gmail access has expired. Reconnect it in Mailboxes."
    ),
    "本机邮箱加密密钥不可用，请检查或恢复密钥。": (
        "The local mailbox encryption key is unavailable. Check or restore it."
    ),
    "Google 暂时限制了访问，系统会稍后重试。": (
        "Google is limiting access for now; HK Mate will retry later."
    ),
    "本地摘要生成超时，可以重试。": "The local summary timed out. You can retry.",
    "本地模型不可用，请启动 Ollama 后重试。": (
        "The local model is unavailable. Start Ollama and retry."
    ),
    "摘要中的截止时间未通过原文校验，请重试并核对原邮件。": (
        "A deadline in the summary couldn't be verified in the email. Retry and check the email."
    ),
    "邮件过长，超出本地模型可处理的长度，请直接阅读原邮件。": (
        "The email is too long for the local model. Please read the original."
    ),
    "邮件检测或摘要未能完成，请检查连接或重试。": (
        "Checking or summarizing mail didn't finish. Check the connection or retry."
    ),
    "新邮件通知不存在。": "This new-mail notice doesn't exist.",
    "自动邮件检测未开启。": "Automatic mail checking is off.",
    "这封邮件当前无法重试。": "This email can't be retried right now.",
    "请重新连接邮箱后重试。": "Reconnect the mailbox and try again.",
    # Lectures
    "时间需要包含时区。": "Times must include a time zone.",
    "课程记录不存在或已被删除。": "This lecture record doesn't exist or was deleted.",
    "笔记内容不能为空。": "A note can't be empty.",
    "笔记时间超出了课程时长。": "A note's time is outside the lecture.",
    "转写时间超出了课程时长。": "A transcript time is outside the lecture.",
    "摘要版本不受支持，请重新生成。": "This summary version isn't supported. Please regenerate.",
    "摘要时间超出了课程时长。": "A summary time is outside the lecture.",
    "请填写课程名称。": "Please enter the course name.",
    "课程时间无效：结束时间需晚于开始时间且不超过 12 小时。": (
        "Invalid lecture time: the end must be after the start and within 12 hours."
    ),
    "课程时间超出可保存的范围。": "The lecture time is outside the range that can be saved.",
    "录音时长不能超过课程时长。": "The recording can't be longer than the lecture.",
    "这节课识别到的讲课内容太少，无法生成摘要。": (
        "Too little speech was recognized in this lecture to summarize."
    ),
    "本地模型正忙，请稍后重试。": "The local model is busy. Please try again shortly.",
    "本次摘要未通过格式检查，请重新生成。": (
        "This summary failed the format check. Please regenerate."
    ),
    "请先登录。": "Please sign in first.",
    "请求来源不被允许。": "This request origin isn't allowed.",
    "这个账号已经在另一个页面录音，请先在那里暂停。": (
        "This account is already recording in another tab. Pause it there first."
    ),
    "语音识别组件未安装：请运行 uv sync --group speech。": (
        "Speech recognition isn't installed: run uv sync --group speech."
    ),
    "未找到 Whisper 模型：请按 docs/LECTURE_BENCH.md 下载到 private-data/models。": (
        "Whisper model not found: download it to private-data/models as described in "
        "docs/LECTURE_BENCH.md."
    ),
    "单次录音已超过 4 小时，请暂停后重新开始。": (
        "This recording has passed 4 hours. Pause and start again."
    ),
    "收到的音频格式不正确。": "The audio format received is invalid.",
    # AI assistant
    "正在查看天文台天气": "Checking the Observatory weather",
    "正在查询你的日程": "Looking up your schedule",
    "正在查找使用说明": "Reading the HK Mate guide",
    "正在查阅官方资料整理的指南": "Searching guides from official sources",
    "正在用本机模型起草邮件": "Drafting the email with the local model",
    "正在准备日程": "Preparing the event",
    "正在查找课程记录": "Searching your lecture records",
    "正在 Google 地图上找": "Searching Google Maps",
    "AI 助手尚未配置：请在 private-data/agent.env 中填写模型名和当前服务商的 API Key。": (
        "The AI assistant isn't set up: add the model name and the provider's API key to "
        "private-data/agent.env."
    ),
    "AI 助手配置的服务商不受支持。": "The configured AI provider isn't supported.",
    "所选服务商尚未接入，请换用 OpenAI 或兼容接口的服务商。": (
        "This provider isn't available yet. Use OpenAI or an OpenAI-compatible provider."
    ),
    "AI 服务地址必须使用 HTTPS。": "The AI service address must use HTTPS.",
    "AI 服务的 API Key 无效或没有权限，请检查配置。": (
        "The AI service API key is invalid or lacks permission. Check the settings."
    ),
    "所选 AI 服务不支持当前所在地区，请换用其他服务商或网络。": (
        "This AI service isn't available in your region. Try another provider or network."
    ),
    "AI 服务的额度已用完，请检查账户余额。": "The AI service quota is used up. Check your balance.",
    "AI 服务繁忙，请稍后再试。": "The AI service is busy. Please try again later.",
    "AI 服务响应超时，请稍后再试。": "The AI service timed out. Please try again later.",
    "暂时无法连接 AI 服务，请检查网络后重试。": (
        "Can't reach the AI service. Check your network and try again."
    ),
    "对话太长了，请点“新对话”后再问。": "This chat is too long. Start a new chat and ask again.",
    "配置的模型名称不存在，请检查设置。": (
        "The configured model name doesn't exist. Check the settings."
    ),
    "AI 服务拒绝了这次请求，请换个说法再试。": (
        "The AI service declined this request. Try rephrasing."
    ),
    "AI 服务返回了无法识别的内容，请重试。": (
        "The AI service returned something unreadable. Please retry."
    ),
    "AI 没有给出回答，请换个说法再试。": "The AI gave no answer. Try rephrasing.",
    "AI 助手暂时出错，请稍后再试。": "The AI assistant hit an error. Please try again later.",
    "最后一条消息应来自用户。": "The last message must come from the user.",
    "这个对话不存在或已被删除。": "This chat doesn't exist or was deleted.",
    "提问太频繁了，请稍等一会儿再试。": "You're asking too quickly. Wait a moment and try again.",
    "这条记忆不存在或已被删除。": "This memory doesn't exist or was deleted.",
    "通义千问（阿里云国际）": "Qwen (Alibaba Cloud International)",
    "通义千问（阿里云百炼）": "Qwen (Alibaba Cloud Bailian)",
    "Kimi（月之暗面）": "Kimi (Moonshot AI)",
    "智谱 GLM": "Zhipu GLM",
    "其他 OpenAI 兼容服务": "Other OpenAI-compatible service",
    # HKU guide and weather
    "图书馆": "Library",
    "交通与校园位置": "Transport & campus",
    "学生服务与联系方式": "Student services & contacts",
    "香港天文台": "Hong Kong Observatory",
}
