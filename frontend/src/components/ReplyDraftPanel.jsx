import { useRef, useState } from 'react'
import { api } from '../api/client'
import Icon from './Icon'
import { tr } from '../i18n'

const intents = () => [
  {
    id: 'accept',
    label: tr('同意 / 接受', 'Accept'),
    hint: tr('例如：可以参加，但会晚到 10 分钟', 'e.g. I can come but will be 10 minutes late'),
  },
  {
    id: 'decline',
    label: tr('婉拒', 'Decline'),
    hint: tr('例如：这周没时间，下周可以再约', 'e.g. No time this week; next week works'),
  },
  {
    id: 'ask',
    label: tr('询问细节', 'Ask for details'),
    hint: tr('例如：想确认截止时间和提交方式', 'e.g. Confirm the deadline and how to submit'),
  },
  {
    id: 'schedule',
    label: tr('约时间', 'Set a time'),
    hint: tr('例如：周三下午或周四上午都可以', 'e.g. Wednesday afternoon or Thursday morning'),
  },
  {
    id: 'thanks',
    label: tr('致谢 / 确认收到', 'Thanks / received'),
    hint: tr('例如：谢谢提醒，会按时完成', 'e.g. Thanks for the reminder; will finish on time'),
  },
  {
    id: 'custom',
    label: tr('自己写要点', 'My own points'),
    hint: tr(
      '写下想表达的要点，AI 帮你组织成邮件',
      'Write your points; the AI turns them into an email',
    ),
  },
]
const SIGNATURE_KEY = 'hkmate.reply.signature'
// Gaps the drafting model leaves for the user: 【需补充：…】 in Chinese, [To fill in: …] in English.
export const PLACEHOLDER = /【需补充[:：][^】]{0,80}】|\[To fill in:[^\]]{0,80}\]/g

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
  const selectedIntent = intents().find((item) => item.id === intent)
  const edited = draft && text !== draft.body
  const placeholders = text.match(PLACEHOLDER) || []

  async function generate(event) {
    event.preventDefault()
    if (intent === 'custom' && !note.trim()) {
      setError(tr('请先写下想回复的内容要点。', 'Write the points you want to reply with first.'))
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
      setCopyState(tr('已复制到剪贴板。', 'Copied to the clipboard.'))
    } catch {
      editor.current?.select()
      setCopyState(
        tr(
          '无法自动复制，已选中草稿，请按 ⌘C 复制。',
          "Couldn't copy automatically. The draft is selected; press ⌘C to copy.",
        ),
      )
    }
  }

  return (
    <section className="reply-panel" aria-label={tr('起草回复', 'Draft a reply')}>
      <form className="reply-options" onSubmit={generate}>
        <fieldset>
          <legend>{tr('想怎么回复', 'How to reply')}</legend>
          <div className="reply-intents">
            {intents().map((item) => (
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
          {intent === 'custom'
            ? tr('回复要点', 'Reply points')
            : tr('补充说明（可选）', 'Notes (optional)')}
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
            {tr('语气', 'Tone')}
            <select value={tone} onChange={(event) => setTone(event.target.value)}>
              <option value="formal">{tr('正式', 'Formal')}</option>
              <option value="friendly">{tr('友好', 'Friendly')}</option>
            </select>
          </label>
          <label>
            {tr('语言', 'Language')}
            <select value={language} onChange={(event) => setLanguage(event.target.value)}>
              <option value="auto">{tr('跟随原邮件', 'Same as the email')}</option>
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
          <span>{tr('本地 Qwen 生成，只起草，不会发送', 'Drafted by local Qwen; never sent')}</span>
        </div>
      </form>
      {loading && (
        <p className="reply-status" role="status">
          {tr(
            '正在本机起草回复，通常需要 10–20 秒…',
            'Drafting on this computer; usually 10–20 seconds…',
          )}
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
            <dt>{tr('收件人', 'To')}</dt>
            <dd>
              {draft.to_name && draft.to_name !== draft.to_address
                ? `${draft.to_name} <${draft.to_address}>`
                : draft.to_address}
            </dd>
            <dt>{tr('主题', 'Subject')}</dt>
            <dd>{draft.subject}</dd>
          </dl>
          <label className="reply-editor">
            <span className="sr-only">{tr('回复草稿', 'Reply draft')}</span>
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
          <div className="reply-actions">
            <button type="button" className="mail-secondary" onClick={copy}>
              <Icon name="check" size={16} aria-hidden="true" />
              {tr('复制草稿', 'Copy draft')}
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
              <Icon name="mail" size={16} aria-hidden="true" />
              {tr('在 Gmail 中打开', 'Open in Gmail')}
            </a>
          </div>
          {copyState && (
            <p className="reply-status" role="status">
              {copyState}
            </p>
          )}
          <p className="reply-note-text">
            {tr(
              `草稿由本地模型生成，发送前请逐句核对。在 Gmail 中发送时，发件人为 ${draft.mailbox}；从学校邮箱转发来的邮件也会从这个地址回复。`,
              `Drafted by the local model; check every sentence before sending. Gmail sends it from ${draft.mailbox}, even for mail forwarded from your school account.`,
            )}
          </p>
        </div>
      )}
    </section>
  )
}
