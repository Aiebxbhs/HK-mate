import { useEffect, useState } from 'react'
import { api } from '../api/client'
import Icon from '../components/Icon'
import Skeleton from '../components/Skeleton'
import { locale, tr } from '../i18n'

const statuses = () => ({
  connected: tr('已连接', 'Connected'),
  reauthorization_required: tr('需要重新授权', 'Needs reauthorization'),
  revocation_pending: tr('解绑待完成', 'Unlinking unfinished'),
})
const callbacks = () => ({
  connected: tr(
    'Google 邮箱已连接，现在可以前往统一收件箱查看邮件。',
    'Gmail connected. You can now read your mail in the Inbox.',
  ),
  cancelled: tr(
    '已取消 Google 授权，没有添加邮箱。',
    'Google authorization was cancelled; no mailbox was added.',
  ),
  expired: tr(
    '授权请求已过期或登录状态发生变化，请重新添加邮箱。',
    'The authorization request expired or your sign-in changed. Please add the mailbox again.',
  ),
  login_required: tr(
    '授权期间登录已过期，请重新添加邮箱。',
    'Your sign-in expired during authorization. Please add the mailbox again.',
  ),
  already_linked: tr(
    '该 Google 邮箱已绑定其他平台账号，请先解绑。',
    'This Google account is linked to another HK Mate account. Unlink it there first.',
  ),
  failed: tr(
    'Google 授权未完成，请检查测试用户、只读权限和网络后重试。',
    "Google authorization didn't finish. Check the test users, read-only permission and network, then try again.",
  ),
})

export default function Mailboxes({ callbackStatus, onInbox }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const [notice, setNotice] = useState(callbacks()[callbackStatus] || '')

  useEffect(() => {
    let active = true
    api
      .connections()
      .then((value) => {
        if (active) setData(value)
      })
      .catch((cause) => {
        if (active) setError(cause.message)
      })
    return () => {
      active = false
    }
  }, [])

  async function reload() {
    setBusy(true)
    setError('')
    try {
      setData(await api.connections())
    } catch (cause) {
      setError(cause.message)
    } finally {
      setBusy(false)
    }
  }

  async function connect() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { authorization_url } = await api.authorizeGoogle()
      if (new URL(authorization_url).origin !== 'https://accounts.google.com')
        throw new Error(tr('授权地址无效。', 'Invalid authorization address.'))
      window.location.assign(authorization_url)
    } catch (cause) {
      setError(cause.message)
      setBusy(false)
    }
  }

  async function disconnect(id) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api.disconnectMailbox(id)
      setConfirm(null)
      setNotice(
        tr('邮箱已解绑，后续不再访问。', 'Mailbox unlinked. HK Mate will no longer access it.'),
      )
    } catch (cause) {
      setError(cause.message)
    } finally {
      try {
        setData(await api.connections())
      } catch {
        /* Preserve the original operation result. */
      }
      setBusy(false)
    }
  }

  return (
    <section className="mailbox-page" aria-label={tr('邮箱管理', 'Mailboxes')}>
      <div className="mail-toolbar">
        <p>
          {tr(
            '连接你的 Google 邮箱，在一处查看收到的邮件。',
            'Connect your Google mail and read it in one place.',
          )}
        </p>
        <button
          className="mail-primary"
          onClick={connect}
          disabled={busy || !data?.google_configured}
        >
          <span className="google-letter" aria-hidden="true">
            G
          </span>
          {tr('添加 Google 邮箱', 'Add Google mailbox')}
        </button>
      </div>
      <p className="mail-helper">
        {tr(
          '仅申请 Gmail 只读权限，不发送、删除或修改原邮箱邮件。当前最多连接 5 个账号。连接授权请在 Chrome 或 Safari 中打开本地平台完成。',
          'HK Mate asks only for Gmail read-only access and never sends, deletes or changes your mail. You can connect up to 5 accounts. Open HK Mate in Chrome or Safari to authorize.',
        )}
      </p>
      {notice && (
        <div className="message success" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="message error" role="alert">
          {error}
          <button className="text-button" onClick={reload} disabled={busy}>
            {tr('刷新连接状态', 'Refresh status')}
          </button>
        </div>
      )}
      {!data && !error && (
        <Skeleton label={tr('正在读取邮箱连接…', 'Loading mailboxes…')} rows={2} />
      )}
      {data && !data.google_configured && (
        <div className="message error">
          {tr(
            'Google OAuth 尚未配置完成，请检查本机凭证文件与回调地址。',
            "Google OAuth isn't fully set up. Check the local credentials file and callback address.",
          )}
        </div>
      )}
      {data?.items.length === 0 && (
        <div className="mail-empty">
          <Icon name="mail" size={38} />
          <h2>{tr('还没有连接邮箱', 'No mailbox connected yet')}</h2>
          <p>
            {tr(
              '点击“添加 Google 邮箱”，在 Google 页面选择账号并授权。',
              'Click “Add Google mailbox”, then choose an account and authorize it on the Google page.',
            )}
          </p>
        </div>
      )}
      <div className="mailbox-list">
        {data?.items.map((item) => (
          <article key={item.id} className="mailbox-row">
            <span className="mailbox-icon">
              <Icon name="mail" size={22} />
            </span>
            <div className="mailbox-info">
              <h2>{item.email_address}</h2>
              <p>
                {tr('Gmail，', 'Gmail, connected ')}
                {new Date(item.created_at).toLocaleDateString(locale(), {
                  timeZone: 'Asia/Hong_Kong',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
                {tr('连接', '')}
              </p>
              <span className={`mailbox-status ${item.status}`}>
                {statuses()[item.status] || tr('状态待确认', 'Status unknown')}
              </span>
            </div>
            <div className="mailbox-actions">
              {item.status === 'connected' ? (
                <button onClick={() => onInbox(item.id)} disabled={busy}>
                  {tr('查看邮件', 'View mail')}
                </button>
              ) : item.status === 'reauthorization_required' ? (
                <button onClick={connect} disabled={busy}>
                  {tr('重新授权', 'Reauthorize')}
                </button>
              ) : null}
              <button className="danger-text" onClick={() => setConfirm(item.id)} disabled={busy}>
                {item.status === 'revocation_pending'
                  ? tr('重试解绑', 'Retry unlink')
                  : tr('解绑', 'Unlink')}
              </button>
            </div>
            {confirm === item.id && (
              <div
                className="disconnect-confirm"
                role="group"
                aria-label={tr('确认解绑邮箱', 'Confirm unlinking')}
              >
                <p>
                  {tr(
                    `解绑 ${item.email_address}？这会撤销本应用的访问授权，不会删除 Gmail 中的邮件。`,
                    `Unlink ${item.email_address}? This revokes HK Mate’s access; no Gmail messages are deleted.`,
                  )}
                </p>
                <button
                  className="mail-primary"
                  onClick={() => disconnect(item.id)}
                  disabled={busy}
                >
                  {tr('确认解绑', 'Unlink')}
                </button>
                <button className="mail-secondary" onClick={() => setConfirm(null)} disabled={busy}>
                  {tr('取消', 'Cancel')}
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}
