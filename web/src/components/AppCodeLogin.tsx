import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Form, Input, Typography } from 'antd'
import { useAuth } from '../auth'
import { t } from '../lib/i18n'
function browserSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export default function AppCodeLogin({ onComplete }: { onComplete: () => void }) {
  const { loginWithAppCode, logout } = useAuth()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [needsLogout, setNeedsLogout] = useState(false)
  const ticket = useRef<{ code: string; browserSecret: string } | null>(null)
  const live = useRef(false), flight = useRef(false)
  useEffect(() => { live.current = true; return () => { live.current = false; ticket.current = null } }, [])
  const submit = async () => {
    if (flight.current) return
    if (!ticket.current && !/^[A-Za-z0-9_-]{32}$/.test(code.trim())) { setError(t('请输入 App 生成的完整32位登录码', 'Enter the complete 32-character app code')); return }
    flight.current = true; setBusy(true); setError('')
    try {
      ticket.current ??= { code: code.trim(), browserSecret: browserSecret() }
      setCode('')
      const applied = await loginWithAppCode(ticket.current, () => live.current)
      if (live.current && applied) { ticket.current = null; onComplete() }
    } catch (e) {
      if (!live.current) return
      const status = (e as { status?: number }).status
      if (status === 401 || status === 403 || status === 400) {
        ticket.current = null; setNeedsLogout(status === 403)
        setError(status === 403 ? t('请先退出当前账号，再在自己的 App 核对正确店铺生成登录码', 'Sign out, then check your shop and generate a code in your own app') : t('登录码已失效，请在自己的 App 重新生成', 'This code is invalid. Generate another in your own app'))
      } else setError(t('结果尚未确定，可重试查询本次登录；不会重复领取其他账号', 'The result is uncertain. Retry this same sign-in.'))
    } finally { flight.current = false; if (live.current) setBusy(false) }
  }
  return <Form onFinish={() => void submit()} autoComplete="off">
    <Typography.Paragraph type="secondary">{t('在已登录的智存 App 中打开「登录电脑版」，主动生成登录码。2分钟有效，不发短信。只使用自己的码，不要转发或输入他人发来的码。', 'Open Sign in on computer in your signed-in StockMate app and generate a code. Valid for 2 minutes; no SMS. Only use your own code and do not share it.')}</Typography.Paragraph>
    <Form.Item><Input.Password aria-label={t('App 登录码', 'App sign-in code')} value={code} onChange={e => setCode(e.target.value)} disabled={busy || !!ticket.current} autoComplete="off" visibilityToggle={false} placeholder={t('粘贴32位登录码', 'Paste the 32-character code')} /></Form.Item>
    {error && <Alert type="info" showIcon message={error} action={needsLogout ? <Button onClick={() => { logout(); setNeedsLogout(false); setError('') }}>{t('退出当前账号', 'Sign out')}</Button> : undefined} />}
    <Button block type="primary" htmlType="submit" loading={busy} disabled={busy}>{ticket.current ? t('重试本次登录', 'Retry this sign-in') : t('验证登录码并登录', 'Verify code and sign in')}</Button>
    {ticket.current && !busy && <Button onClick={() => { ticket.current = null; setError(''); setCode('') }}>{t('放弃本次登录，使用新码', 'Discard and use a new code')}</Button>}
  </Form>
}
