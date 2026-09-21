const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes'

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

const location = (point) => ({
  location: {
    latLng: {
      latitude: Number(point.lat),
      longitude: Number(point.lon),
    },
  },
})

const departure = (value) => {
  const parsed = new Date(value || Date.now())
  const now = Date.now()
  const timestamp = Number.isFinite(parsed.getTime()) ? Math.max(parsed.getTime(), now) : now
  return new Date(timestamp).toISOString()
}

const trafficLabel = (duration, staticDuration) => {
  if (!staticDuration) return 'Traffic aware'
  const ratio = duration / staticDuration
  if (ratio < 1.16) return 'Light traffic'
  if (ratio < 1.42) return 'Moderate traffic'
  if (ratio < 1.85) return 'Busy traffic'
  return 'Heavy traffic'
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

  const origin = points[0]
  const destination = points[points.length - 1]
  const intermediates = points.slice(1, -1)

  try {
    const response = await fetch(ROUTES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': [
          'routes.duration',
          'routes.staticDuration',
          'routes.distanceMeters',
          'routes.polyline.geoJsonLinestring',
          'routes.legs.duration',
          'routes.legs.staticDuration',
          'routes.legs.distanceMeters',
        ].join(','),
      },
      body: JSON.stringify({
        origin: location(origin),
        destination: location(destination),
        intermediates: intermediates.map(location),
        travelMode: travelModeFor(vehicle),
        routingPreference: 'TRAFFIC_AWARE',
        departureTime: departure(departureTime),
        polylineQuality: 'OVERVIEW',
        polylineEncoding: 'GEO_JSON_LINESTRING',
      }),
    })

    const payload = await response.json()
    if (!response.ok || !payload?.routes?.[0]) {
      return res.status(response.ok ? 502 : response.status).json({
        error: 'Live traffic route request failed.',
        providerError: payload?.error?.message || null,
      })
    }

    const route = payload.routes[0]
    const duration = durationToSeconds(route.duration)
    const staticDuration = durationToSeconds(route.staticDuration)
    const legs = (route.legs || []).map((leg) => ({
      duration: durationToSeconds(leg.duration),
      freeFlowDuration: durationToSeconds(leg.staticDuration),
      distance: Number(leg.distanceMeters || 0),
      trafficLabel: trafficLabel(
        durationToSeconds(leg.duration),
        durationToSeconds(leg.staticDuration),
      ),
    }))

    return res.status(200).json({
      duration,
      freeFlowDuration: staticDuration,
      distance: Number(route.distanceMeters || 0),
      geometry: route.polyline?.geoJsonLinestring || { type: 'LineString', coordinates: [] },
      legs,
      provider: 'Google Routes',
      trafficSource: 'live',
      trafficLabel: trafficLabel(duration, staticDuration),
      etaRange: {
        min: Math.max(0, Math.round(duration * 0.9)),
        max: Math.round(duration * 1.1),
      },
      departureTime: departure(departureTime),
    })
  } catch (error) {
    return res.status(502).json({
      error: 'Unable to reach the live traffic provider.',
      detail: error instanceof Error ? error.message : 'Unknown provider error',
    })
  }
}
