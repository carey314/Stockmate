import { useEffect, useRef, useState } from 'react'
import { Alert, Button, QRCode, Spin, Typography } from 'antd'
import api, { API_BASE } from '../api/client'
import { useAuth } from '../auth'
import { t } from '../lib/i18n'

type Challenge = { challengeId: string; browserSecret: string; qrContent: string; expiresAt: string }
const KEY = `sm_web_qr_v1:${API_BASE}`
const copy = {
  pending: () => t('打开智存 App 的「登录电脑版」扫码，二维码2分钟内有效', 'Scan with Sign in on computer in the StockMate app. Valid for 2 minutes.'),
  scanned: () => t('已扫描，请在 App 核对店铺并确认登录', 'Scanned. Check your shop and confirm in the app.'),
  expired: () => t('二维码已过期，请重新生成', 'QR code expired. Generate a new one.'),
  cancelled: () => t('本次登录已取消', 'This sign-in was cancelled.'),
}
function restore(): Challenge | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) || 'null') as Challenge | null
    return value && typeof value.challengeId === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value.browserSecret) && typeof value.qrContent === 'string' && Number.isFinite(Date.parse(value.expiresAt)) ? value : null
  } catch { return null }
}
export default function QrWebLogin({ onComplete }: { onComplete: () => void }) {
  const { loginWithQr, logout } = useAuth()
  const [generation, setGeneration] = useState(0)
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [state, setState] = useState<keyof typeof copy>('pending')
  const [error, setError] = useState('')
  const [needsLogout, setNeedsLogout] = useState(false)
  const [busy, setBusy] = useState(true)
  const epoch = useRef(0)
  const complete = useRef(onComplete); complete.current = onComplete
  const clear = () => { try { sessionStorage.removeItem(KEY) } catch { /* Memory flow still works. */ } }
  useEffect(() => {
    const current = ++epoch.current
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const valid = () => active && epoch.current === current
    setBusy(true); setError(''); setNeedsLogout(false); setChallenge(null); setState('pending')
    const run = async () => {
      try {
        const cap = await api.get<{ enabled: boolean; version: number; qrEnabled: boolean }>('/auth/web-login/capabilities')
        if (!valid()) return
        if (!cap.enabled || cap.version !== 1 || !cap.qrEnabled) throw new Error(t('扫码登录暂不可用，请使用密码或 App 登录码', 'QR sign-in is unavailable. Use a password or an app code.'))
        let value = restore()
        if (!value) value = await api.post<Challenge>('/auth/web-login/challenges', {})
        if (!valid()) return
        const ticket = value
        setChallenge(ticket)
        try { sessionStorage.setItem(KEY, JSON.stringify(ticket)) } catch { setError(t('浏览器无法保存本次授权，刷新后需要重新扫码', 'This browser cannot save the authorization. Scan again after refreshing.')) }
        setBusy(false)
        const body = { challengeId: ticket.challengeId, browserSecret: ticket.browserSecret }
        const poll = async () => {
          if (!valid()) return
          if (Date.parse(ticket.expiresAt) <= Date.now()) { clear(); setState('expired'); return }
          try {
            const status = await api.post<{ state: string }>('/auth/web-login/status', body)
            if (!valid()) return
            if (status.state === 'approved' || status.state === 'redeemed') {
              const applied = await loginWithQr(body, valid)
              if (valid() && applied) { clear(); complete.current() }
              return
            }
            if (status.state === 'expired' || status.state === 'cancelled') { clear(); setState(status.state); return }
            if (status.state === 'pending' || status.state === 'scanned') setState(status.state)
          } catch (e) {
            if (!valid()) return
            const status = (e as { status?: number }).status
            if (status === 401 || status === 403) { setNeedsLogout(status === 403); clear(); setState('expired'); setError((e as Error).message); return }
            setError(t('连接暂未完成，正在查询原授权结果，请勿反复扫码', 'Checking the original authorization after a connection issue.'))
          }
          if (valid()) timer = setTimeout(poll, 2000)
        }
        timer = setTimeout(poll, 2000)
      } catch (e) { if (valid()) { setNeedsLogout((e as { status?: number }).status === 403); setError(`${(e as Error).message} · ${t('可使用密码或 App 登录码', 'Use a password or app code')}`); setBusy(false) } }
    }
    void run()
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [generation, loginWithQr])
  const cancel = async () => {
    const cancelEpoch = ++epoch.current; clear(); setState('cancelled')
    if (!challenge) return
    try { await api.post('/auth/web-login/cancel', { challengeId: challenge.challengeId, browserSecret: challenge.browserSecret }) }
    catch { if (epoch.current !== cancelEpoch) return; setError(t('取消请求未送达，本页已停止登录；请在 App 取消或等待二维码过期', 'Cancellation could not be delivered. This page has stopped sign-in; cancel in the app or wait for expiry.')) }
  }
  const active = state === 'pending' || state === 'scanned'
  return <div style={{ textAlign: 'center' }}>
    {busy && <Spin />}
    {!busy && challenge && active && <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}><QRCode type="svg" value={challenge.qrContent} size={208} /></div>}
    {!busy && challenge && <Typography.Paragraph>{copy[state]()}</Typography.Paragraph>}
    {error && <Alert type="info" showIcon message={error} action={needsLogout ? <Button onClick={() => { clear(); logout(); setGeneration(g => g + 1) }}>{t('退出当前账号', 'Sign out')}</Button> : undefined} />}
    {!busy && challenge && active && <Button onClick={() => void cancel()}>{t('取消二维码', 'Cancel QR code')}</Button>}
    {!busy && (!active || !challenge) && <Button onClick={() => { clear(); setGeneration(g => g + 1) }}>{t('重新生成二维码', 'Generate a new QR code')}</Button>}
  </div>
}
