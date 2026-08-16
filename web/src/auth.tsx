import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Spin } from 'antd'
import api, { TOKEN_KEY, USER_KEY, type ApiUser, type Profile } from './api/client'
import { clearEntitlementCache } from './hooks/useEntitlement'

interface AuthState {
  user: ApiUser | null
  profile: Profile | null
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState>(null as unknown as AuthState)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(() => {
    try {
      const raw = localStorage.getItem(USER_KEY)
      return raw ? (JSON.parse(raw) as ApiUser) : null
    } catch {
      return null
    }
  })
  const [profile, setProfile] = useState<Profile | null>(null)

  const refreshProfile = useCallback(async () => {
    const p = await api.get<Profile>('/auth/profile')
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

  // 多标签页登录态同步：A 标签退出/被 401 踢，B 标签立即跟着下线（storage 事件只在
  // 其他标签触发）；反向：A 登录，B 自动拉取身份。没有它，退出后别的标签还"活着"。
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== TOKEN_KEY) return
      if (!e.newValue) {
        localStorage.removeItem(USER_KEY)
        clearEntitlementCache() // 跨标签同步下线同样要清权益缓存
        setUser(null)
        setProfile(null)
      } else {
        clearEntitlementCache()
        refreshProfile().catch(() => {})
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [refreshProfile])

  const login = useCallback(
    async (username: string, password: string) => {
      const data = await api.post<{ token: string; user: ApiUser }>('/auth/login', {
        username,
        password,
      })
      localStorage.setItem(TOKEN_KEY, data.token)
      localStorage.setItem(USER_KEY, JSON.stringify(data.user))
      clearEntitlementCache() // 不登出直接换号也不能带着上个店的权益缓存
      setUser(data.user)
      refreshProfile().catch(() => {})
    },
    [refreshProfile],
  )

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    // SPA 登出不重载模块——模块级权益缓存不清，会把上家店的 plan/额度带给下个登录的账号（跨租户串台）
    clearEntitlementCache()
    setUser(null)
    setProfile(null)
  }, [])

  const value = useMemo(
    () => ({ user, profile, login, logout, refreshProfile }),
    [user, profile, login, logout, refreshProfile],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const location = useLocation()
  const hasToken = !!localStorage.getItem(TOKEN_KEY)
  if (!user && !hasToken) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }
  if (!user && hasToken) {
    // 有 token 但 profile 还没回来，短暂 loading
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 160 }}>
        <Spin size="large" />
      </div>
    )
  }
  return children
}
