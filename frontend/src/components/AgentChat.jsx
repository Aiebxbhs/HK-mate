import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import AgentCard, { ChoicesCard } from './AgentCards'
import Icon from './Icon'
import { readSignature } from './ReplyDraftPanel'
import Skeleton from './Skeleton'
import { locale, tr } from '../i18n'

// Shown below the reply text: sources at the end of the answer, then quick replies.
const AFTER_TEXT = ['knowledge', 'choices']
const suggestions = () =>
  tr(
    ['明天有什么课？', '帮我写封请假邮件', '帮我找找西营盘美食', '怎么办香港身份证？'],
    [
      'What classes do I have tomorrow?',
      'Help me write a leave email',
      'Find good food in Sai Ying Pun',
      'How do I get a Hong Kong ID card?',
    ],
  )

/** Model replies may use light Markdown; show it as plain text without the markers. */
export function plainText(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '• ')
}

const dayTime = {
  format: (value) =>
    new Intl.DateTimeFormat(locale(), {
      timeZone: 'Asia/Hong_Kong',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(value),
}

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
    <section className="agent-panel" aria-label={tr('历史对话', 'Chat history')}>
      <p className="agent-panel-note">
        {tr(
          '保存在本机（加密），只保留最近 20 个对话。',
          'Saved on this computer (encrypted); only the latest 20 chats are kept.',
        )}
      </p>
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      {!items ? (
        <Skeleton label={tr('正在读取…', 'Loading…')} rows={3} />
      ) : items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item.id} className={item.id === currentId ? 'is-current' : ''}>
              <button type="button" className="agent-panel-main" onClick={() => onOpen(item.id)}>
                <span>{item.title || tr('（无标题）', '(Untitled)')}</span>
                <small>{dayTime.format(new Date(item.updated_at))}</small>
              </button>
              {confirmId === item.id ? (
                <span
                  className="agent-panel-confirm"
                  role="group"
                  aria-label={tr('确认删除对话', 'Confirm deleting the chat')}
                >
                  <button type="button" className="danger-text" onClick={() => remove(item.id)}>
                    {tr('删除', 'Delete')}
                  </button>
                  <button type="button" onClick={() => setConfirmId('')}>
                    {tr('取消', 'Cancel')}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="agent-panel-delete"
                  aria-label={tr(`删除对话 ${item.title}`, `Delete chat ${item.title}`)}
                  onClick={() => setConfirmId(item.id)}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="agent-panel-empty">{tr('还没有保存的对话。', 'No saved chats yet.')}</p>
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
    <section className="agent-panel" aria-label={tr('AI 的记忆', "The AI's memory")}>
      <p className="agent-panel-note">
        {tr(
          'AI 从对话中记住的关于你的信息，会随每次对话发送给 AI 服务，用来让回答更合你心意。',
          'What the AI remembered about you from chats. It is sent to the AI service with each chat so answers fit you better.',
        )}
      </p>
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      {!items ? (
        <Skeleton label={tr('正在读取…', 'Loading…')} rows={3} />
      ) : items.length ? (
        <>
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <span className="agent-panel-main">{item.fact}</span>
                <button
                  type="button"
                  className="agent-panel-delete"
                  aria-label={tr(`忘掉 ${item.fact}`, `Forget ${item.fact}`)}
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
            <span
              className="agent-panel-confirm"
              role="group"
              aria-label={tr('确认清空记忆', 'Confirm clearing memory')}
            >
              {tr('清空后 AI 会忘掉以上全部内容。', 'The AI will forget everything above.')}
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
                {tr('清空', 'Clear')}
              </button>
              <button type="button" onClick={() => setConfirmClear(false)}>
                {tr('取消', 'Cancel')}
              </button>
            </span>
          ) : (
            <button type="button" className="text-button" onClick={() => setConfirmClear(true)}>
              {tr('全部清空', 'Clear all')}
            </button>
          )}
        </>
      ) : (
        <p className="agent-panel-empty">
          {tr(
            '还没有记住任何内容。聊天时说说你的偏好（比如“我不吃辣”），AI 会记下来。',
            'Nothing remembered yet. Mention your preferences in a chat (for example “I don’t eat spicy food”) and the AI will note them.',
          )}
        </p>
      )}
    </section>
  )
}

function Steps({ steps }) {
  if (!steps.length) return null
  return (
    <ul className="agent-steps" aria-label={tr('AI 助手的操作', "The assistant's steps")}>
      {steps.map((step, index) => (
        <li key={`${step.tool}-${index}`} className={`is-${step.state}`}>
          {step.state === 'running' ? (
            <span className="lecture-summary-spinner" aria-hidden="true" />
          ) : (
            <span aria-hidden="true">{step.state === 'done' ? '✓' : '!'}</span>
          )}
          {step.state === 'running' ? `${step.label}…` : step.label.replace(/^正在/, '已')}
          {step.state === 'failed' && tr('（未成功）', ' (failed)')}
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
        error:
          message.error ||
          (message.content
            ? ''
            : tr(
                'AI 助手没有给出回答，请重试。',
                'The AI assistant gave no answer. Please retry.',
              )),
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
    <section
      id="inspiration-chat"
      className="agent-chat"
      aria-label={tr('AI 助手', 'AI assistant')}
    >
      {statusError ? (
        <p className="message error" role="alert">
          {statusError}
        </p>
      ) : !status ? (
        <p className="mail-loading" role="status">
          {tr('正在连接 AI 助手…', 'Connecting to the AI assistant…')}
        </p>
      ) : !available ? (
        <div className="ai-chat-empty">
          <span className="ai-chat-symbol">
            <Icon name="spark" size={27} />
          </span>
          <h3>{tr('AI 助手暂不可用', 'The AI assistant is unavailable')}</h3>
          <p>{status.message}</p>
        </div>
      ) : (
        <>
          <div className="agent-toolbar">
            <span className="agent-toolbar-title">
              {conversation?.title || tr('新对话', 'New chat')}
            </span>
            <button
              type="button"
              aria-pressed={panel === 'history'}
              disabled={busy}
              onClick={() => setPanel(panel === 'history' ? '' : 'history')}
            >
              {tr('历史', 'History')}
            </button>
            <button
              type="button"
              aria-pressed={panel === 'memory'}
              onClick={() => setPanel(panel === 'memory' ? '' : 'memory')}
            >
              {tr('记忆', 'Memory')}
            </button>
            <button
              type="button"
              disabled={busy || (!conversation && !messages.length)}
              onClick={startNew}
            >
              {tr('新对话', 'New chat')}
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
                  {suggestions().map((text) => (
                    <button key={text} type="button" onClick={() => send(text)}>
                      {text}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <ol aria-label={tr('对话', 'Chat')} aria-live="polite">
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
                        {tr('正在思考…', 'Thinking…')}
                      </p>
                    )}
                    {message.cut && (
                      <p className="agent-note">
                        {tr('（回答可能不完整）', '(The answer may be incomplete)')}
                      </p>
                    )}
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
              {tr('给 AI 助手的消息', 'Message to the AI assistant')}
            </label>
            <textarea
              id="agent-message"
              ref={input}
              rows={1}
              maxLength={4000}
              value={draft}
              placeholder={tr('问点什么…', 'Ask anything…')}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  send(draft)
                }
              }}
            />
            <button type="submit" disabled={busy || !draft.trim()} aria-label={tr('发送', 'Send')}>
              <Icon name="arrow" size={18} />
            </button>
          </form>
          <div className="agent-footer">
            <span>
              {tr(
                'AI 可能出错，重要信息请核对',
                'AI can make mistakes. Check important information.',
              )}
            </span>
          </div>
        </>
      )}
    </section>
  )
}
