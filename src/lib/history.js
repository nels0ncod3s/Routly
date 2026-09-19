const HISTORY_KEY = 'routly.route-history.v1'
const MAX_HISTORY = 30

const safeParse = (value, fallback) => {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

export function loadRouteHistory() {
  if (typeof window === 'undefined') return []

  try {
    const value = safeParse(window.localStorage.getItem(HISTORY_KEY), [])
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

const persist = (items) => {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY)))
  } catch {
    // History is a convenience feature. Routing must continue even if storage is blocked.
  }
}

export function addRouteHistory(existing, entry) {
  const next = [
    {
      ...entry,
      id: entry.id || `route-${Date.now()}`,
      createdAt: entry.createdAt || new Date().toISOString(),
      saved: Boolean(entry.saved),
    },
    ...existing.filter((item) => item.id !== entry.id),
  ].slice(0, MAX_HISTORY)

  persist(next)
  return next
}

export function toggleSavedRoute(existing, routeId) {
  const next = existing.map((item) =>
    item.id === routeId ? { ...item, saved: !item.saved } : item,
  )
  persist(next)
  return next
}

export function deleteRouteHistory(existing, routeId) {
  const next = existing.filter((item) => item.id !== routeId)
  persist(next)
  return next
}

export function clearRouteHistory() {
  persist([])
  return []
}
