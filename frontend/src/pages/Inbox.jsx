import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import Icon from '../components/Icon'
import MailCategoryTag from '../components/MailCategoryTag'
import ReplyDraftPanel from '../components/ReplyDraftPanel'
import Skeleton from '../components/Skeleton'
import NewMailNotice from '../components/NewMailNotice'

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
      <section className="message-reader" aria-label="邮件正文">
        <div className="reader-top">
          <span>只读，不会把原邮件标为已读</span>
          <button onClick={onClose} aria-label="关闭邮件正文">
            <Icon name="close" />
          </button>
        </div>
        {error ? (
          <p className="message error" role="alert">
            {error}
          </p>
        ) : !message ? (
          <Skeleton label="正在读取正文…" rows={6} variant="text" />
        ) : (
          <>
            <h2>{message.subject}</h2>
            <dl>
              <dt>发件人</dt>
              <dd>{message.sender}</dd>
              <dt>收件人</dt>
              <dd>{message.recipients}</dd>
              <dt>所属邮箱</dt>
              <dd>{message.mailbox}</dd>
              <dt>收到时间</dt>
              <dd>{new Date(message.received_at).toLocaleString('zh-CN')}</dd>
            </dl>
            <div className="mail-body-text">{message.body}</div>
            {message.attachments.length > 0 && (
              <div className="mail-attachments">
                <h3>附件（暂不下载）</h3>
                <ul>
                  {message.attachments.map((filename, index) => (
                    <li key={`${filename}-${index}`}>{filename}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mail-helper">
              以纯文本展示，不加载远程图片；读取不会将 Gmail 原邮件标记为已读。
            </p>
          </>
        )}
      </section>
      <aside className="message-assistant" aria-label="AI 助手">
        <div className="assistant-heading">
          <h2>AI 助手</h2>
          <p>先看原邮件或摘要，再起草回复。全部由本地 Qwen 处理，不会发送邮件。</p>
        </div>
        <section className="reader-summary" aria-label="本地邮件摘要">
          <div className="reader-summary-heading">
            <h3>邮件摘要</h3>
            <button
              type="button"
              className="mail-secondary"
              onClick={summarize}
              disabled={summarizing}
            >
              <Icon name="spark" size={16} />
              {summarizing ? '正在生成…' : summary ? '重新生成摘要' : '生成摘要'}
            </button>
          </div>
          {summarizing && <p role="status">正在本机生成摘要，首次加载可能稍慢…</p>}
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
          <p className="reader-summary-note">由本地 Qwen 处理，请对照原邮件核实重要时间与要求。</p>
        </section>
        <section className="reader-summary reader-reply" aria-label="回复草稿">
          <div className="reader-summary-heading">
            <h3>回复草稿</h3>
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
const hkMonthDay = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Hong_Kong',
  month: 'long',
  day: 'numeric',
})

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
    <section className="inbox-page" aria-label="统一收件箱">
      {/* New mail found by the background check, with summaries; moved here from the home page. */}
      <NewMailNotice />
      <div className="mail-toolbar">
        <div className="inbox-filters">
          <label>
            邮箱
            <select value={connectionId} onChange={(event) => setConnectionId(event.target.value)}>
              <option value="">全部已连接邮箱</option>
              {connections.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.email_address}
                </option>
              ))}
            </select>
          </label>
          <label>
            邮件范围
            <select value={scope} onChange={(event) => setScope(event.target.value)}>
              <option value="inbox">收件箱</option>
              <option value="received">已收邮件（含归档）</option>
            </select>
          </label>
        </div>
        <button
          className="mail-secondary"
          onClick={() => setReload((value) => value + 1)}
          disabled={loading}
        >
          <Icon name="refresh" size={16} />
          刷新
        </button>
      </div>
      <p className="mail-helper">
        按收到时间汇总，一次加载 20 封。已收邮件筛选不包含已发送、草稿、垃圾邮件和垃圾箱。
      </p>
      {error && (
        <div className="message error" role="alert">
          {error}
          <button className="text-button" onClick={() => setReload((value) => value + 1)}>
            重新加载
          </button>
        </div>
      )}
      {issues.map((item) => (
        <div className="message error" role="status" key={item.connection_id}>
          {connections.find((connection) => connection.id === item.connection_id)?.email_address ||
            '部分邮箱'}
          ：{item.message}
          <button className="text-button" onClick={onManage}>
            管理邮箱
          </button>
        </div>
      ))}
      <div className={`inbox-layout${selected ? ' reader-open' : ''}`}>
        <div className="inbox-list" aria-label="邮件列表">
          {items.map((item) => (
            <button
              type="button"
              className={`mail-item${item.unread ? ' unread' : ''}${selected?.id === item.id && selected?.connection_id === item.connection_id ? ' selected' : ''}`}
              key={`${item.connection_id}:${item.id}`}
              onClick={() => setSelected(item)}
            >
              <div className="mail-item-top">
                {item.unread && <span className="mail-unread-dot" aria-label="未读" />}
                <span className="mail-sender">{item.sender}</span>
                <MailCategoryTag
                  category={item.category}
                  pending={item.category_status === 'pending'}
                />
                <time dateTime={item.received_at}>{receivedLabel(item.received_at)}</time>
              </div>
              <strong>{item.subject}</strong>
              <p>{item.snippet || '（暂无预览）'}</p>
              {/* Which mailbox only matters when more than one is connected. */}
              {connections.length > 1 && <span className="mail-source">{item.mailbox}</span>}
            </button>
          ))}
          {loading && <Skeleton label="正在读取邮件…" rows={5} />}
          {!loading && !error && items.length === 0 && (
            <div className="mail-empty">
              <Icon name="mail" size={36} />
              <h2>暂无可显示的邮件</h2>
              <p>
                {connections.length
                  ? '当前筛选没有邮件，或邮箱需要重新授权。'
                  : '先添加 Google 邮箱，再来查看收件箱。'}
              </p>
              <button className="mail-secondary" onClick={onManage}>
                前往邮箱管理
              </button>
            </div>
          )}
          {cursor && (
            <button className="load-more" onClick={more} disabled={loading}>
              加载更多邮件
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
