import { adjustMatrix, adjustRoute, buildEtaRange } from './traffic.js'

const fetchWithTimeout = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) })

const GOOGLE_PROXY_MATRIX = '/api/route-matrix'
const GOOGLE_PROXY_ROUTE = '/api/route'

const ensureJson = async (response) => {
  const type = response.headers.get('content-type') || ''
  if (!type.includes('application/json')) throw new Error('Routing provider did not return JSON.')
  return response.json()
}

const tryLiveMatrix = async (points, vehicleId, departureTime) => {
  try {
    const response = await fetchWithTimeout(GOOGLE_PROXY_MATRIX, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        points,
        vehicle: vehicleId,
        departureTime: departureTime.toISOString(),
      }),
    })

    if (!response.ok) return null
    const data = await ensureJson(response)
    if (!Array.isArray(data?.durations) || !Array.isArray(data?.distances)) return null
    return data
  } catch {
    return null
  }
}

const tryLiveRoute = async (points, vehicleId, departureTime) => {
  try {
    const response = await fetchWithTimeout(GOOGLE_PROXY_ROUTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        points,
        vehicle: vehicleId,
        departureTime: departureTime.toISOString(),
      }),
    })

    if (!response.ok) return null
    const data = await ensureJson(response)
    if (!data?.geometry?.coordinates?.length || !Array.isArray(data?.legs)) return null
    return {
      ...data,
      trafficSource: 'live',
      etaRange: data.etaRange || buildEtaRange(data.duration, 'live'),
    }
  } catch {
    return null
  }
}

export async function getTravelTable(points, vehicleId, departureTime = new Date()) {
  const live = await tryLiveMatrix(points, vehicleId, departureTime)
  if (live) {
    return {
      ...live,
      trafficSource: 'live',
      provider: live.provider || 'Google Routes',
    }
  }

  const coords = points.map((point) => `${point.lon},${point.lat}`).join(';')
  const response = await fetchWithTimeout(
    `https://router.project-osrm.org/table/v1/driving/${coords}?annotations=duration,distance`,
  )

  if (!response.ok) throw new Error('The routing service is unavailable. Try again in a moment.')
  const data = await response.json()
  if (data.code !== 'Ok') throw new Error('Could not calculate a road matrix for these locations.')

  return {
    ...data,
    durations: adjustMatrix({
      durations: data.durations,
      distances: data.distances,
      points,
      vehicleId,
      departureTime,
    }),
    trafficSource: 'modeled',
    provider: 'Routly traffic model + OSRM',
  }
}

export async function getRoadRoute(points, vehicleId, departureTime = new Date()) {
  const live = await tryLiveRoute(points, vehicleId, departureTime)
  if (live) return live

  const coords = points.map((point) => `${point.lon},${point.lat}`).join(';')
  const response = await fetchWithTimeout(
    `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`,
  )

  if (!response.ok) throw new Error('Could not draw the road route right now.')
  const data = await response.json()
  if (data.code !== 'Ok' || !data.routes?.[0]) {
    throw new Error('No driveable route was found between those stops.')
  }

  return {
    ...adjustRoute({
      route: data.routes[0],
      points,
      vehicleId,
      departureTime,
    }),
    provider: 'Routly traffic model + OSRM',
  }
}
