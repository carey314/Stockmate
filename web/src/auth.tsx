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

  const login = useCallback(
    async (username: string, password: string) => {
      const data = await api.post<{ token: string; user: ApiUser }>('/auth/login', {
        username,
        password,
      })
      localStorage.setItem(TOKEN_KEY, data.token)
      localStorage.setItem(USER_KEY, JSON.stringify(data.user))
      setUser(data.user)
      refreshProfile().catch(() => {})
    },
    [refreshProfile],
  )

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
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
