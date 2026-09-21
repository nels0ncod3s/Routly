const MATRIX_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix'

const durationToSeconds = (value) => {
  if (!value) return 0
  return Number.parseFloat(String(value).replace('s', '')) || 0
}

const travelModeFor = (vehicle) => vehicle === 'motorcycle' ? 'TWO_WHEELER' : 'DRIVE'

const validPoints = (points) =>
  Array.isArray(points) &&
  points.length >= 2 &&
  points.length <= 11 &&
  points.every((point) => point &&
    typeof point.lat === 'number' && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90 &&
    typeof point.lon === 'number' && Number.isFinite(point.lon) && Math.abs(point.lon) <= 180)

const waypoint = (point) => ({
  waypoint: {
    location: {
      latLng: {
        latitude: Number(point.lat),
        longitude: Number(point.lon),
      },
    },
  },
})

const departure = (value) => {
  const parsed = new Date(value || Date.now())
  const now = Date.now()
  const timestamp = Number.isFinite(parsed.getTime()) ? Math.max(parsed.getTime(), now) : now
  return new Date(timestamp).toISOString()
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return res.status(503).json({
      error: 'Live traffic provider is not configured.',
      configured: false,
    })
  }

  const { points, vehicle = 'motorcycle', departureTime } = req.body || {}
  if (!validPoints(points)) {
    return res.status(400).json({ error: 'Provide between 2 and 11 valid route points.' })
  }

  try {
    const response = await fetch(MATRIX_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'originIndex,destinationIndex,status,condition,distanceMeters,duration,staticDuration',
      },
      body: JSON.stringify({
        origins: points.map(waypoint),
        destinations: points.map(waypoint),
        travelMode: travelModeFor(vehicle),
        routingPreference: 'TRAFFIC_AWARE',
        departureTime: departure(departureTime),
      }),
    })

    const payload = await response.json()
    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Live traffic matrix request failed.',
        providerError: payload?.error?.message || null,
      })
    }

    const elements = Array.isArray(payload) ? payload : []
    const size = points.length
    const durations = Array.from({ length: size }, (_, row) =>
      Array.from({ length: size }, (_, col) => row === col ? 0 : null),
    )
    const distances = Array.from({ length: size }, (_, row) =>
      Array.from({ length: size }, (_, col) => row === col ? 0 : null),
    )
    const staticDurations = Array.from({ length: size }, (_, row) =>
      Array.from({ length: size }, (_, col) => row === col ? 0 : null),
    )

    for (const element of elements) {
      const row = element.originIndex
      const col = element.destinationIndex
      if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row >= size || col >= size) continue
      if (element.status?.code || !element.duration) continue
      if (element.condition && element.condition !== 'ROUTE_EXISTS') continue
      durations[row][col] = durationToSeconds(element.duration)
      staticDurations[row][col] = durationToSeconds(element.staticDuration)
      distances[row][col] = Number(element.distanceMeters || 0)
    }

    return res.status(200).json({
      durations,
      distances,
      staticDurations,
      provider: 'Google Routes',
      trafficSource: 'live',
      departureTime: departure(departureTime),
    })
  } catch (error) {
    return res.status(502).json({
      error: 'Unable to reach the live traffic provider.',
      detail: error instanceof Error ? error.message : 'Unknown provider error',
    })
  }
}
