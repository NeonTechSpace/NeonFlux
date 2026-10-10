import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore } from 'react'

/** Unsaved form drafts, kept per signed-in user, server and dashboard section in this tab's session storage. They survive
 *  switching sections or servers, reloading and signing in again, and end with the tab, a save, a discard or signing out */
export interface DraftScope { userId: string, serverId: string, section: string }
const DraftContext = createContext<DraftScope | undefined>(undefined)
export const DraftScopeProvider = DraftContext.Provider
export const useDraftScope = () => useContext(DraftContext)

const PREFIX = 'neonflux.draft.v1:'
// Bounds for one tab: The newest drafts win, and an oversized draft stays in memory only
export const MAX_DRAFTS = 50
export const MAX_DRAFT_LENGTH = 100_000
function storage(): Storage | undefined { try { return typeof window === 'undefined' ? undefined : window.sessionStorage } catch { return undefined } }
const storageKey = (scope: DraftScope, form: string) => PREFIX + JSON.stringify([scope.userId,scope.serverId,scope.section,form])
function entries(store: Storage) {
  const found: Array<{ key: string, scope: [string,string,string,string], at: number }> = []
  for (let index = 0; index < store.length; index++) {
    const key = store.key(index)
    if (!key?.startsWith(PREFIX)) continue
    try { const scope = JSON.parse(key.slice(PREFIX.length)) as [string,string,string,string], at = Number((JSON.parse(store.getItem(key) ?? '{}') as { at?: unknown }).at); found.push({ key,scope,at: Number.isFinite(at) ? at : 0 }) }
    catch { found.push({ key,scope: ['','','',''],at: 0 }) }
  }
  return found
}

// Listeners hear when a draft starts or ends, not about every keystroke, so section badges update without rerendering forms
const listeners = new Set<() => void>()
let version = 0
const changed = () => { version++; listeners.forEach(listener => listener()) }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export function readDraft<T>(scope: DraftScope, form: string): T | undefined {
  try { const raw = storage()?.getItem(storageKey(scope,form)); return raw ? (JSON.parse(raw) as { value: T }).value : undefined } catch { return undefined }
}
export function writeDraft(scope: DraftScope, form: string, value: unknown) {
  const store = storage(), key = storageKey(scope,form)
  if (!store) return
  const raw = JSON.stringify({ at: Date.now(),value }), existed = store.getItem(key) !== null
  try {
    if (raw.length > MAX_DRAFT_LENGTH) { store.removeItem(key); if (existed) changed(); return }
    store.setItem(key,raw)
    const all = entries(store).sort((a,b) => b.at - a.at)
    for (const old of all.slice(MAX_DRAFTS)) store.removeItem(old.key)
  } catch { store.removeItem(key) }
  if (!existed) changed()
}
export function clearDraft(scope: DraftScope, form: string) {
  const store = storage(), key = storageKey(scope,form)
  if (store?.getItem(key) === null || !store) return
  store.removeItem(key); changed()
}
/** Signing out removes every draft in this tab */
export function clearAllDrafts() {
  const store = storage()
  if (!store) return
  for (const entry of entries(store)) store.removeItem(entry.key)
  changed()
}
/** Sections of one server with at least one unsaved draft */
export function useDraftSections(userId: string, serverId: string): ReadonlySet<string> {
  const current = useSyncExternalStore(subscribe,() => version,() => 0)
  return useMemo(() => { const store = storage(); return new Set(store ? entries(store).filter(entry => entry.scope[0] === userId && entry.scope[1] === serverId).map(entry => entry.scope[2]) : []) },[userId,serverId,current])
}

/** A stored draft for state outside SettingsForm. restored reports a draft found when the component mounted */
export function useStoredDraft<T>(form: string, initial: T): { value: T, set: (value: T) => void, clear: () => void, forget: () => void, restored: boolean } {
  const scope = useDraftScope()
  const [state,setState] = useState(() => { const stored = scope ? readDraft<T>(scope,form) : undefined; return { value: stored ?? initial,restored: stored !== undefined } })
  const set = useCallback((value: T) => { setState(current => ({ ...current,value })); if (scope) writeDraft(scope,form,value) },[scope,form])
  const clear = useCallback(() => { setState({ value: initial,restored: false }); if (scope) clearDraft(scope,form) },[scope,form])
  // Keeps the shown value but stops storing it, for a draft that was just sent
  const forget = useCallback(() => { setState(current => ({ ...current,restored: false })); if (scope) clearDraft(scope,form) },[scope,form])
  return { ...state,set,clear,forget }
}
