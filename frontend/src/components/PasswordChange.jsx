import { useState } from 'react'
import { api } from '../api/client'
import Icon from './Icon'

const empty = { current: '', next: '', confirmation: '' }

/** Account page form: verifies the current password, then signs out every other device. */
export default function PasswordChange({ username }) {
  const [values, setValues] = useState(empty)
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  function update(field) {
    return (event) => setValues((current) => ({ ...current, [field]: event.target.value }))
  }

  async function submit(event) {
    event.preventDefault()
    setError('')
    setNotice('')
    if (values.next !== values.confirmation) {
      setError('两次输入的新密码不一致。')
      return
    }
    if (values.next === values.current) {
      setError('新密码不能与当前密码相同。')
      return
    }
    setBusy(true)
    try {
      await api.changePassword({ current_password: values.current, new_password: values.next })
      setValues(empty)
      setNotice('密码已更新，其他设备上的登录已退出。')
    } catch (cause) {
      setError(cause.message)
    } finally {
      setBusy(false)
    }
  }

  const type = visible ? 'text' : 'password'
  return (
    <section className="account-section" aria-labelledby="password-title">
      <div className="section-title">
        <h2 id="password-title">修改密码</h2>
      </div>
      <form className="account-card password-form" onSubmit={submit}>
        <fieldset disabled={busy}>
          {/* Lets password managers attach the new password to this account. */}
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={username}
            hidden
            readOnly
          />
          <label htmlFor="current-password">
            当前密码
            <span className="password-wrap">
              <input
                id="current-password"
                name="current-password"
                type={type}
                autoComplete="current-password"
                maxLength={128}
                value={values.current}
                onChange={update('current')}
                required
              />
              <button
                className="eye-button"
                type="button"
                onClick={() => setVisible((v) => !v)}
                aria-label={visible ? '隐藏密码' : '显示密码'}
                aria-pressed={visible}
              >
                <Icon name="eye" />
              </button>
            </span>
          </label>
          <label htmlFor="new-password">
            新密码
            <input
              id="new-password"
              name="new-password"
              type={type}
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              value={values.next}
              onChange={update('next')}
              aria-describedby="new-password-help"
              required
            />
          </label>
          <p id="new-password-help" className="field-help">
            使用 12–128 个字符。修改后，其他设备需要用新密码重新登录。
          </p>
          <label htmlFor="new-password-confirmation">
            确认新密码
            <input
              id="new-password-confirmation"
              name="new-password-confirmation"
              type={type}
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              value={values.confirmation}
              onChange={update('confirmation')}
              required
            />
          </label>
          {error && (
            <div className="message error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="message success" role="status">
              <Icon name="check" size={18} />
              {notice}
            </div>
          )}
          <button className="primary-button" type="submit">
            {busy ? (
              <>
                <span className="spinner" /> 正在更新…
              </>
            ) : (
              <>
                更新密码
                <Icon name="lock" />
              </>
            )}
          </button>
        </fieldset>
      </form>
    </section>
  )
}
