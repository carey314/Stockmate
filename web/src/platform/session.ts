// Platform credentials belong to the separate PlatformAdmin identity.
import { LS } from '../lib/storage'
export const PLATFORM_TOKEN_KEY = LS.platformToken
export const PLATFORM_SESSION_EVENT = 'sm-platform-session-change'
let observed: string | null = null
let revision = 0
export function platformSnapshot() {
  const token = localStorage.getItem(PLATFORM_TOKEN_KEY)
  if (token !== observed) { observed = token; revision++ }
  return { token, revision }
}
export function isPlatformSession(snapshot: ReturnType<typeof platformSnapshot>) {
  const now = platformSnapshot()
  return now.token === snapshot.token && now.revision === snapshot.revision
}
export function setPlatformToken(token: string | null) {
  if (token) localStorage.setItem(PLATFORM_TOKEN_KEY, token)
  else localStorage.removeItem(PLATFORM_TOKEN_KEY)
  observed = token; revision++
  window.dispatchEvent(new Event(PLATFORM_SESSION_EVENT))
}
export function platformStorageChanged(event: StorageEvent) {
  if (event.key !== PLATFORM_TOKEN_KEY && event.key !== null) return
  observed = localStorage.getItem(PLATFORM_TOKEN_KEY); revision++
  window.dispatchEvent(new Event(PLATFORM_SESSION_EVENT))
}
