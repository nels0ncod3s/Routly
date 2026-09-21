import { getVehicleProfile } from './vehicles.js'

const LAGOS_BOUNDS = {
  minLat: 6.28,
  maxLat: 6.78,
  minLon: 3.02,
  maxLon: 3.72,
}

export const inLagosArea = ({ lat, lon }) =>
  Number(lat) >= LAGOS_BOUNDS.minLat &&
  Number(lat) <= LAGOS_BOUNDS.maxLat &&
  Number(lon) >= LAGOS_BOUNDS.minLon &&
  Number(lon) <= LAGOS_BOUNDS.maxLon

const decimalHour = (date) => date.getHours() + date.getMinutes() / 60

export function getLagosTrafficProfile(date = new Date()) {
  // Lagos uses UTC+1 year-round, regardless of the viewer's device timezone.
  const lagos = new Date(date.getTime() + 60 * 60 * 1000)
  const hour = lagos.getUTCHours() + lagos.getUTCMinutes() / 60
  const weekend = lagos.getUTCDay() === 0 || lagos.getUTCDay() === 6

  if (weekend) {
    if (hour < 6) return { key: 'light', label: 'Light traffic', multiplier: 1.18, speedKmh: 34, uncertainty: 0.13 }
    if (hour < 11) return { key: 'moderate', label: 'Moderate traffic', multiplier: 1.45, speedKmh: 25, uncertainty: 0.15 }
    if (hour < 16) return { key: 'busy', label: 'Busy traffic', multiplier: 1.72, speedKmh: 21, uncertainty: 0.17 }
    if (hour < 21) return { key: 'heavy', label: 'Heavy traffic', multiplier: 1.95, speedKmh: 18, uncertainty: 0.2 }
    return { key: 'moderate', label: 'Moderate traffic', multiplier: 1.4, speedKmh: 26, uncertainty: 0.15 }
  }

  if (hour < 5) return { key: 'light', label: 'Light traffic', multiplier: 1.16, speedKmh: 36, uncertainty: 0.12 }
  if (hour < 6.5) return { key: 'building', label: 'Traffic building', multiplier: 1.55, speedKmh: 24, uncertainty: 0.16 }
  if (hour < 10.5) return { key: 'rush', label: 'Morning rush', multiplier: 2.55, speedKmh: 15, uncertainty: 0.23 }
  if (hour < 15.5) return { key: 'busy', label: 'Daytime traffic', multiplier: 2.05, speedKmh: 19, uncertainty: 0.19 }
  if (hour < 17) return { key: 'heavy', label: 'Afternoon traffic', multiplier: 2.3, speedKmh: 16, uncertainty: 0.21 }
  if (hour < 21) return { key: 'rush', label: 'Evening rush', multiplier: 2.7, speedKmh: 14, uncertainty: 0.24 }
  if (hour < 23) return { key: 'busy', label: 'Late traffic', multiplier: 1.72, speedKmh: 23, uncertainty: 0.16 }
  return { key: 'light', label: 'Light traffic', multiplier: 1.25, speedKmh: 31, uncertainty: 0.13 }
}

export function getGeneralTrafficProfile(date = new Date()) {
  const hour = decimalHour(date)
  const weekend = date.getDay() === 0 || date.getDay() === 6

  if (weekend) {
    if (hour >= 11 && hour < 20) return { key: 'moderate', label: 'Typical traffic', multiplier: 1.3, speedKmh: 33, uncertainty: 0.15 }
    return { key: 'light', label: 'Light traffic', multiplier: 1.12, speedKmh: 42, uncertainty: 0.12 }
  }

  if ((hour >= 6.5 && hour < 10) || (hour >= 16 && hour < 20.5)) {
    return { key: 'busy', label: 'Rush-hour traffic', multiplier: 1.58, speedKmh: 27, uncertainty: 0.18 }
  }

  if (hour >= 10 && hour < 16) {
    return { key: 'moderate', label: 'Typical traffic', multiplier: 1.28, speedKmh: 35, uncertainty: 0.14 }
  }

  return { key: 'light', label: 'Light traffic', multiplier: 1.1, speedKmh: 43, uncertainty: 0.11 }
}

export function getTrafficProfile(from, to, date = new Date()) {
  return inLagosArea(from) && inLagosArea(to)
    ? getLagosTrafficProfile(date)
    : getGeneralTrafficProfile(date)
}

export function estimateLegDuration({
  baseSeconds,
  distanceMeters,
  from,
  to,
  departureTime = new Date(),
  vehicleId = 'motorcycle',
}) {
  if (!Number.isFinite(baseSeconds) || baseSeconds <= 0) {
    return { duration: baseSeconds || 0, profile: getTrafficProfile(from, to, departureTime) }
  }

  const vehicle = getVehicleProfile(vehicleId)
  const traffic = getTrafficProfile(from, to, departureTime)
  const distanceKm = Math.max(0, Number(distanceMeters || 0) / 1000)

  const congestionMultiplier = 1 + ((traffic.multiplier - 1) * vehicle.congestionFactor)
  const multiplied = baseSeconds * congestionMultiplier / vehicle.speedFactor
  const effectiveSpeed = Math.max(8, traffic.speedKmh * vehicle.speedFactor)
  const speedFloor = distanceKm > 0 ? (distanceKm / effectiveSpeed) * 3600 : 0
  const junctionBuffer = Math.min(8 * 60, vehicle.serviceBufferSeconds + distanceKm * 10)

  return {
    duration: Math.round(Math.max(multiplied, speedFloor) + junctionBuffer),
    profile: traffic,
    effectiveSpeed,
    congestionMultiplier,
  }
}

export function adjustMatrix({
  durations,
  distances,
  points,
  vehicleId,
  departureTime = new Date(),
}) {
  return durations.map((row, fromIndex) =>
    row.map((baseSeconds, toIndex) => {
      if (fromIndex === toIndex || baseSeconds == null) return baseSeconds
      const from = points[fromIndex]
      const to = points[toIndex]
      if (!from || !to) return baseSeconds
      return estimateLegDuration({
        baseSeconds,
        distanceMeters: distances?.[fromIndex]?.[toIndex] || 0,
        from,
        to,
        departureTime,
        vehicleId,
      }).duration
    }),
  )
}

export function adjustRoute({
  route,
  points,
  vehicleId,
  departureTime = new Date(),
}) {
  let cursor = new Date(departureTime)
  let dominantProfile = null

  const legs = (route.legs || []).map((leg, index) => {
    const from = points[index]
    const to = points[index + 1]
    if (!from || !to) return leg

    const estimate = estimateLegDuration({
      baseSeconds: leg.duration,
      distanceMeters: leg.distance,
      from,
      to,
      departureTime: cursor,
      vehicleId,
    })

    dominantProfile = !dominantProfile || estimate.profile.multiplier > dominantProfile.multiplier
      ? estimate.profile
      : dominantProfile

    const adjusted = {
      ...leg,
      freeFlowDuration: leg.duration,
      duration: estimate.duration,
      trafficLabel: estimate.profile.label,
      trafficKey: estimate.profile.key,
      trafficMultiplier: estimate.congestionMultiplier,
      modeledSpeedKmh: estimate.effectiveSpeed,
    }

    cursor = new Date(cursor.getTime() + estimate.duration * 1000)
    return adjusted
  })

  const duration = legs.reduce((total, leg) => total + (leg.duration || 0), 0)
  const uncertainty = dominantProfile?.uncertainty || 0.15

  return {
    ...route,
    legs,
    duration,
    freeFlowDuration: route.duration,
    trafficSource: 'modeled',
    trafficLabel: dominantProfile?.label || 'Traffic adjusted',
    trafficKey: dominantProfile?.key || 'moderate',
    etaRange: {
      min: Math.round(duration * (1 - uncertainty)),
      max: Math.round(duration * (1 + uncertainty)),
    },
  }
}

export function buildEtaRange(duration, source = 'modeled') {
  const uncertainty = source === 'live' ? 0.1 : 0.18
  return {
    min: Math.max(0, Math.round(duration * (1 - uncertainty))),
    max: Math.round(duration * (1 + uncertainty)),
  }
}
