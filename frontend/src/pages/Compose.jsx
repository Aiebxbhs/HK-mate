import { useEffect, useState } from 'react'
import { api } from '../api/client'
import Icon from '../components/Icon'
import {
  PLACEHOLDER,
  gmailComposeUrl,
  readSignature,
  saveSignature,
} from '../components/ReplyDraftPanel'

const EXAMPLES = [
  '问 Prof. Chan 能不能把 DASC7606 作业 2 延期一天，因为我这周生病了，可以提供医生证明',
  '约小组成员这周四下午讨论项目分工，地点在图书馆讨论室',
  '向教务处询问下学期选课时间和需要准备的材料',
]

/** A brand-new email from the user's own points. Nothing is sent from HK Mate. */
export default function Compose() {
  const [mailboxes, setMailboxes] = useState([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [recipient, setRecipient] = useState('')
  const [purpose, setPurpose] = useState('')
  const [tone, setTone] = useState('formal')
  const [language, setLanguage] = useState('auto')
  const [signature, setSignature] = useState(readSignature)
  const [draft, setDraft] = useState(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copyState, setCopyState] = useState('')

  useEffect(() => {
    let active = true
    api
      .connections()
      .then((result) => {
        if (!active) return
        const connected = result.items.filter((item) => item.status === 'connected')
        setMailboxes(connected)
        setFrom((current) => current || connected[0]?.email_address || '')
      })
      .catch(() => {
        // The Gmail button simply stays unavailable; drafting still works.
      })
    return () => {
      active = false
    }
  }, [])

  const edited = draft && (subject !== draft.subject || body !== draft.body)
  const placeholders = `${subject}\n${body}`.match(PLACEHOLDER) || []
  const toValid = !to || /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to.trim())

  async function generate(event) {
    event.preventDefault()
    if (!purpose.trim()) {
      setError('请先写下这封邮件要说的内容。')
      return
    }
    setLoading(true)
    setError('')
    setCopyState('')
    try {
      const result = await api.composeDraft({
        purpose: purpose.trim(),
        recipient: recipient.trim(),
        tone,
        language,
        signature: signature.trim(),
      })
      setDraft(result)
      setSubject(result.subject)
      setBody(result.body)
    } catch (cause) {
      setError(cause.message)
    } finally {
      setLoading(false)
    }
  }

  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text)
      setCopyState(`已复制${label}。`)
    } catch {
      setCopyState(`无法自动复制${label}，请手动选中后按 ⌘C。`)
    }
  }

  return (
    <section className="compose-page" aria-label="起草新邮件">
      <form className="agenda-card compose-form" onSubmit={generate}>
        <h2 className="schedule-form-title">写给谁、说什么</h2>
        <div className="compose-row">
          <label>
            收件人称呼（可选）
            <input
              value={recipient}
              maxLength={100}
              placeholder="例如：Prof. Chan、教务处、小组同学"
              onChange={(event) => setRecipient(event.target.value)}
            />
          </label>
          <label>
            收件人邮箱（可选）
            <input
              // Not type="email": a typo here must not block drafting; it only affects the link.
              inputMode="email"
              autoComplete="email"
              value={to}
              maxLength={254}
              placeholder="只用于“在 Gmail 中打开”"
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
        </div>
        <label className="reply-note">
          想写的内容和要点
          <textarea
            rows={4}
            maxLength={1000}
            value={purpose}
            placeholder={`例如：${EXAMPLES[0]}`}
            onChange={(event) => setPurpose(event.target.value)}
          />
        </label>
        {!purpose && (
          <div className="compose-examples" aria-label="示例">
            {EXAMPLES.map((text) => (
              <button key={text} type="button" onClick={() => setPurpose(text)}>
                {text}
              </button>
            ))}
          </div>
        )}
        <div className="reply-settings">
          <label>
            语气
            <select value={tone} onChange={(event) => setTone(event.target.value)}>
              <option value="formal">正式</option>
              <option value="friendly">友好</option>
            </select>
          </label>
          <label>
            语言
            <select value={language} onChange={(event) => setLanguage(event.target.value)}>
              <option value="auto">跟随要点</option>
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            署名
            <input
              value={signature}
              maxLength={60}
              placeholder="例如：Sam"
              onChange={(event) => {
                setSignature(event.target.value)
                saveSignature(event.target.value)
              }}
            />
          </label>
        </div>
        <div className="reply-generate">
          <button type="submit" className="mail-primary" disabled={loading}>
            <Icon name="spark" size={16} aria-hidden="true" />
            {loading
              ? '正在起草…'
              : draft
                ? edited
                  ? '重新生成（会覆盖修改）'
                  : '重新生成'
                : '生成草稿'}
          </button>
          <span>本地 Qwen 生成，只起草，不会发送；收件人邮箱不会发送给模型</span>
        </div>
        {loading && (
          <p className="reply-status" role="status">
            正在本机起草邮件，通常需要 10–20 秒…
          </p>
        )}
        {error && (
          <p className="message error" role="alert">
            {error}
          </p>
        )}
      </form>

      {draft && (
        <section className="agenda-card compose-result" aria-label="邮件草稿">
          <h2 className="schedule-form-title">草稿</h2>
          <label>
            主题
            <input
              value={subject}
              maxLength={200}
              onChange={(event) => setSubject(event.target.value)}
            />
          </label>
          <label className="reply-editor">
            正文
            <textarea
              rows={12}
              value={body}
              onChange={(event) => {
                setBody(event.target.value)
                setCopyState('')
              }}
            />
          </label>
          {placeholders.length > 0 && (
            <p className="reply-warning" role="status">
              还有 {placeholders.length} 处需要你补充：{placeholders.join('、')}
            </p>
          )}
          {draft.missing_info.length > 0 && (
            <ul className="reply-checklist" aria-label="发送前请核实">
              {draft.missing_info.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          <div className="compose-send">
            <label>
              发件邮箱
              <select
                value={from}
                disabled={!mailboxes.length}
                onChange={(event) => setFrom(event.target.value)}
              >
                {mailboxes.length ? (
                  mailboxes.map((item) => (
                    <option key={item.id} value={item.email_address}>
                      {item.email_address}
                    </option>
                  ))
                ) : (
                  <option value="">尚未连接 Gmail</option>
                )}
              </select>
            </label>
            {!toValid && <p className="schedule-error">收件人邮箱格式不正确。</p>}
          </div>
          <div className="reply-actions">
            <button type="button" className="mail-secondary" onClick={() => copy(subject, '主题')}>
              复制主题
            </button>
            <button type="button" className="mail-secondary" onClick={() => copy(body, '正文')}>
              <Icon name="check" size={16} aria-hidden="true" />
              复制正文
            </button>
            {from && toValid ? (
              <a
                className="mail-primary"
                href={gmailComposeUrl({ mailbox: from, to: to.trim(), subject, body })}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name="mail" size={16} aria-hidden="true" />在 Gmail 中打开
              </a>
            ) : (
              <span className="reply-note-text">
                {from ? '请先改正收件人邮箱。' : '在“邮箱管理”连接 Gmail 后，可在 Gmail 中打开。'}
              </span>
            )}
          </div>
          {copyState && (
            <p className="reply-status" role="status">
              {copyState}
            </p>
          )}
          <p className="reply-note-text">
            草稿由本地模型生成，发送前请逐句核对，并在 Gmail 中确认收件人后自行发送。
          </p>
        </section>
      )}
    </section>
  )
}
