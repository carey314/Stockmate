import { useEffect, useState } from 'react'
import api from '../api/client'

// GET /me/entitlement 的契约（App 窗口验证过的真实返回，别改形状）
export interface Entitlement {
  plan: string // 'free' 或付费档位；判断付费用 plan !== 'free'
  source: string | null
  expiresAt: string | null
  aiUsedThisMonth: number
  daysHitLimitThisMonth: number
  today: {
    coreUsed: number
    coreLimit: number | null // ⚠️ null = 不限次（专业版），绝不能当 0 做 used>=limit 判断
    otherUsed: number
    otherLimit: number | null
  }
}

// 模块级缓存：四个 AI 页面 + 顶栏共用一份数据，不重复请求。
// AI 调用成功/撞墙后调 refreshEntitlement() 让所有订阅者一起更新。
let cache: Entitlement | null = null
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

const fetchEnt = () => {
  inflight ??= api
    .get<Entitlement>('/me/entitlement')
    .then((d) => {
      cache = d
    })
    .catch(() => {
      // 铁律：拿不到就不显示，不给默认值糊弄。cache 保持 null，UI 自动不渲染。
    })
    .finally(() => {
      inflight = null
      listeners.forEach((l) => l())
    })
  return inflight
}

export const refreshEntitlement = () => {
  cache = null
  return fetchEnt()
}

// 登出/切店时清缓存（auth 变化后首个订阅者会重新拉）
export const clearEntitlementCache = () => {
  cache = null
}

export function useEntitlement(): { ent: Entitlement | null; refresh: () => void } {
  const [, force] = useState(0)
  useEffect(() => {
    const bump = () => force((n) => n + 1)
    listeners.add(bump)
    if (!cache) fetchEnt()
    return () => {
      listeners.delete(bump)
    }
  }, [])
  return { ent: cache, refresh: refreshEntitlement }
}
