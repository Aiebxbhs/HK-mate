import { useRef, useState } from 'react'
import { api } from '../api/client'
import Icon from './Icon'

const INTENTS = [
  { id: 'accept', label: '同意 / 接受', hint: '例如：可以参加，但会晚到 10 分钟' },
  { id: 'decline', label: '婉拒', hint: '例如：这周没时间，下周可以再约' },
  { id: 'ask', label: '询问细节', hint: '例如：想确认截止时间和提交方式' },
  { id: 'schedule', label: '约时间', hint: '例如：周三下午或周四上午都可以' },
  { id: 'thanks', label: '致谢 / 确认收到', hint: '例如：谢谢提醒，会按时完成' },
  { id: 'custom', label: '自己写要点', hint: '写下想表达的要点，AI 帮你组织成邮件' },
]
const SIGNATURE_KEY = 'hkmate.reply.signature'
export const PLACEHOLDER = /【需补充[:：][^】]{0,80}】/g

export function readSignature() {
  try {
    return localStorage.getItem(SIGNATURE_KEY) || ''
  } catch {
    return ''
  }
}

export function saveSignature(value) {
  try {
    localStorage.setItem(SIGNATURE_KEY, value)
  } catch {
    // Remembering the signature is only a convenience.
  }
}

export function gmailComposeUrl({ mailbox, to, subject, body }) {
  const params = new URLSearchParams({
    authuser: mailbox,
    view: 'cm',
    fs: '1',
    to,
    su: subject,
    body,
  })
  return `https://mail.google.com/mail/?${params}`
}

/** Draft-only: generates text with the local model; nothing is sent from HK Mate. */
export default function ReplyDraftPanel({ connectionId, messageId }) {
  const [intent, setIntent] = useState('accept')
  const [note, setNote] = useState('')
  const [tone, setTone] = useState('formal')
  const [language, setLanguage] = useState('auto')
  const [signature, setSignature] = useState(readSignature)
  const [draft, setDraft] = useState(null)
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copyState, setCopyState] = useState('')
  const editor = useRef(null)
  const selectedIntent = INTENTS.find((item) => item.id === intent)
  const edited = draft && text !== draft.body
  const placeholders = text.match(PLACEHOLDER) || []

  async function generate(event) {
    event.preventDefault()
    if (intent === 'custom' && !note.trim()) {
      setError('请先写下想回复的内容要点。')
      return
    }
    setLoading(true)
    setError('')
    setCopyState('')
    try {
      const result = await api.replyDraft(connectionId, messageId, {
        intent,
        note: note.trim(),
        tone,
        language,
        signature: signature.trim(),
      })
      setDraft(result)
      setText(result.body)
    } catch (cause) {
      setError(cause.message)
    } finally {
      setLoading(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopyState('已复制到剪贴板。')
    } catch {
      editor.current?.select()
      setCopyState('无法自动复制，已选中草稿，请按 ⌘C 复制。')
    }
  }

  return (
    <section className="reply-panel" aria-label="起草回复">
      <form className="reply-options" onSubmit={generate}>
        <fieldset>
          <legend>想怎么回复</legend>
          <div className="reply-intents">
            {INTENTS.map((item) => (
              <label key={item.id} className={item.id === intent ? 'is-selected' : ''}>
                <input
                  type="radio"
                  name={`reply-intent-${messageId}`}
                  value={item.id}
                  checked={item.id === intent}
                  onChange={() => setIntent(item.id)}
                />
                {item.label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="reply-note">
          {intent === 'custom' ? '回复要点' : '补充说明（可选）'}
          <textarea
            rows={2}
            maxLength={500}
            value={note}
            placeholder={selectedIntent.hint}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
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
              <option value="auto">跟随原邮件</option>
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
          <span>本地 Qwen 生成，只起草，不会发送</span>
        </div>
      </form>
      {loading && (
        <p className="reply-status" role="status">
          正在本机起草回复，通常需要 10–20 秒…
        </p>
      )}
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      {draft && (
        <div className="reply-result">
          <dl className="reply-meta">
            <dt>收件人</dt>
            <dd>
              {draft.to_name && draft.to_name !== draft.to_address
                ? `${draft.to_name} <${draft.to_address}>`
                : draft.to_address}
            </dd>
            <dt>主题</dt>
            <dd>{draft.subject}</dd>
          </dl>
          <label className="reply-editor">
            <span className="sr-only">回复草稿</span>
            <textarea
              ref={editor}
              rows={10}
              value={text}
              onChange={(event) => {
                setText(event.target.value)
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
          <div className="reply-actions">
            <button type="button" className="mail-secondary" onClick={copy}>
              <Icon name="check" size={16} aria-hidden="true" />
              复制草稿
            </button>
            <a
              className="mail-primary"
              href={gmailComposeUrl({
                mailbox: draft.mailbox,
                to: draft.to_address,
                subject: draft.subject,
                body: text,
              })}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="mail" size={16} aria-hidden="true" />在 Gmail 中打开
            </a>
          </div>
          {copyState && (
            <p className="reply-status" role="status">
              {copyState}
            </p>
          )}
          <p className="reply-note-text">
            草稿由本地模型生成，发送前请逐句核对。在 Gmail 中发送时，发件人为 {draft.mailbox}
            ；从学校邮箱转发来的邮件也会从这个地址回复。
          </p>
        </div>
      )}
    </section>
  )
}
