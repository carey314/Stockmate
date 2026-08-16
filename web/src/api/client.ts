import axios from 'axios'
import { staticHolder } from '../antdStatic'

// 本地开发直连后端（server CORS 全开）；生产打包时用 VITE_API_BASE 覆盖
export const API_BASE =
  import.meta.env.VITE_API_BASE || 'http://localhost:3100/api/v1'

// 商品图等相对路径（/uploads/..）由后端服务，补上后端 origin
export const assetUrl = (p: string | null | undefined) =>
  p ? (p.startsWith('http') ? p : API_BASE.replace(/\/api\/v1\/?$/, '') + p) : null

export const TOKEN_KEY = 'sm_token'
export const USER_KEY = 'sm_user'

export interface ApiUser {
  id: number
  username: string
  realName: string
  role: 'admin' | 'staff'
}

export interface Profile extends ApiUser {
  phone: string | null
  shopName: string
  mainTypeId: number | null
}

const client = axios.create({ baseURL: API_BASE, timeout: 30000 })

client.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// 后端统一信封 {code, message, data}；这里解包，调用方直接拿 data
client.interceptors.response.use(
  (res) => {
    const body = res.data
    if (body && typeof body.code === 'number' && body.code >= 400) {
      return Promise.reject(Object.assign(new Error(body.message || '请求失败'), { status: body.code }))
    }
    return body?.data !== undefined ? body.data : body
  },
  (err) => {
    const status = err.response?.status
    let msg = err.response?.data?.message || err.message || '网络错误'
    // zod 校验错误带 errors 数组，拼进提示（只报"校验失败"没人知道错在哪）
    const errs = err.response?.data?.errors
    if (Array.isArray(errs) && errs.length) {
      msg += `：${errs.map((e: { message?: string }) => e.message).filter(Boolean).join('；')}`
    }
    if (status === 401) {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(USER_KEY)
      // 避免登录页自身的 401（密码错）触发跳转循环
      if (!location.pathname.endsWith('/login')) {
        staticHolder.message?.error('登录已过期，请重新登录')
        const base = import.meta.env.BASE_URL
        location.href = `${base}login`
        return new Promise(() => {}) // 页面即将跳走，挂起后续处理
      }
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
