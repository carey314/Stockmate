import { LS, SS } from './storage'
export const TOKEN_KEY = LS.token
export const USER_KEY = LS.user
export const SESSION_EVENT = 'sm-session-change'
let token: string | null = localStorage.getItem(TOKEN_KEY)
let revision = 0
export function sessionSnapshot() {
  const current = localStorage.getItem(TOKEN_KEY)
  if (current !== token) { token = current; revision++ }
  return { token, revision }
}
export function isCurrentSession(snapshot: ReturnType<typeof sessionSnapshot>) {
  const current = sessionSnapshot()
  return current.token === snapshot.token && current.revision === snapshot.revision
}
export function clearChatStorage() {
  for (const key of Object.keys(sessionStorage)) {
    if (key === SS.legacyChat || key.startsWith(SS.chatPrefix)) sessionStorage.removeItem(key)
  }
}
export function notifySessionChange() {
  revision++
  token = localStorage.getItem(TOKEN_KEY)
  clearChatStorage()
  window.dispatchEvent(new Event(SESSION_EVENT))
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  notifySessionChange()
}
