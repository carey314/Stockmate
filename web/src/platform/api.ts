import { API_BASE } from '../api/client'
import { isPlatformSession, platformSnapshot, setPlatformToken } from './session'
export interface PlatformError extends Error { status?: number; staleSession?: boolean }
export function platformErrorMessage(error: unknown) {
  const e = error as PlatformError
  if (e.status === 404) return '平台服务尚未升级，当前功能暂不可用。请联系维护人员更新后重试。'
  if (e.status === 503) return '平台服务尚未就绪或暂时不可用，请稍后重试。'
  return e.message || '平台请求失败'
}
async function request<T>(path: string, method: string, body?: object, params?: object): Promise<T> {
  if (!path.startsWith('/platform/')) throw new Error('平台客户端只允许平台接口')
  const snapshot = platformSnapshot()
  const query = new URLSearchParams()
  for (const [key,value] of Object.entries(params ?? {})) if (value !== undefined && value !== null && value !== '') query.set(key,String(value))
  const headers: Record<string,string> = { 'Content-Type':'application/json' }
  if (snapshot.token && path !== '/platform/auth/login') headers.Authorization=`Bearer ${snapshot.token}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    const response = await fetch(`${API_BASE}${path}${query.size ? `?${query}` : ''}`, { method, headers, credentials:'omit', cache:'no-store', signal:controller.signal, ...(body ? {body:JSON.stringify(body)} : {}) })
    const result = await response.json().catch(() => null)
    if (!isPlatformSession(snapshot)) throw Object.assign(new Error('平台登录身份已变化，请重新打开页面'), {staleSession:true})
    const status = !response.ok ? response.status : typeof result?.code === 'number' && result.code >= 400 ? result.code : undefined
    if (status) {
      if (status === 401 && snapshot.token && path !== '/platform/auth/login') setPlatformToken(null)
      const error = Object.assign(new Error(result?.message || '平台请求失败'), {status})
      error.message = platformErrorMessage(error)
      throw error
    }
    if (!result) throw new Error('平台响应格式无效，请重试')
    return result.data !== undefined ? result.data : result
  } catch (error) {
    if (!isPlatformSession(snapshot) && !(error as PlatformError).status) throw Object.assign(new Error('平台登录身份已变化，请重新打开页面'), {staleSession:true})
    if ((error as Error).name === 'AbortError') throw new Error('平台请求超时，结果可能尚未返回，请重试原请求')
    throw error
  } finally { clearTimeout(timer) }
}
export const platformApi = {
  get: <T=unknown>(path:string,params?:object) => request<T>(path,'GET',undefined,params),
  post: <T=unknown>(path:string,body?:object) => request<T>(path,'POST',body),
}
