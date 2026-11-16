import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import Icon from '../components/Icon'
import MailCategoryTag from '../components/MailCategoryTag'
import ReplyDraftPanel from '../components/ReplyDraftPanel'
import Skeleton from '../components/Skeleton'
import NewMailNotice from '../components/NewMailNotice'
import { locale, mailText, tr } from '../i18n'

function MessageBody({ selected, onClose }) {
  const [message, setMessage] = useState(null)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState(null)
  const [summaryError, setSummaryError] = useState('')
  const [summarizing, setSummarizing] = useState(false)
  const mounted = useRef(false)
  useEffect(() => {
    let active = true
    mounted.current = true
    api
      .message(selected.connection_id, selected.id)
      .then((value) => {
        if (active) setMessage(value)
      })
      .catch((cause) => {
        if (active) setError(cause.message)
      })
    return () => {
      active = false
      mounted.current = false
    }
  }, [selected.connection_id, selected.id])

  async function summarize() {
    setSummarizing(true)
    setSummaryError('')
    try {
      const result = await api.summarizeMessage(selected.connection_id, selected.id)
      if (mounted.current) setSummary(result.summary)
    } catch (cause) {
      if (mounted.current) setSummaryError(cause.message)
    } finally {
      if (mounted.current) setSummarizing(false)
    }
  }
  return (
    <>
      <section className="message-reader" aria-label={tr('邮件正文', 'Email')}>
        <div className="reader-top">
          <span>
            {tr('只读，不会把原邮件标为已读', "Read-only; the email won't be marked as read")}
          </span>
          <button onClick={onClose} aria-label={tr('关闭邮件正文', 'Close email')}>
            <Icon name="close" />
          </button>
        </div>
        {error ? (
          <p className="message error" role="alert">
            {error}
          </p>
        ) : !message ? (
          <Skeleton label={tr('正在读取正文…', 'Loading email…')} rows={6} variant="text" />
        ) : (
          <>
            <h2>{mailText(message.subject)}</h2>
            <dl>
              <dt>{tr('发件人', 'From')}</dt>
              <dd>{mailText(message.sender)}</dd>
              <dt>{tr('收件人', 'To')}</dt>
              <dd>{message.recipients}</dd>
              <dt>{tr('所属邮箱', 'Mailbox')}</dt>
              <dd>{message.mailbox}</dd>
              <dt>{tr('收到时间', 'Received')}</dt>
              <dd>{new Date(message.received_at).toLocaleString(locale())}</dd>
            </dl>
            <div className="mail-body-text">{mailText(message.body)}</div>
            {message.attachments.length > 0 && (
              <div className="mail-attachments">
                <h3>{tr('附件（暂不下载）', 'Attachments (not downloaded)')}</h3>
                <ul>
                  {message.attachments.map((filename, index) => (
                    <li key={`${filename}-${index}`}>{filename}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mail-helper">
              {tr(
                '以纯文本展示，不加载远程图片；读取不会将原邮件标记为已读。',
                "Shown as plain text without remote images; reading here won't mark it as read in your mailbox.",
              )}
            </p>
          </>
        )}
      </section>
      <aside className="message-assistant" aria-label={tr('AI 助手', 'AI assistant')}>
        <div className="assistant-heading">
          <h2>{tr('AI 助手', 'AI assistant')}</h2>
          <p>
            {tr(
              '先看原邮件或摘要，再起草回复。全部由本地 Qwen 处理，不会发送邮件。',
              'Read the email or its summary, then draft a reply. Everything runs on the local Qwen model; nothing is sent.',
            )}
          </p>
        </div>
        <section className="reader-summary" aria-label={tr('本地邮件摘要', 'Local email summary')}>
          <div className="reader-summary-heading">
            <h3>{tr('邮件摘要', 'Summary')}</h3>
            <button
              type="button"
              className="mail-secondary"
              onClick={summarize}
              disabled={summarizing}
            >
              <Icon name="spark" size={16} />
              {summarizing
                ? tr('正在生成…', 'Generating…')
                : summary
                  ? tr('重新生成摘要', 'Regenerate summary')
                  : tr('生成摘要', 'Summarize')}
            </button>
          </div>
          {summarizing && (
            <p role="status">
              {tr(
                '正在本机生成摘要，首次加载可能稍慢…',
                'Summarizing on this computer; the first run may be slower…',
              )}
            </p>
          )}
          {summaryError && (
            <p className="message error" role="alert">
              {summaryError}
            </p>
          )}
          {summary && (
            <>
              <p className="reader-summary-text">{summary.overview}</p>
              {summary.uncertainties.length > 0 && (
                <p className="reader-summary-note">{summary.uncertainties.join('；')}</p>
              )}
            </>
          )}
          <p className="reader-summary-note">
            {tr(
              '由本地 Qwen 处理，请对照原邮件核实重要时间与要求。',
              'Made by the local Qwen model. Check important dates and requirements against the email.',
            )}
          </p>
        </section>
        <section className="reader-summary reader-reply" aria-label={tr('回复草稿', 'Reply draft')}>
          <div className="reader-summary-heading">
            <h3>{tr('回复草稿', 'Reply draft')}</h3>
          </div>
          <ReplyDraftPanel connectionId={selected.connection_id} messageId={selected.id} />
        </section>
      </aside>
    </>
  )
}

const hkDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' })
const hkTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Hong_Kong',
  hour: '2-digit',
  minute: '2-digit',
})
const hkMonthDay = {
  format: (value) =>
    new Intl.DateTimeFormat(locale(), {
      timeZone: 'Asia/Hong_Kong',
      month: tr('long', 'short'),
      day: 'numeric',
    }).format(value),
}

/** Today's mail shows the time; older mail shows the date (Hong Kong time). */
export function receivedLabel(value, now = new Date()) {
  const date = new Date(value)
  return hkDate.format(date) === hkDate.format(now) ? hkTime.format(date) : hkMonthDay.format(date)
}

export default function Inbox({ initialConnectionId = '', onManage }) {
  const [connections, setConnections] = useState([])
  const [connectionId, setConnectionId] = useState(initialConnectionId)
  const [scope, setScope] = useState('inbox')
  const [items, setItems] = useState([])
  const [cursor, setCursor] = useState(null)
  const [issues, setIssues] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [reload, setReload] = useState(0)
  const generation = useRef(0)

  useEffect(() => {
    let active = true
    api
      .connections()
      .then((data) => {
        if (active) setConnections(data.items)
      })
      .catch(() => {
        /* The message request below displays its own errors. */
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const id = ++generation.current
    let active = true
    async function load() {
      setLoading(true)
      setError('')
      setItems([])
      setCursor(null)
      setIssues([])
      setSelected(null)
      try {
        const result = await api.messages({ scope, connectionId })
        if (active && generation.current === id) {
          setItems(result.items)
          setCursor(result.next_cursor)
          setIssues(result.issues)
        }
      } catch (cause) {
        if (active && generation.current === id) setError(cause.message)
      } finally {
        if (active && generation.current === id) setLoading(false)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [scope, connectionId, reload])

  async function more() {
    const id = generation.current
    setLoading(true)
    setError('')
    try {
      const result = await api.messages({ scope, connectionId, cursor })
      if (generation.current !== id) return
      setItems((previous) => {
        const seen = new Set(previous.map((item) => `${item.connection_id}:${item.id}`))
        return [
          ...previous,
          ...result.items.filter((item) => !seen.has(`${item.connection_id}:${item.id}`)),
        ]
      })
      setCursor(result.next_cursor)
      setIssues(result.issues)
    } catch (cause) {
      if (generation.current === id) setError(cause.message)
    } finally {
      if (generation.current === id) setLoading(false)
    }
  }

  return (
    <section className="inbox-page" aria-label={tr('统一收件箱', 'Inbox')}>
      {/* New mail found by the background check, with summaries; moved here from the home page. */}
      <NewMailNotice />
      <div className="mail-toolbar">
        <div className="inbox-filters">
          <label>
            {tr('邮箱', 'Mailbox')}
            <select value={connectionId} onChange={(event) => setConnectionId(event.target.value)}>
              <option value="">{tr('全部已连接邮箱', 'All connected mailboxes')}</option>
              {connections.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.email_address}
                </option>
              ))}
            </select>
          </label>
          <label>
            {tr('邮件范围', 'Show')}
            <select value={scope} onChange={(event) => setScope(event.target.value)}>
              <option value="inbox">{tr('收件箱', 'Inbox')}</option>
              <option value="received">
                {tr('已收邮件（含归档）', 'All received (incl. archived)')}
              </option>
            </select>
          </label>
        </div>
        <button
          className="mail-secondary"
          onClick={() => setReload((value) => value + 1)}
          disabled={loading}
        >
          <Icon name="refresh" size={16} />
          {tr('刷新', 'Refresh')}
        </button>
      </div>
      <p className="mail-helper">
        {tr(
          '按收到时间汇总，一次加载 20 封。已收邮件筛选不包含已发送、草稿、垃圾邮件和垃圾箱。',
          'Sorted by time received, 20 at a time. “All received” excludes sent, drafts, spam and trash.',
        )}
      </p>
      {error && (
        <div className="message error" role="alert">
          {error}
          <button className="text-button" onClick={() => setReload((value) => value + 1)}>
            {tr('重新加载', 'Reload')}
          </button>
        </div>
      )}
      {issues.map((item) => (
        <div className="message error" role="status" key={item.connection_id}>
          {connections.find((connection) => connection.id === item.connection_id)?.email_address ||
            tr('部分邮箱', 'Some mailboxes')}
          {tr('：', ': ')}
          {item.message}
          <button className="text-button" onClick={onManage}>
            {tr('管理邮箱', 'Manage mailboxes')}
          </button>
        </div>
      ))}
      <div className={`inbox-layout${selected ? ' reader-open' : ''}`}>
        <div className="inbox-list" aria-label={tr('邮件列表', 'Mail list')}>
          {items.map((item) => (
            <button
              type="button"
              className={`mail-item${item.unread ? ' unread' : ''}${selected?.id === item.id && selected?.connection_id === item.connection_id ? ' selected' : ''}`}
              key={`${item.connection_id}:${item.id}`}
              onClick={() => setSelected(item)}
            >
              <div className="mail-item-top">
                {item.unread && (
                  <span className="mail-unread-dot" aria-label={tr('未读', 'Unread')} />
                )}
                <span className="mail-sender">{mailText(item.sender)}</span>
                <MailCategoryTag
                  category={item.category}
                  pending={item.category_status === 'pending'}
                />
                <time dateTime={item.received_at}>{receivedLabel(item.received_at)}</time>
              </div>
              <strong>{mailText(item.subject)}</strong>
              <p>{item.snippet || tr('（暂无预览）', '(No preview)')}</p>
              {/* Which mailbox only matters when more than one is connected. */}
              {connections.length > 1 && <span className="mail-source">{item.mailbox}</span>}
            </button>
          ))}
          {loading && <Skeleton label={tr('正在读取邮件…', 'Loading mail…')} rows={5} />}
          {!loading && !error && items.length === 0 && (
            <div className="mail-empty">
              <Icon name="mail" size={36} />
              <h2>{tr('暂无可显示的邮件', 'No mail to show')}</h2>
              <p>
                {connections.length
                  ? tr(
                      '当前筛选没有邮件，或邮箱需要重新授权。',
                      'No mail for these filters, or a mailbox needs reauthorizing.',
                    )
                  : tr(
                      '先添加 Google 邮箱，再来查看收件箱。',
                      'Add a Google mailbox first, then come back.',
                    )}
              </p>
              <button className="mail-secondary" onClick={onManage}>
                {tr('前往邮箱管理', 'Go to Mailboxes')}
              </button>
            </div>
          )}
          {cursor && (
            <button className="load-more" onClick={more} disabled={loading}>
              {tr('加载更多邮件', 'Load more')}
            </button>
          )}
        </div>
        {selected && (
          <MessageBody
            key={`${selected.connection_id}:${selected.id}`}
            selected={selected}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </section>
  )
}
