import { getLanguage, tr } from '../i18n'

function networkMessage() {
  return tr(
    '暂时无法连接服务，请检查网络后重试。',
    "Can't reach the service. Check your network and try again.",
  )
}

export class ApiError extends Error {
  constructor(message, status, code, requestId) {
    super(message)
    this.status = status
    this.code = code
    this.requestId = requestId
  }
}

async function request(path, options = {}) {
  let response
  try {
    response = await fetch(`/api/v1${path}`, {
      credentials: 'same-origin',
      ...options,
      headers: { ...options.headers, 'X-HKM-Language': getLanguage() },
    })
  } catch {
    throw new ApiError(networkMessage(), 0, 'NETWORK_ERROR')
  }
  const data = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(
      data?.error?.message ||
        tr('服务暂时不可用，请稍后重试。', 'The service is unavailable. Please try again later.'),
      response.status,
      data?.error?.code,
      data?.error?.request_id,
    )
  }
  return data
}

async function mutate(path, body, method = 'POST') {
  const { csrf_token } = await request('/auth/csrf')
  return request(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf_token },
    body: JSON.stringify(body ?? {}),
  })
}

/** Reads a Server-Sent Events body and calls onEvent(name, data) for each event. */
export async function readEvents(response, onEvent) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    let end
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      let name = 'message'
      let data = ''
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) name = line.slice(7)
        else if (line.startsWith('data: ')) data += line.slice(6)
      }
      try {
        onEvent(name, data ? JSON.parse(data) : {})
      } catch {
        // ignore a malformed event
      }
    }
    if (done) return
  }
}

/**
 * Streams the assistant's work in a saved conversation:
 * onEvent('conversation' | 'step' | 'card' | 'answer' | 'error' | 'done', data).
 */
async function agentChat({ message, conversationId, signature }, onEvent, signal) {
  const { csrf_token } = await request('/auth/csrf')
  let response
  try {
    response = await fetch('/api/v1/agent/chat', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf_token,
        'X-HKM-Language': getLanguage(),
      },
      // The signature is used only by the local drafting model, never sent to the cloud.
      body: JSON.stringify({
        message,
        ...(conversationId ? { conversation_id: conversationId } : {}),
        signature: (signature || '').slice(0, 60),
      }),
      signal,
    })
  } catch (cause) {
    if (cause?.name === 'AbortError') throw cause
    throw new ApiError(networkMessage(), 0, 'NETWORK_ERROR')
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new ApiError(
      data?.error?.message ||
        tr(
          'AI 助手暂时不可用，请稍后重试。',
          'The AI assistant is unavailable. Please try again later.',
        ),
      response.status,
      data?.error?.code,
    )
  }
  await readEvents(response, onEvent)
}

export const api = {
  notifications: (cursor = '') =>
    request(`/mail-notifications${cursor ? `?${new URLSearchParams({ cursor })}` : ''}`),
  checkNotifications: () => mutate('/mail-notifications/check', {}),
  dismissNotification: (id) => mutate(`/mail-notifications/${encodeURIComponent(id)}/dismiss`, {}),
  retryNotification: (id) => mutate(`/mail-notifications/${encodeURIComponent(id)}/retry`, {}),
  calendarEvents: ({ startDate, endDate }) =>
    request(
      `/calendar/events?${new URLSearchParams({ start_date: startDate, end_date: endDate })}`,
    ),
  calendarCourses: () => request('/calendar/courses'),
  importTimetable: (url) => mutate('/calendar/import', { url }),
  createCalendarEvent: (event) => mutate('/calendar/events', event),
  updateCalendarEvent: (id, event) =>
    mutate(`/calendar/events/${encodeURIComponent(id)}`, event, 'PUT'),
  setEventCompleted: (id, completed) =>
    mutate(`/calendar/events/${encodeURIComponent(id)}/completion`, { completed }),
  deleteCalendarEvent: (id) =>
    mutate(`/calendar/events/${encodeURIComponent(id)}`, undefined, 'DELETE'),
  connections: () => request('/email-connections'),
  authorizeGoogle: () => mutate('/email-connections/google/authorize', {}),
  connectNetease: (emailAddress, authorizationCode) =>
    mutate('/email-connections/netease', {
      email_address: emailAddress,
      authorization_code: authorizationCode,
    }),
  disconnectMailbox: (id) => mutate(`/email-connections/${encodeURIComponent(id)}`, {}, 'DELETE'),
  messages: ({ scope = 'inbox', connectionId = '', cursor = '' } = {}) => {
    const params = new URLSearchParams({ scope })
    if (connectionId) params.set('connection_id', connectionId)
    if (cursor) params.set('cursor', cursor)
    return request(`/messages?${params}`)
  },
  message: (connectionId, id) =>
    request(
      `/email-connections/${encodeURIComponent(connectionId)}/messages/${encodeURIComponent(id)}`,
    ),
  summarizeMessage: (connectionId, id) =>
    mutate(
      `/email-connections/${encodeURIComponent(connectionId)}/messages/${encodeURIComponent(id)}/summary`,
      {},
    ),
  replyDraft: (connectionId, id, options) =>
    mutate(
      `/email-connections/${encodeURIComponent(connectionId)}/messages/${encodeURIComponent(id)}/reply-draft`,
      options,
    ),
  composeDraft: (options) => mutate('/compose-draft', options),
  lectureRecords: () => request('/lecture-records'),
  lectureRecord: (id) => request(`/lecture-records/${encodeURIComponent(id)}`),
  createLectureRecord: (record) => mutate('/lecture-records', record),
  lectureSummary: (transcript) => mutate('/lecture-summaries', transcript),
  updateLectureRecord: (id, changes) =>
    mutate(`/lecture-records/${encodeURIComponent(id)}`, changes, 'PATCH'),
  deleteLectureRecord: (id) =>
    mutate(`/lecture-records/${encodeURIComponent(id)}`, undefined, 'DELETE'),
  agentStatus: () => request('/agent/status'),
  agentChat,
  agentConversations: () => request('/agent/conversations'),
  agentConversation: (id) => request(`/agent/conversations/${encodeURIComponent(id)}`),
  deleteAgentConversation: (id) =>
    mutate(`/agent/conversations/${encodeURIComponent(id)}`, undefined, 'DELETE'),
  agentMemories: () => request('/agent/memories'),
  deleteAgentMemory: (id) =>
    mutate(`/agent/memories/${encodeURIComponent(id)}`, undefined, 'DELETE'),
  clearAgentMemories: () => mutate('/agent/memories', undefined, 'DELETE'),
  hkuGuide: () => request('/guides/hku'),
  hkuPlaces: () => request('/guides/hku/places'),
  me: () => request('/users/me'),
  login: (data) => mutate('/auth/login', data),
  register: (data) => mutate('/auth/register', data),
  logout: () => mutate('/auth/logout'),
  changePassword: (data) => mutate('/auth/password', data),
  setLanguage: (language) => mutate('/users/me/language', { language }, 'PUT'),
}
