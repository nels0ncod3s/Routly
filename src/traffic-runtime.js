const nativeFetch = window.fetch.bind(window)

const LAGOS_BOUNDS = {
  minLat: 6.28,
  maxLat: 6.78,
  minLon: 3.02,
  maxLon: 3.72,
}

const inLagosArea = ({ lat, lon }) =>
  lat >= LAGOS_BOUNDS.minLat &&
  lat <= LAGOS_BOUNDS.maxLat &&
  lon >= LAGOS_BOUNDS.minLon &&
  lon <= LAGOS_BOUNDS.maxLon

const parseCoordinates = (url) => {
  try {
    const path = new URL(url).pathname
    const coordinatePart = path.split('/driving/')[1]
    if (!coordinatePart) return []

    return coordinatePart.split(';').map((pair) => {
      const [lon, lat] = pair.split(',').map(Number)
      return { lat, lon }
    }).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon))
  } catch {
    return []
  }
}

const getDecimalHour = (date) => date.getHours() + date.getMinutes() / 60

function getLagosTrafficProfile(date = new Date()) {
  const hour = getDecimalHour(date)
  const day = date.getDay()
  const weekend = day === 0 || day === 6

  if (weekend) {
    if (hour < 6) return { key: 'clear', label: 'Light traffic', multiplier: 1.2, speedKmh: 32 }
    if (hour < 11) return { key: 'moderate', label: 'Moderate traffic', multiplier: 1.5, speedKmh: 24 }
    if (hour < 16) return { key: 'busy', label: 'Busy traffic', multiplier: 1.8, speedKmh: 20 }
    if (hour < 21) return { key: 'heavy', label: 'Heavy traffic', multiplier: 2.05, speedKmh: 17 }
    return { key: 'moderate', label: 'Moderate traffic', multiplier: 1.45, speedKmh: 25 }
  }

  if (hour < 5) return { key: 'clear', label: 'Light traffic', multiplier: 1.2, speedKmh: 34 }
  if (hour < 6.5) return { key: 'building', label: 'Traffic building', multiplier: 1.65, speedKmh: 23 }
  if (hour < 10.5) return { key: 'rush', label: 'Morning rush', multiplier: 2.75, speedKmh: 14 }
  if (hour < 15.5) return { key: 'busy', label: 'Daytime traffic', multiplier: 2.25, speedKmh: 18 }
  if (hour < 17) return { key: 'heavy', label: 'Afternoon traffic', multiplier: 2.5, speedKmh: 15 }
  if (hour < 21) return { key: 'rush', label: 'Evening rush', multiplier: 2.9, speedKmh: 13 }
  if (hour < 23) return { key: 'busy', label: 'Late traffic', multiplier: 1.8, speedKmh: 22 }
  return { key: 'clear', label: 'Light traffic', multiplier: 1.3, speedKmh: 30 }
}

function getGeneralTrafficProfile(date = new Date()) {
  const hour = getDecimalHour(date)
  const day = date.getDay()
  const weekend = day === 0 || day === 6

  if (weekend) {
    if (hour >= 11 && hour < 20) return { key: 'moderate', label: 'Typical traffic', multiplier: 1.35, speedKmh: 32 }
    return { key: 'clear', label: 'Light traffic', multiplier: 1.15, speedKmh: 40 }
  }

  if ((hour >= 6.5 && hour < 10) || (hour >= 16 && hour < 20.5)) {
    return { key: 'busy', label: 'Rush-hour traffic', multiplier: 1.65, speedKmh: 26 }
  }

  if (hour >= 10 && hour < 16) {
    return { key: 'moderate', label: 'Typical traffic', multiplier: 1.3, speedKmh: 34 }
  }

  return { key: 'clear', label: 'Light traffic', multiplier: 1.12, speedKmh: 42 }
}

function getProfile(from, to, date) {
  return inLagosArea(from) && inLagosArea(to)
    ? getLagosTrafficProfile(date)
    : getGeneralTrafficProfile(date)
}

function adjustedDuration(baseSeconds, distanceMeters, from, to, date = new Date()) {
  if (!Number.isFinite(baseSeconds) || baseSeconds <= 0) return baseSeconds || 0

  const distanceKm = Math.max(0, Number(distanceMeters || 0) / 1000)
  const profile = getProfile(from, to, date)

  const multiplied = baseSeconds * profile.multiplier
  const speedFloor = distanceKm > 0
    ? (distanceKm / profile.speedKmh) * 3600
    : 0

  // Urban routing APIs generally omit the cumulative cost of junctions,
  // merging, parking exits and small slowdowns. Add a modest per-leg buffer.
  const junctionBuffer = Math.min(7 * 60, 90 + distanceKm * 12)
  const duration = Math.max(multiplied, speedFloor) + junctionBuffer

  return Math.round(duration)
}

function patchTablePayload(data, coordinates) {
  if (!Array.isArray(data?.durations) || coordinates.length < 2) return data

  const now = new Date()
  const durations = data.durations.map((row, fromIndex) =>
    row.map((duration, toIndex) => {
      if (fromIndex === toIndex || duration == null) return duration
      const distance = data.distances?.[fromIndex]?.[toIndex] || 0
      const from = coordinates[fromIndex]
      const to = coordinates[toIndex]
      if (!from || !to) return duration
      return adjustedDuration(duration, distance, from, to, now)
    }),
  )

  return { ...data, durations }
}

function patchRoutePayload(data, coordinates) {
  if (!Array.isArray(data?.routes) || !coordinates.length) return data

  const routes = data.routes.map((route) => {
    if (!Array.isArray(route.legs)) return route

    let departure = new Date()
    const legs = route.legs.map((leg, index) => {
      const from = coordinates[index]
      const to = coordinates[index + 1]
      if (!from || !to) return leg

      const duration = adjustedDuration(leg.duration, leg.distance, from, to, departure)
      const profile = getProfile(from, to, departure)
      departure = new Date(departure.getTime() + duration * 1000)

      return {
        ...leg,
        duration,
        trafficMultiplier: profile.multiplier,
        trafficLabel: profile.label,
        freeFlowDuration: leg.duration,
      }
    })

    return {
      ...route,
      legs,
      freeFlowDuration: route.duration,
      duration: legs.reduce((sum, leg) => sum + (leg.duration || 0), 0),
      trafficAdjusted: true,
    }
  })

  return { ...data, routes }
}

window.__ROUTLY_TRAFFIC__ = {
  model: 'time-of-day-v1',
  lagos: true,
  note: 'Heuristic traffic adjustment, not live traffic telemetry.',
}

window.fetch = async (...args) => {
  const response = await nativeFetch(...args)
  const request = args[0]
  const url = typeof request === 'string' ? request : request?.url || ''

  if (!response.ok || !url.includes('router.project-osrm.org')) return response

  try {
    const data = await response.clone().json()
    const coordinates = parseCoordinates(url)
    let patched = data

    if (url.includes('/table/v1/driving/')) patched = patchTablePayload(data, coordinates)
    if (url.includes('/route/v1/driving/')) patched = patchRoutePayload(data, coordinates)

    return new Response(JSON.stringify(patched), {
      status: response.status,
      statusText: response.statusText,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    return response
  }
}
