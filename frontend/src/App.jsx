import { useEffect, useState } from 'react'
import { api } from './api/client'
import Icon from './components/Icon'
import Brand, { Wordmark } from './components/Brand'
import Home from './pages/Home'
import { setLanguage, useLanguage } from './i18n'

/** 中文 / English switch; before sign-in it is remembered in this browser only. */
export function LanguageSwitch({ onChange, className = 'language-switch' }) {
  const { language, t } = useLanguage()
  const next = language === 'en' ? 'zh' : 'en'
  return (
    <button
      type="button"
      className={className}
      onClick={() => (onChange ? onChange(next) : setLanguage(next))}
      aria-label={t('Switch to English', '切换到中文')}
      lang={next === 'en' ? 'en' : 'zh-CN'}
    >
      {next === 'en' ? 'English' : '中文'}
    </button>
  )
}

function AuthForm({ mode, onMode, onLogin }) {
  const register = mode === 'register'
  const { language, t } = useLanguage()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  function changeMode(next) {
    setPassword('')
    setConfirmation('')
    setError('')
    setNotice('')
    setVisible(false)
    onMode(next)
  }

  async function submit(event) {
    event.preventDefault()
    setError('')
    setNotice('')
    if (register && password !== confirmation) {
      setError(t('两次输入的密码不一致，请检查。', "The passwords don't match. Please check."))
      return
    }
    setBusy(true)
    try {
      if (register) {
        await api.register({ username: username.trim(), password, language })
        changeMode('login')
        setNotice(
          t(
            '账号已创建，请使用刚才的账号和密码登录。',
            'Account created. Sign in with the username and password you just set.',
          ),
        )
      } else {
        onLogin(await api.login({ username: username.trim(), password }))
      }
    } catch (cause) {
      setError(cause.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="auth-card">
      <div className="auth-card-top">
        <h1 className="auth-brand">
          <Wordmark />
        </h1>
        <button
          type="button"
          className="auth-switch"
          onClick={() => changeMode(register ? 'login' : 'register')}
          disabled={busy}
        >
          {register ? t('登录', 'Sign in') : t('注册账号', 'Create account')}
        </button>
      </div>
      <h2 className="auth-title">
        {register ? t('注册', 'Create account') : t('登录', 'Sign in')}
      </h2>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <label htmlFor="username" className="auth-field">
            <span className="auth-field-icon" aria-hidden="true">
              <Icon name="user" size={17} />
            </span>
            <span className="sr-only">{t('账号', 'Username')}</span>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              minLength={3}
              maxLength={register ? 32 : 254}
              pattern={register ? '[a-zA-Z0-9_]+' : undefined}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t('账号', 'Username')}
              aria-describedby={register ? 'username-help' : undefined}
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          </label>
          {register && (
            <p id="username-help" className="field-help">
              {t(
                '3–32 位字母、数字或下划线，不区分大小写。',
                '3–32 letters, digits or underscores; not case-sensitive.',
              )}
            </p>
          )}
          <label htmlFor="password" className="auth-field">
            <span className="auth-field-icon" aria-hidden="true">
              <Icon name="lock" size={17} />
            </span>
            <span className="sr-only">{t('密码', 'Password')}</span>
            <input
              id="password"
              name="password"
              type={visible ? 'text' : 'password'}
              autoComplete={register ? 'new-password' : 'current-password'}
              minLength={12}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('密码', 'Password')}
              aria-describedby={register ? 'password-help' : undefined}
              required
            />
            <button
              className="auth-field-action"
              type="button"
              onClick={() => setVisible((v) => !v)}
              aria-label={visible ? t('隐藏密码', 'Hide password') : t('显示密码', 'Show password')}
              aria-pressed={visible}
            >
              {visible ? t('隐藏', 'Hide') : t('显示', 'Show')}
            </button>
          </label>
          {register && (
            <p id="password-help" className="field-help">
              {t(
                '使用 12–128 个字符，建议结合字母、数字或符号。',
                'Use 12–128 characters; mix letters, digits or symbols.',
              )}
            </p>
          )}
          {register && (
            <label htmlFor="confirmation" className="auth-field">
              <span className="auth-field-icon" aria-hidden="true">
                <Icon name="lock" size={17} />
              </span>
              <span className="sr-only">{t('确认密码', 'Confirm password')}</span>
              <input
                id="confirmation"
                name="confirmation"
                type={visible ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                minLength={12}
                maxLength={128}
                placeholder={t('再输入一次密码', 'Enter the password again')}
                required
              />
            </label>
          )}
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
          <div className="auth-actions">
            <p>{t('留一点时间，给真正重要的事。', 'Make time for what really matters.')}</p>
            <button
              className="auth-submit"
              type="submit"
              aria-label={
                busy
                  ? register
                    ? t('正在创建', 'Creating')
                    : t('正在登录', 'Signing in')
                  : register
                    ? t('创建账号', 'Create account')
                    : t('登录我的空间', 'Sign in')
              }
            >
              {busy ? <span className="spinner" /> : <Icon name="arrow" size={20} />}
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  )
}

export default function App() {
  const { t } = useLanguage()
  const [mode, setMode] = useState(location.pathname === '/register' ? 'register' : 'login')
  const [user, setUser] = useState(null)
  const [checking, setChecking] = useState(true)
  const [connectionError, setConnectionError] = useState('')

  async function checkSession() {
    try {
      const value = await api.me()
      setLanguage(value.language)
      setUser(value)
      setConnectionError('')
    } catch (cause) {
      if (cause.status === 401) {
        setUser(null)
        setConnectionError('')
      } else setConnectionError(cause.message)
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    let active = true
    api
      .me()
      .then((value) => {
        if (!active) return
        setLanguage(value.language)
        setUser(value)
      })
      .catch((cause) => {
        if (active && cause.status !== 401) setConnectionError(cause.message)
      })
      .finally(() => {
        if (active) setChecking(false)
      })
    const focus = () => {
      void checkSession()
    }
    const pop = () => setMode(location.pathname === '/register' ? 'register' : 'login')
    window.addEventListener('focus', focus)
    window.addEventListener('popstate', pop)
    const timer = setInterval(focus, 60_000)
    return () => {
      active = false
      clearInterval(timer)
      window.removeEventListener('focus', focus)
      window.removeEventListener('popstate', pop)
    }
  }, [])

  function navigate(next) {
    history.pushState(null, '', `/${next}`)
    setMode(next)
  }

  if (checking)
    return (
      <div className="loading-screen">
        <Brand />
        <span className="spinner" />
        <p>{t('正在打开你的空间…', 'Opening your space…')}</p>
      </div>
    )
  if (user)
    return (
      <Home
        user={user}
        onUser={setUser}
        sessionError={connectionError}
        onRetry={checkSession}
        onLogout={() => {
          setUser(null)
          navigate('login')
        }}
      />
    )
  return (
    <main className="auth-shell">
      <div className="auth-right">
        <LanguageSwitch className="language-switch auth-language" />
        {connectionError && (
          <div className="connection-banner" role="alert">
            {connectionError}
            <button onClick={checkSession}>{t('重新连接', 'Reconnect')}</button>
          </div>
        )}
        <AuthForm
          mode={mode}
          onMode={navigate}
          onLogin={(value) => {
            setLanguage(value.language)
            setUser(value)
            setConnectionError('')
            history.replaceState(null, '', '/')
          }}
        />
      </div>
    </main>
  )
}
