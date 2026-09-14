import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  Fragment,
  useState,
  type ReactNode,
} from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Alert, Button, Spin } from 'antd'
import api, { TOKEN_KEY, USER_KEY, type ApiUser, type Profile } from './api/client'
import { clearEntitlementCache } from './hooks/useEntitlement'
import { sessionSnapshot, isCurrentSession, notifySessionChange, clearSession, SESSION_EVENT } from './lib/session'

interface AuthState {
  user: ApiUser | null
  profile: Profile | null
  profileError: string | null
  login: (username: string, password: string) => Promise<void>
  loginWithCode: (code: string) => Promise<boolean>
  loginWithQr: (body: { challengeId: string; browserSecret: string }, valid: () => boolean) => Promise<boolean>
  loginWithAppCode: (body: { code: string; browserSecret: string }, valid: () => boolean) => Promise<boolean>
  logout: () => void
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState>(null as unknown as AuthState)

export function AuthProvider({ children }: { children: ReactNode }) {
  // 缓存仅用于展示快照；启动时必须让服务端验证身份。
  const [user, setUser] = useState<ApiUser | null>(null)
  const loginAttempt = useRef(0)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)

  const refreshProfile = useCallback(async () => {
    const snapshot = sessionSnapshot()
    if (!snapshot.token) return
    setProfileError(null)
    const p = await api.get<Profile>('/auth/profile').then((value) => {
      if (!value || !Number.isSafeInteger(value.id) || value.id <= 0 || !['admin', 'staff'].includes(value.role)) {
        throw new Error('账号信息不完整，请重新验证身份')
      }
      return value
    }).catch((e) => {
      if (isCurrentSession(snapshot)) setProfileError((e as Error).message)
      throw e
    })
    if (!isCurrentSession(snapshot)) return
    setProfile(p)
    // profile 是权威角色来源（后台改角色后刷新即生效）
    setUser({ id: p.id, username: p.username, realName: p.realName, role: p.role })
    localStorage.setItem(
      USER_KEY,
      JSON.stringify({ id: p.id, username: p.username, realName: p.realName, role: p.role }),
    )
  }, [])

  useEffect(() => {
    if (localStorage.getItem(TOKEN_KEY)) refreshProfile().catch(() => {})
  }, [refreshProfile])

  // 身份变化立即卸载旧业务视图，再查询新身份。
  useEffect(() => {
    const reset = () => {
      loginAttempt.current++
      clearEntitlementCache()
      setUser(null)
      setProfile(null)
      setProfileError(null)
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key !== TOKEN_KEY && e.key !== null) return
      notifySessionChange()
      if (localStorage.getItem(TOKEN_KEY)) refreshProfile().catch(() => {})
    }
    window.addEventListener(SESSION_EVENT, reset)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(SESSION_EVENT, reset)
      window.removeEventListener('storage', onStorage)
    }
  }, [refreshProfile])

  const authenticate = useCallback(
    async (url: string, credentials: object, valid: () => boolean = () => true): Promise<boolean> => {
      const attempt = ++loginAttempt.current
      const snapshot = sessionSnapshot()
      const data = await api.post<{ token: string; user: ApiUser }>(url, credentials)
      if (!valid() || attempt !== loginAttempt.current || !isCurrentSession(snapshot)) return false
      localStorage.setItem(TOKEN_KEY, data.token)
      notifySessionChange()
      localStorage.setItem(USER_KEY, JSON.stringify(data.user))
      clearEntitlementCache() // 不登出直接换号也不能带着上个店的权益缓存
      setUser(data.user)
      refreshProfile().catch(() => {})
      return true
    },
    [refreshProfile],
  )

  const login = useCallback(async (username: string, password: string) => {
    await authenticate('/auth/login', { username, password })
  }, [authenticate])
  const loginWithCode = useCallback((code: string) => authenticate('/auth/web-bridge/redeem', { code }), [authenticate])

  const loginWithQr = useCallback((body: { challengeId: string; browserSecret: string }, valid: () => boolean) => authenticate('/auth/web-login/redeem', body, valid), [authenticate])
  const loginWithAppCode = useCallback((body: { code: string; browserSecret: string }, valid: () => boolean) => authenticate('/auth/web-login/code/redeem', body, valid), [authenticate])

  const logout = useCallback(() => {
    clearSession()
    // SPA 登出不重载模块——模块级权益缓存不清，会把上家店的 plan/额度带给下个登录的账号（跨租户串台）
    clearEntitlementCache()
    setUser(null)
    setProfile(null)
  }, [])

  const value = useMemo(
    () => ({ user, profile, profileError, login, loginWithCode, loginWithQr, loginWithAppCode, logout, refreshProfile }),
    [user, profile, profileError, login, loginWithCode, loginWithQr, loginWithAppCode, logout, refreshProfile],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, profileError, refreshProfile, logout } = useAuth()
  const location = useLocation()
  const hasToken = !!localStorage.getItem(TOKEN_KEY)
  if (!user && !hasToken) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }
  if (!user && hasToken && profileError) {
    return <Alert type="error" showIcon message={profileError} action={<><Button onClick={() => refreshProfile().catch(() => {})}>重试</Button><Button onClick={logout}>重新登录</Button></>} />
  }
  if (!user && hasToken) {
    // 有 token 但 profile 还没回来，短暂 loading
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 160 }}>
        <Spin size="large" />
      </div>
    )
  }
  return <Fragment key={localStorage.getItem(TOKEN_KEY)}>{children}</Fragment>
}
