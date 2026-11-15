import { useEffect, useState } from 'react'
import { api } from '../api/client'
import Icon from '../components/Icon'
import Skeleton from '../components/Skeleton'

const statuses = {
  connected: '已连接',
  reauthorization_required: '需要重新授权',
  revocation_pending: '解绑待完成',
}
const callbacks = {
  connected: 'Google 邮箱已连接，现在可以前往统一收件箱查看邮件。',
  cancelled: '已取消 Google 授权，没有添加邮箱。',
  expired: '授权请求已过期或登录状态发生变化，请重新添加邮箱。',
  login_required: '授权期间登录已过期，请重新添加邮箱。',
  already_linked: '该 Google 邮箱已绑定其他平台账号，请先解绑。',
  failed: 'Google 授权未完成，请检查测试用户、只读权限和网络后重试。',
}

export default function Mailboxes({ callbackStatus, onInbox }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const [notice, setNotice] = useState(callbacks[callbackStatus] || '')

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
        throw new Error('授权地址无效。')
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
      setNotice('邮箱已解绑，后续不再访问。')
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
    <section className="mailbox-page" aria-label="邮箱管理">
      <div className="mail-toolbar">
        <p>连接你的 Google 邮箱，在一处查看收到的邮件。</p>
        <button
          className="mail-primary"
          onClick={connect}
          disabled={busy || !data?.google_configured}
        >
          <span className="google-letter" aria-hidden="true">
            G
          </span>
          添加 Google 邮箱
        </button>
      </div>
      <p className="mail-helper">
        仅申请 Gmail 只读权限，不发送、删除或修改原邮箱邮件。当前最多连接 5 个账号。连接授权请在
        Chrome 或 Safari 中打开本地平台完成。
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
            刷新连接状态
          </button>
        </div>
      )}
      {!data && !error && <Skeleton label="正在读取邮箱连接…" rows={2} />}
      {data && !data.google_configured && (
        <div className="message error">
          Google OAuth 尚未配置完成，请检查本机凭证文件与回调地址。
        </div>
      )}
      {data?.items.length === 0 && (
        <div className="mail-empty">
          <Icon name="mail" size={38} />
          <h2>还没有连接邮箱</h2>
          <p>点击“添加 Google 邮箱”，在 Google 页面选择账号并授权。</p>
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
                Gmail，
                {new Date(item.created_at).toLocaleDateString('zh-CN', {
                  timeZone: 'Asia/Hong_Kong',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
                连接
              </p>
              <span className={`mailbox-status ${item.status}`}>
                {statuses[item.status] || '状态待确认'}
              </span>
            </div>
            <div className="mailbox-actions">
              {item.status === 'connected' ? (
                <button onClick={() => onInbox(item.id)} disabled={busy}>
                  查看邮件
                </button>
              ) : item.status === 'reauthorization_required' ? (
                <button onClick={connect} disabled={busy}>
                  重新授权
                </button>
              ) : null}
              <button className="danger-text" onClick={() => setConfirm(item.id)} disabled={busy}>
                {item.status === 'revocation_pending' ? '重试解绑' : '解绑'}
              </button>
            </div>
            {confirm === item.id && (
              <div className="disconnect-confirm" role="group" aria-label="确认解绑邮箱">
                <p>
                  解绑 {item.email_address}？这会撤销本应用的访问授权，不会删除 Gmail 中的邮件。
                </p>
                <button
                  className="mail-primary"
                  onClick={() => disconnect(item.id)}
                  disabled={busy}
                >
                  确认解绑
                </button>
                <button className="mail-secondary" onClick={() => setConfirm(null)} disabled={busy}>
                  取消
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}
