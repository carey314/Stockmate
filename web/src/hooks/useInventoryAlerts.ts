import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../api/client'
import { isCurrentSession, sessionSnapshot, SESSION_EVENT } from '../lib/session'
import { t } from '../lib/i18n'

export interface InventoryAlert {
  id: number
  quantity: number
  minQuantity: number
  sku: { id: number; specText: string; product: { id: number; name: string; unit: string } }
}
// Last success is a same-session snapshot, never evidence of current stock after a failure.
export function useInventoryAlerts() {
  const [data, setData] = useState<InventoryAlert[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const sequence = useRef(0), alive = useRef(true)
  useEffect(() => {
    alive.current = true
    const reset = () => { sequence.current++; setData(null); setError(null); setUpdatedAt(null); setLoading(false) }
    window.addEventListener(SESSION_EVENT, reset)
    return () => { alive.current = false; sequence.current++; window.removeEventListener(SESSION_EVENT, reset) }
  }, [])
  const refresh = useCallback(async () => {
    const ticket = ++sequence.current, owner = sessionSnapshot()
    const current = () => alive.current && ticket === sequence.current && isCurrentSession(owner)
    setLoading(true); setError(null)
    try {
      const rows = await api.get<InventoryAlert[]>('/inventory/alerts')
      if (!Array.isArray(rows) || rows.some(row => !Number.isSafeInteger(row?.id) || !Number.isFinite(row?.quantity) || !Number.isFinite(row?.minQuantity) || typeof row?.sku?.product?.name !== 'string')) throw new Error(t('预警数据格式异常', 'Invalid stock alert response'))
      if (current()) { setData(rows); setUpdatedAt(new Date().toISOString()) }
    } catch (e) { if (current()) setError((e as Error).message || t('请求失败', 'Request failed')) }
    finally { if (current()) setLoading(false) }
  }, [])
  return { data, error, loading, updatedAt, refresh }
}
