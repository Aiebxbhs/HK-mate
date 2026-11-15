import { useEffect, useState } from 'react'
import { api } from '../api/client'
import Icon from '../components/Icon'
import {
  PLACEHOLDER,
  gmailComposeUrl,
  readSignature,
  saveSignature,
} from '../components/ReplyDraftPanel'
import { tr } from '../i18n'

const examples = () =>
  tr(
    [
      '问 Prof. Chan 能不能把 DASC7606 作业 2 延期一天，因为我这周生病了，可以提供医生证明',
      '约小组成员这周四下午讨论项目分工，地点在图书馆讨论室',
      '向教务处询问下学期选课时间和需要准备的材料',
    ],
    [
      'Ask Prof. Chan for a one-day extension on DASC7606 Assignment 2 because I was sick this week; I can provide a doctor’s note',
      'Invite my group to meet this Thursday afternoon in a library discussion room to split the project work',
      'Ask the faculty office when course selection opens next term and what I need to prepare',
    ],
  )

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
      setError(tr('请先写下这封邮件要说的内容。', 'Write what this email should say first.'))
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
      setCopyState(tr(`已复制${label}。`, `${label} copied.`))
    } catch {
      setCopyState(
        tr(
          `无法自动复制${label}，请手动选中后按 ⌘C。`,
          `Couldn't copy the ${label.toLowerCase()} automatically. Select it and press ⌘C.`,
        ),
      )
    }
  }

  return (
    <section className="compose-page" aria-label={tr('起草新邮件', 'Draft a new email')}>
      <form className="agenda-card compose-form" onSubmit={generate}>
        <h2 className="schedule-form-title">{tr('写给谁、说什么', 'Who and what')}</h2>
        <div className="compose-row">
          <label>
            {tr('收件人称呼（可选）', 'Recipient name (optional)')}
            <input
              value={recipient}
              maxLength={100}
              placeholder={tr(
                '例如：Prof. Chan、教务处、小组同学',
                'e.g. Prof. Chan, the faculty office, my group',
              )}
              onChange={(event) => setRecipient(event.target.value)}
            />
          </label>
          <label>
            {tr('收件人邮箱（可选）', 'Recipient address (optional)')}
            <input
              // Not type="email": a typo here must not block drafting; it only affects the link.
              inputMode="email"
              autoComplete="email"
              value={to}
              maxLength={254}
              placeholder={tr('只用于“在 Gmail 中打开”', 'Used only for “Open in Gmail”')}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
        </div>
        <label className="reply-note">
          {tr('想写的内容和要点', 'What to say')}
          <textarea
            rows={4}
            maxLength={1000}
            value={purpose}
            placeholder={tr(`例如：${examples()[0]}`, `e.g. ${examples()[0]}`)}
            onChange={(event) => setPurpose(event.target.value)}
          />
        </label>
        {!purpose && (
          <div className="compose-examples" aria-label={tr('示例', 'Examples')}>
            {examples().map((text) => (
              <button key={text} type="button" onClick={() => setPurpose(text)}>
                {text}
              </button>
            ))}
          </div>
        )}
        <div className="reply-settings">
          <label>
            {tr('语气', 'Tone')}
            <select value={tone} onChange={(event) => setTone(event.target.value)}>
              <option value="formal">{tr('正式', 'Formal')}</option>
              <option value="friendly">{tr('友好', 'Friendly')}</option>
            </select>
          </label>
          <label>
            {tr('语言', 'Language')}
            <select value={language} onChange={(event) => setLanguage(event.target.value)}>
              <option value="auto">{tr('跟随要点', 'Same as my points')}</option>
              <option value="zh">{tr('中文', 'Chinese')}</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            {tr('署名', 'Sign as')}
            <input
              value={signature}
              maxLength={60}
              placeholder={tr('例如：Sam', 'e.g. Sam')}
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
              ? tr('正在起草…', 'Drafting…')
              : draft
                ? edited
                  ? tr('重新生成（会覆盖修改）', 'Regenerate (replaces your edits)')
                  : tr('重新生成', 'Regenerate')
                : tr('生成草稿', 'Draft')}
          </button>
          <span>
            {tr(
              '本地 Qwen 生成，只起草，不会发送；收件人邮箱不会发送给模型',
              'Drafted by local Qwen and never sent; the recipient address is not shown to the model',
            )}
          </span>
        </div>
        {loading && (
          <p className="reply-status" role="status">
            {tr(
              '正在本机起草邮件，通常需要 10–20 秒…',
              'Drafting on this computer; usually 10–20 seconds…',
            )}
          </p>
        )}
        {error && (
          <p className="message error" role="alert">
            {error}
          </p>
        )}
      </form>

      {draft && (
        <section className="agenda-card compose-result" aria-label={tr('邮件草稿', 'Email draft')}>
          <h2 className="schedule-form-title">{tr('草稿', 'Draft')}</h2>
          <label>
            {tr('主题', 'Subject')}
            <input
              value={subject}
              maxLength={200}
              onChange={(event) => setSubject(event.target.value)}
            />
          </label>
          <label className="reply-editor">
            {tr('正文', 'Body')}
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
              {tr(
                `还有 ${placeholders.length} 处需要你补充：${placeholders.join('、')}`,
                `${placeholders.length} to fill in: ${placeholders.join(', ')}`,
              )}
            </p>
          )}
          {draft.missing_info.length > 0 && (
            <ul className="reply-checklist" aria-label={tr('发送前请核实', 'Check before sending')}>
              {draft.missing_info.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          <div className="compose-send">
            <label>
              {tr('发件邮箱', 'From')}
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
                  <option value="">{tr('尚未连接 Gmail', 'No Gmail connected')}</option>
                )}
              </select>
            </label>
            {!toValid && (
              <p className="schedule-error">
                {tr('收件人邮箱格式不正确。', "The recipient address isn't valid.")}
              </p>
            )}
          </div>
          <div className="reply-actions">
            <button
              type="button"
              className="mail-secondary"
              onClick={() => copy(subject, tr('主题', 'Subject'))}
            >
              {tr('复制主题', 'Copy subject')}
            </button>
            <button
              type="button"
              className="mail-secondary"
              onClick={() => copy(body, tr('正文', 'Body'))}
            >
              <Icon name="check" size={16} aria-hidden="true" />
              {tr('复制正文', 'Copy body')}
            </button>
            {from && toValid ? (
              <a
                className="mail-primary"
                href={gmailComposeUrl({ mailbox: from, to: to.trim(), subject, body })}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name="mail" size={16} aria-hidden="true" />
                {tr('在 Gmail 中打开', 'Open in Gmail')}
              </a>
            ) : (
              <span className="reply-note-text">
                {from
                  ? tr('请先改正收件人邮箱。', 'Fix the recipient address first.')
                  : tr(
                      '在“邮箱管理”连接 Gmail 后，可在 Gmail 中打开。',
                      'Connect Gmail in Mailboxes to open the draft in Gmail.',
                    )}
              </span>
            )}
          </div>
          {copyState && (
            <p className="reply-status" role="status">
              {copyState}
            </p>
          )}
          <p className="reply-note-text">
            {tr(
              '草稿由本地模型生成，发送前请逐句核对，并在 Gmail 中确认收件人后自行发送。',
              'Drafted by the local model. Check every sentence, confirm the recipient in Gmail, and send it yourself.',
            )}
          </p>
        </section>
      )}
    </section>
  )
}
