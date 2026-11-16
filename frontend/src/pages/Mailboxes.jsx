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

const NETEASE_ADDRESS = /^[A-Za-z0-9._-]{1,64}@(163\.com|126\.com|yeah\.net)$/
const providerName = (provider) =>
  provider === 'netease' ? tr('网易邮箱', 'NetEase Mail') : 'Gmail'

export default function Mailboxes({ callbackStatus, onInbox }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const [notice, setNotice] = useState(callbacks()[callbackStatus] || '')
  // The 163 form: null when closed, otherwise the address and authorization code being typed.
  const [netease, setNetease] = useState(null)

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

  async function connectNetease(event) {
    event.preventDefault()
    const address = netease.address.trim().toLowerCase()
    const code = netease.code.trim()
    setError('')
    setNotice('')
    if (!NETEASE_ADDRESS.test(address)) {
      setError(
        tr(
          '请填写 163.com、126.com 或 yeah.net 的邮箱地址。',
          'Enter a 163.com, 126.com or yeah.net address.',
        ),
      )
      return
    }
    if (!/^[A-Za-z0-9]{8,64}$/.test(code)) {
      setError(
        tr(
          '授权码只含字母和数字，请从网易邮箱网页版复制，不是登录密码。',
          'The authorization code has only letters and digits. Copy it from the NetEase web mailbox; it is not your login password.',
        ),
      )
      return
    }
    setBusy(true)
    try {
      await api.connectNetease(address, code)
      setNetease(null)
      setNotice(
        tr(
          '网易邮箱已连接，现在可以前往统一收件箱查看邮件。',
          'NetEase mailbox connected. You can now read your mail in the Inbox.',
        ),
      )
      setData(await api.connections())
    } catch (cause) {
      setError(cause.message)
    } finally {
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
            '连接你的 Google 邮箱或网易邮箱，在一处查看收到的邮件。',
            'Connect your Google or NetEase mail and read it in one place.',
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
        <button
          className="mail-secondary"
          onClick={() => setNetease(netease ? null : { address: '', code: '' })}
          disabled={busy}
          aria-expanded={Boolean(netease)}
        >
          {tr('添加网易邮箱（163 / 126）', 'Add NetEase mailbox (163 / 126)')}
        </button>
      </div>
      {netease && (
        <form className="agenda-card netease-form" onSubmit={connectNetease}>
          <h2>{tr('连接网易邮箱', 'Connect a NetEase mailbox')}</h2>
          <ol>
            <li>
              {tr(
                '用浏览器登录网易邮箱网页版，打开“设置 → POP3/SMTP/IMAP”。',
                'Sign in to the NetEase web mailbox and open Settings → POP3/SMTP/IMAP.',
              )}
            </li>
            <li>
              {tr(
                '开启“IMAP/SMTP 服务”，按提示完成短信验证。',
                'Turn on “IMAP/SMTP service” and finish the SMS check.',
              )}
            </li>
            <li>
              {tr(
                '复制页面给出的授权码（只显示一次），粘贴到下面。',
                'Copy the authorization code shown (it appears only once) and paste it below.',
              )}
            </li>
          </ol>
          <label htmlFor="netease-address">{tr('邮箱地址', 'Email address')}</label>
          <input
            id="netease-address"
            type="email"
            autoComplete="off"
            placeholder="name@163.com"
            value={netease.address}
            onChange={(event) => setNetease({ ...netease, address: event.target.value })}
            maxLength={80}
            required
          />
          <label htmlFor="netease-code">{tr('授权码', 'Authorization code')}</label>
          <input
            id="netease-code"
            type="password"
            autoComplete="off"
            value={netease.code}
            onChange={(event) => setNetease({ ...netease, code: event.target.value })}
            maxLength={64}
            required
          />
          <p className="field-help">
            {tr(
              '填授权码，不要填登录密码。授权码加密保存在这台电脑上，HK Mate 只读取收件箱，不发送、删除或修改邮件；网易的授权码本身不能限制为只读，不再使用时请在网易邮箱网页版删除它。',
              'Enter the authorization code, not your login password. It is stored encrypted on this computer. HK Mate only reads the inbox and never sends, deletes or changes mail; NetEase codes cannot be limited to read-only, so delete the code in the web mailbox when you stop using it.',
            )}
          </p>
          <div className="netease-form-actions">
            <button
              type="button"
              className="mail-secondary"
              onClick={() => setNetease(null)}
              disabled={busy}
            >
              {tr('取消', 'Cancel')}
            </button>
            <button type="submit" className="mail-primary" disabled={busy}>
              {busy ? tr('正在连接…', 'Connecting…') : tr('连接', 'Connect')}
            </button>
          </div>
        </form>
      )}
      <p className="mail-helper">
        {tr(
          'Gmail 仅申请只读权限；网易邮箱用授权码连接、只读取收件箱。不发送、删除或修改原邮箱邮件。当前最多连接 5 个账号。Google 授权请在 Chrome 或 Safari 中打开本地平台完成。',
          'Gmail is connected read-only; NetEase mail uses an authorization code and only the inbox is read. HK Mate never sends, deletes or changes your mail. You can connect up to 5 accounts. Open HK Mate in Chrome or Safari to authorize Google.',
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
              '点击“添加 Google 邮箱”在 Google 页面授权，或点击“添加网易邮箱”填写授权码。',
              'Click “Add Google mailbox” to authorize on the Google page, or “Add NetEase mailbox” to enter an authorization code.',
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
                {providerName(item.provider)}
                {tr('，', ', connected ')}
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
                <button
                  onClick={() =>
                    item.provider === 'netease'
                      ? setNetease({ address: item.email_address, code: '' })
                      : connect()
                  }
                  disabled={busy}
                >
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
                  {item.provider === 'netease'
                    ? tr(
                        `解绑 ${item.email_address}？这会删除本机保存的授权码，不会删除邮箱中的邮件。授权码本身请到网易邮箱网页版删除。`,
                        `Unlink ${item.email_address}? This deletes the authorization code stored on this computer; no messages are deleted. Delete the code itself in the NetEase web mailbox.`,
                      )
                    : tr(
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
