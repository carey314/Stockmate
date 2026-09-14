import { isCurrentSession, sessionSnapshot } from './session'
import { LS } from './storage'

// Capture the verified account and session once. A stale page can never write with a new token.
export function draftStorage<T>(kind: string, userId?: number, storeId?: number) {
  const session = sessionSnapshot()
  const key = `${LS.draftPrefix}${storeId ?? 'account'}:${userId}:${kind}`
  const current = () => !!userId && !!session.token && isCurrentSession(session)
  let readError: string | null = null
  let initial: T | null = null
  let previousRaw: string | null = null
  if (current()) {
    try {
      const raw = localStorage.getItem(key)
      previousRaw = raw
      if (raw) {
        const record = JSON.parse(raw)
        if (record.version !== 1 || record.userId !== userId || record.storeId !== (storeId ?? null)) throw new Error('Invalid draft')
        initial = record.value
      }
    } catch {
      readError = '草稿读取失败，原稿已保留。请恢复浏览器存储后重新打开页面。'
    }
  }
  return {
    initial, readError, current,
    write(value: T): string | null {
      if (!current()) return '登录身份已变化，请重新打开页面。'
      if (readError) return readError
      try {
        // A single atomic overwrite. Never delete the pending confirmation before saving its result.
        if (localStorage.getItem(key) !== previousRaw) return '草稿已在其他页面更新，请重新打开页面恢复；不会覆盖已有确认。'
        const next = JSON.stringify({ version: 1, userId, storeId: storeId ?? null, value })
        localStorage.setItem(key, next)
        previousRaw = next
        return null
      } catch {
        return '草稿保存失败，请恢复浏览器存储后重试；本次不会发起新的入账。'
      }
    },
  }
}
