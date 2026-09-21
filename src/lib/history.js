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
    return Array.isArray(value) ? value.filter((entry) => {
      const validPoint = (point) => point && Number.isFinite(point.lat) && Number.isFinite(point.lon) &&
        Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180 && typeof point.label === 'string'
      return entry && typeof entry.id === 'string' && validPoint(entry.origin) &&
        Array.isArray(entry.inputStops) && entry.inputStops.length >= 2 && entry.inputStops.length <= 10 &&
        entry.inputStops.every(validPoint) && Array.isArray(entry.optimizedStops) &&
        entry.optimizedStops.every(validPoint)
    }).slice(0, MAX_HISTORY) : []
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
