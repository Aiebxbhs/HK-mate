import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import AgentCard, { ChoicesCard } from './AgentCards'
import Icon from './Icon'
import { readSignature } from './ReplyDraftPanel'
import Skeleton from './Skeleton'

// Shown below the reply text: sources at the end of the answer, then quick replies.
const AFTER_TEXT = ['knowledge', 'choices']
const SUGGESTIONS = [
  '明天有什么课？',
  '帮我写封请假邮件',
  '帮我找找西营盘美食',
  '怎么办香港身份证？',
]

/** Model replies may use light Markdown; show it as plain text without the markers. */
export function plainText(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '• ')
}

const dayTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Hong_Kong',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function HistoryPanel({ currentId, onOpen, onDeleted }) {
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const [confirmId, setConfirmId] = useState('')

  useEffect(() => {
    let active = true
    api
      .agentConversations()
      .then((value) => active && setItems(value.items))
      .catch((cause) => active && setError(cause.message))
    return () => {
      active = false
    }
  }, [])

  async function remove(id) {
    try {
      await api.deleteAgentConversation(id)
      setItems((current) => current.filter((item) => item.id !== id))
      setConfirmId('')
      onDeleted(id)
    } catch (cause) {
      setError(cause.message)
    }
  }

  return (
    <section className="agent-panel" aria-label="历史对话">
      <p className="agent-panel-note">保存在本机（加密），只保留最近 20 个对话。</p>
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      {!items ? (
        <Skeleton label="正在读取…" rows={3} />
      ) : items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item.id} className={item.id === currentId ? 'is-current' : ''}>
              <button type="button" className="agent-panel-main" onClick={() => onOpen(item.id)}>
                <span>{item.title || '（无标题）'}</span>
                <small>{dayTime.format(new Date(item.updated_at))}</small>
              </button>
              {confirmId === item.id ? (
                <span className="agent-panel-confirm" role="group" aria-label="确认删除对话">
                  <button type="button" className="danger-text" onClick={() => remove(item.id)}>
                    删除
                  </button>
                  <button type="button" onClick={() => setConfirmId('')}>
                    取消
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="agent-panel-delete"
                  aria-label={`删除对话 ${item.title}`}
                  onClick={() => setConfirmId(item.id)}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="agent-panel-empty">还没有保存的对话。</p>
      )}
    </section>
  )
}

function MemoryPanel() {
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    let active = true
    api
      .agentMemories()
      .then((value) => active && setItems(value.items))
      .catch((cause) => active && setError(cause.message))
    return () => {
      active = false
    }
  }, [])

  async function run(action, after) {
    try {
      await action()
      after()
    } catch (cause) {
      setError(cause.message)
    }
  }

  return (
    <section className="agent-panel" aria-label="AI 的记忆">
      <p className="agent-panel-note">
        AI 从对话中记住的关于你的信息，会随每次对话发送给 AI 服务，用来让回答更合你心意。
      </p>
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      {!items ? (
        <Skeleton label="正在读取…" rows={3} />
      ) : items.length ? (
        <>
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <span className="agent-panel-main">{item.fact}</span>
                <button
                  type="button"
                  className="agent-panel-delete"
                  aria-label={`忘掉 ${item.fact}`}
                  onClick={() =>
                    run(
                      () => api.deleteAgentMemory(item.id),
                      () => setItems((current) => current.filter((m) => m.id !== item.id)),
                    )
                  }
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          {confirmClear ? (
            <span className="agent-panel-confirm" role="group" aria-label="确认清空记忆">
              清空后 AI 会忘掉以上全部内容。
              <button
                type="button"
                className="danger-text"
                onClick={() =>
                  run(
                    () => api.clearAgentMemories(),
                    () => {
                      setItems([])
                      setConfirmClear(false)
                    },
                  )
                }
              >
                清空
              </button>
              <button type="button" onClick={() => setConfirmClear(false)}>
                取消
              </button>
            </span>
          ) : (
            <button type="button" className="text-button" onClick={() => setConfirmClear(true)}>
              全部清空
            </button>
          )}
        </>
      ) : (
        <p className="agent-panel-empty">
          还没有记住任何内容。聊天时说说你的偏好（比如“我不吃辣”），AI 会记下来。
        </p>
      )}
    </section>
  )
}

function Steps({ steps }) {
  if (!steps.length) return null
  return (
    <ul className="agent-steps" aria-label="AI 助手的操作">
      {steps.map((step, index) => (
        <li key={`${step.tool}-${index}`} className={`is-${step.state}`}>
          {step.state === 'running' ? (
            <span className="lecture-summary-spinner" aria-hidden="true" />
          ) : (
            <span aria-hidden="true">{step.state === 'done' ? '✓' : '!'}</span>
          )}
          {step.state === 'running' ? `${step.label}…` : step.label.replace(/^正在/, '已')}
          {step.state === 'failed' && '（未成功）'}
        </li>
      ))}
    </ul>
  )
}

export default function AgentChat({ onNavigate }) {
  const [status, setStatus] = useState(null)
  const [statusError, setStatusError] = useState('')
  const [messages, setMessages] = useState([])
  const [conversation, setConversation] = useState(null)
  const [panel, setPanel] = useState('')
  const [loadError, setLoadError] = useState('')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const list = useRef(null)
  const controller = useRef(null)
  const input = useRef(null)

  // One line by default; grows with the text (capped in CSS) and shrinks after sending.
  useEffect(() => {
    const box = input.current
    if (!box) return
    box.style.height = 'auto'
    box.style.height = `${box.scrollHeight}px`
  }, [draft])

  useEffect(() => {
    let active = true
    api
      .agentStatus()
      .then((value) => active && setStatus(value))
      .catch((cause) => active && setStatusError(cause.message))
    return () => {
      active = false
      controller.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight
  }, [messages])

  function updateLast(change) {
    setMessages((current) => {
      const next = [...current]
      next[next.length - 1] = change(next[next.length - 1])
      return next
    })
  }

  async function send(text) {
    const question = text.trim()
    if (!question || busy) return
    setPanel('')
    setMessages((current) => [
      ...current,
      { role: 'user', content: question },
      { role: 'assistant', content: '', steps: [], cards: [], pending: true },
    ])
    setDraft('')
    setBusy(true)
    controller.current = new AbortController()
    try {
      await api.agentChat(
        { message: question, conversationId: conversation?.id, signature: readSignature() },
        (event, data) => {
          if (event === 'conversation') setConversation(data)
          else if (event === 'step')
            updateLast((message) => {
              const steps = [...message.steps]
              const index = steps.findLastIndex(
                (step) => step.tool === data.tool && step.state === 'running',
              )
              if (data.state !== 'running' && index >= 0) steps[index] = data
              else steps.push(data)
              return { ...message, steps }
            })
          else if (event === 'card')
            updateLast((message) => ({ ...message, cards: [...message.cards, data] }))
          else if (event === 'answer')
            updateLast((message) => ({
              ...message,
              content: data.text,
              cut: data.stopped !== 'answered',
            }))
          else if (event === 'error') updateLast((message) => ({ ...message, error: data.message }))
        },
        controller.current.signal,
      )
    } catch (cause) {
      if (cause?.name !== 'AbortError')
        updateLast((message) => ({ ...message, error: cause.message }))
    } finally {
      updateLast((message) => ({
        ...message,
        pending: false,
        error: message.error || (message.content ? '' : 'AI 助手没有给出回答，请重试。'),
      }))
      setBusy(false)
    }
  }

  function startNew() {
    setConversation(null)
    setMessages([])
    setPanel('')
    setLoadError('')
  }

  async function open(id) {
    setLoadError('')
    try {
      const detail = await api.agentConversation(id)
      setConversation({ id: detail.id, title: detail.title })
      setMessages(
        detail.messages.map((message) => ({ ...message, steps: [], cards: message.cards || [] })),
      )
      setPanel('')
    } catch (cause) {
      setLoadError(cause.message)
    }
  }

  const available = status?.available
  return (
    <section id="inspiration-chat" className="agent-chat" aria-label="AI 助手">
      {statusError ? (
        <p className="message error" role="alert">
          {statusError}
        </p>
      ) : !status ? (
        <p className="mail-loading" role="status">
          正在连接 AI 助手…
        </p>
      ) : !available ? (
        <div className="ai-chat-empty">
          <span className="ai-chat-symbol">
            <Icon name="spark" size={27} />
          </span>
          <h3>AI 助手暂不可用</h3>
          <p>{status.message}</p>
        </div>
      ) : (
        <>
          <div className="agent-toolbar">
            <span className="agent-toolbar-title">{conversation?.title || '新对话'}</span>
            <button
              type="button"
              aria-pressed={panel === 'history'}
              disabled={busy}
              onClick={() => setPanel(panel === 'history' ? '' : 'history')}
            >
              历史
            </button>
            <button
              type="button"
              aria-pressed={panel === 'memory'}
              onClick={() => setPanel(panel === 'memory' ? '' : 'memory')}
            >
              记忆
            </button>
            <button
              type="button"
              disabled={busy || (!conversation && !messages.length)}
              onClick={startNew}
            >
              新对话
            </button>
          </div>
          {loadError && (
            <p className="message error" role="alert">
              {loadError}
            </p>
          )}
          {panel === 'history' && (
            <HistoryPanel
              currentId={conversation?.id}
              onOpen={open}
              onDeleted={(id) => id === conversation?.id && startNew()}
            />
          )}
          {panel === 'memory' && <MemoryPanel />}
          <div className="agent-messages" ref={list} hidden={Boolean(panel)}>
            {messages.length === 0 ? (
              <div className="agent-welcome">
                <div className="agent-suggestions">
                  {SUGGESTIONS.map((text) => (
                    <button key={text} type="button" onClick={() => send(text)}>
                      {text}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <ol aria-label="对话" aria-live="polite">
                {messages.map((message, index) => (
                  <li key={index} className={`agent-message is-${message.role}`}>
                    {message.role === 'assistant' && <Steps steps={message.steps} />}
                    {message.cards
                      ?.filter((card) => !AFTER_TEXT.includes(card.type))
                      .map((card, cardIndex) => (
                        <AgentCard key={cardIndex} card={card} onNavigate={onNavigate} />
                      ))}
                    {message.content && <p className="agent-text">{plainText(message.content)}</p>}
                    {message.cards
                      ?.filter((card) => card.type === 'knowledge')
                      .map((card, cardIndex) => (
                        <AgentCard key={`sources-${cardIndex}`} card={card} />
                      ))}
                    {message.cards
                      ?.filter((card) => card.type === 'choices')
                      .map((card, cardIndex) => (
                        <ChoicesCard
                          key={`choices-${cardIndex}`}
                          card={card}
                          disabled={busy || index !== messages.length - 1}
                          onChoose={send}
                        />
                      ))}
                    {message.pending && !message.steps.some((s) => s.state === 'running') && (
                      <p className="agent-thinking" role="status">
                        <span className="lecture-summary-spinner" aria-hidden="true" />
                        正在思考…
                      </p>
                    )}
                    {message.cut && <p className="agent-note">（回答可能不完整）</p>}
                    {message.error && (
                      <p className="message error" role="alert">
                        {message.error}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
          <form
            className="agent-composer"
            onSubmit={(event) => {
              event.preventDefault()
              send(draft)
            }}
          >
            <label className="sr-only" htmlFor="agent-message">
              给 AI 助手的消息
            </label>
            <textarea
              id="agent-message"
              ref={input}
              rows={1}
              maxLength={4000}
              value={draft}
              placeholder="问点什么…"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  send(draft)
                }
              }}
            />
            <button type="submit" disabled={busy || !draft.trim()} aria-label="发送">
              <Icon name="arrow" size={18} />
            </button>
          </form>
          <div className="agent-footer">
            <span>AI 可能出错，重要信息请核对</span>
          </div>
        </>
      )}
    </section>
  )
}
