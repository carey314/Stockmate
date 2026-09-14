import axios from 'axios'
import { staticHolder } from '../antdStatic'
import { TOKEN_KEY, USER_KEY, sessionSnapshot, isCurrentSession, clearSession } from '../lib/session'
export { TOKEN_KEY, USER_KEY }

type RequestSession = { session?: ReturnType<typeof sessionSnapshot> }
const isLoginRequest = (url?: string) => url === '/auth/login' || url === '/auth/web-bridge/redeem' || url?.startsWith('/auth/web-login/') === true
const staleError = () => Object.assign(new Error('登录身份已变化，请重试'), { staleSession: true })

// 本地开发直连后端（server CORS 全开）；生产打包时用 VITE_API_BASE 覆盖
export const API_BASE =
  import.meta.env.VITE_API_BASE || 'http://localhost:3100/api/v1'

// 商品图等相对路径（/uploads/..）由后端服务，补上后端 origin
export const assetUrl = (p: string | null | undefined) =>
  p ? (p.startsWith('http') ? p : API_BASE.replace(/\/api\/v1\/?$/, '') + p) : null


export interface ApiUser {
  id: number
  username: string
  realName: string
  role: 'admin' | 'staff'
}

export interface Profile extends ApiUser {
  storeId?: number
  phone: string | null
  shopName: string
  mainTypeId: number | null
}

const client = axios.create({ baseURL: API_BASE, timeout: 30000 })

// 同步绑定调用时身份，避免下一微任务换号后将旧 payload 随新 token 发送。
client.interceptors.request.use((config) => {
  const snapshot = sessionSnapshot()
  ;(config as typeof config & RequestSession).session = snapshot
  const token = snapshot.token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
}, undefined, { synchronous: true })

// 后端统一信封 {code, message, data}；这里解包，调用方直接拿 data
client.interceptors.response.use(
  (res) => {
    const snapshot = (res.config as typeof res.config & RequestSession).session
    if (snapshot && !isCurrentSession(snapshot)) return Promise.reject(staleError())
    const body = res.data
    if (body && typeof body.code === 'number' && body.code >= 400) {
      if (body.code === 401 && snapshot?.token && !isLoginRequest(res.config.url)) clearSession()
      return Promise.reject(Object.assign(new Error(body.message || '请求失败'), { status: body.code }))
    }
    return body?.data !== undefined ? body.data : body
  },
  (err) => {
    const snapshot = (err.config as RequestSession | undefined)?.session
    if (snapshot && !isCurrentSession(snapshot)) return Promise.reject(staleError())
    const status = err.response?.status
    let msg = err.response?.data?.message || err.message || '网络错误'
    // zod 校验错误带 errors 数组，拼进提示（只报"校验失败"没人知道错在哪）
    const errs = err.response?.data?.errors
    if (Array.isArray(errs) && errs.length) {
      msg += `：${errs.map((e: { message?: string }) => e.message).filter(Boolean).join('；')}`
    }
    if (status === 401 && snapshot?.token && !isLoginRequest(err.config?.url)) {
      clearSession()
      staticHolder.message?.error('登录已过期，请重新登录')
    }
    // status 一起带出去：页面要靠它区分 402（免费额度用完→升级引导）和 429（专业版防滥用→只弹原文）。
    // 现有 catch 只读 .message，加字段向后兼容。
    return Promise.reject(Object.assign(new Error(msg), { status }))
  },
)

/** api 拒绝值的形状：Error + 可选 HTTP status（402/429 分流用） */
export interface ApiError extends Error {
  status?: number
}

// 解包后返回值类型已是 data 本身
export const api = {
  get: <T = unknown>(url: string, params?: object) =>
    client.get(url, { params }) as Promise<T>,
  post: <T = unknown>(url: string, data?: object) =>
    client.post(url, data) as Promise<T>,
  put: <T = unknown>(url: string, data?: object) =>
    client.put(url, data) as Promise<T>,
  delete: <T = unknown>(url: string) => client.delete(url) as Promise<T>,
}

export default api
