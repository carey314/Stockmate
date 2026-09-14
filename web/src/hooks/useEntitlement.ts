import { useEffect, useRef, useState } from 'react'
import api from '../api/client'
import { sessionSnapshot, isCurrentSession, SESSION_EVENT } from '../lib/session'

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
    coreAntiAbuseLimit?: number | null
    otherAntiAbuseLimit?: number | null
    resetAt?: string
    timeZone?: string
    otherLimit: number | null
  }
}

// 缓存与在途请求都绑定身份；旧请求结束不能覆盖新身份或清空新请求。
let cache: Entitlement | null = null
let owner = sessionSnapshot()
let generation = 0
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
export const clearEntitlementCache = () => {
  generation++
  owner = sessionSnapshot()
  cache = null
  inflight = null
  emit()
}
const fetchEnt = () => {
  if (!isCurrentSession(owner)) clearEntitlementCache()
  if (!owner.token) return Promise.resolve()
  if (inflight) return inflight
  const ticket = generation
  const snapshot = owner
  const request = api.get<Entitlement>('/me/entitlement')
    .then((d) => { if (ticket === generation && isCurrentSession(snapshot)) cache = d })
    .catch(() => {})
    .finally(() => {
      if (ticket !== generation || !isCurrentSession(snapshot)) return
      inflight = null
      emit()
    })
  inflight = request
  return request
}
export const refreshEntitlement = () => {
  cache = null
  emit()
  return fetchEnt()
}
window.addEventListener(SESSION_EVENT, clearEntitlementCache)

export function useEntitlement(): { ent: Entitlement | null; refresh: () => void; updated: boolean } {
  const [, force] = useState(0)
  const previousPlan = useRef<string | null>(cache?.plan ?? null)
  const [updated, setUpdated] = useState(false)
  useEffect(() => {
    const bump = () => {
      if (cache) {
        if (previousPlan.current !== null && previousPlan.current !== cache.plan) setUpdated(true)
        previousPlan.current = cache.plan
      }
      force((n) => n + 1)
    }
    listeners.add(bump)
    if (!cache || !isCurrentSession(owner)) fetchEnt()
    const focus = () => { refreshEntitlement() }
    window.addEventListener('focus', focus)
    return () => {
      listeners.delete(bump)
      window.removeEventListener('focus', focus)
    }
  }, [])
  return { ent: isCurrentSession(owner) ? cache : null, refresh: refreshEntitlement, updated }
}
