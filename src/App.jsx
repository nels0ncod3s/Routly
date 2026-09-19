import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from 'react-leaflet'
import L from 'leaflet'
import {
  ArrowRight,
  Bike,
  Bookmark,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  Fuel,
  GripVertical,
  History,
  LocateFixed,
  MapPin,
  Navigation,
  Plus,
  RotateCcw,
  Route,
  Search,
  Sparkles,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { getRoadRoute, getTravelTable } from './lib/routing.js'
import { getVehicleProfile, VEHICLE_OPTIONS } from './lib/vehicles.js'
import {
  addRouteHistory,
  clearRouteHistory,
  deleteRouteHistory,
  loadRouteHistory,
  toggleSavedRoute,
} from './lib/history.js'

const LAGOS_CENTER = [6.5244, 3.3792]
const MAX_STOPS = 10
const SEARCH_RESULT_LIMIT = 10

const exampleLocations = {
  start: {
    id: 'origin',
    label: 'Yaba, Lagos',
    displayName: 'Yaba, Lagos, Nigeria',
    lat: 6.5095,
    lon: 3.3711,
  },
  stops: [
    { id: 'stop-1', label: 'Ikeja GRA', displayName: 'Ikeja GRA, Lagos, Nigeria', lat: 6.5786, lon: 3.3515 },
    { id: 'stop-2', label: 'Surulere', displayName: 'Surulere, Lagos, Nigeria', lat: 6.5008, lon: 3.3582 },
    { id: 'stop-3', label: 'Victoria Island', displayName: 'Victoria Island, Lagos, Nigeria', lat: 6.4281, lon: 3.4219 },
    { id: 'stop-4', label: 'Lekki Phase 1', displayName: 'Lekki Phase 1, Lagos, Nigeria', lat: 6.4474, lon: 3.4723 },
  ],
}

const formatDuration = (seconds = 0) => {
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`
}

const formatDistance = (meters = 0) => {
  const km = meters / 1000
  return km < 1 ? `${Math.round(meters)} m` : `${km.toFixed(km >= 10 ? 1 : 2)} km`
}

const formatDate = (value) => {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Unknown date'
  return new Intl.DateTimeFormat('en-NG', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

const makePin = (label, active = false) =>
  L.divIcon({
    className: 'route-pin-shell',
    html: `<div class="route-pin ${active ? 'route-pin--origin' : ''}"><span>${label}</span></div>`,
    iconSize: [34, 42],
    iconAnchor: [17, 40],
    popupAnchor: [0, -38],
  })

function MapBounds({ points, routeGeometry }) {
  const map = useMap()

  useEffect(() => {
    const coordinates = routeGeometry?.length
      ? routeGeometry
      : points.map((point) => [point.lat, point.lon])

    if (!coordinates.length) return
    if (coordinates.length === 1) {
      map.flyTo(coordinates[0], 13, { duration: 0.7 })
      return
    }

    map.fitBounds(L.latLngBounds(coordinates), {
      padding: [48, 48],
      maxZoom: 14,
      animate: true,
    })
  }, [map, points, routeGeometry])

  return null
}

const getResultLabel = (result) => {
  const address = result.address || {}
  return (
    result.name ||
    address.road ||
    address.neighbourhood ||
    address.suburb ||
    address.city ||
    address.town ||
    address.village ||
    result.display_name?.split(',')[0] ||
    'Unnamed place'
  )
}

const getResultContext = (result) => {
  const address = result.address || {}
  const parts = [
    address.city || address.town || address.village || address.county,
    address.state,
    address.country,
  ].filter(Boolean)

  return [...new Set(parts)].join(', ') || result.display_name
}

async function searchLocations(query) {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&dedupe=1&limit=${SEARCH_RESULT_LIMIT}&accept-language=en&q=${encodeURIComponent(query)}`,
    { headers: { Accept: 'application/json' } },
  )

  if (!response.ok) throw new Error('Could not search locations right now.')
  const results = await response.json()

  return results
    .map((result) => ({
      id: String(result.place_id),
      label: getResultLabel(result),
      displayName: result.display_name,
      context: getResultContext(result),
      type: result.type || result.category || 'place',
      countryCode: result.address?.country_code?.toUpperCase() || '',
      lat: Number(result.lat),
      lon: Number(result.lon),
    }))
    .sort((a, b) => Number(b.countryCode === 'NG') - Number(a.countryCode === 'NG'))
}

async function reverseGeocode(lat, lon) {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`,
    { headers: { Accept: 'application/json' } },
  )
  if (!response.ok) throw new Error('Unable to identify your current location.')
  const result = await response.json()
  return result.display_name || 'Current location'
}

function routeCost(order, durations) {
  let total = 0
  for (let index = 0; index < order.length - 1; index += 1) {
    const duration = durations?.[order[index]]?.[order[index + 1]]
    if (duration == null || !Number.isFinite(duration)) return Infinity
    total += duration
  }
  return total
}

function optimizeOrder(durations, pointCount) {
  const stopCount = pointCount - 1
  const stateCount = 1 << stopCount
  const dp = Array.from({ length: stateCount }, () => Array(stopCount).fill(Infinity))
  const parent = Array.from({ length: stateCount }, () => Array(stopCount).fill(-1))

  for (let stop = 0; stop < stopCount; stop += 1) {
    dp[1 << stop][stop] = durations?.[0]?.[stop + 1] ?? Infinity
  }

  for (let mask = 1; mask < stateCount; mask += 1) {
    for (let last = 0; last < stopCount; last += 1) {
      if (!(mask & (1 << last)) || !Number.isFinite(dp[mask][last])) continue

      for (let next = 0; next < stopCount; next += 1) {
        if (mask & (1 << next)) continue
        const travelTime = durations?.[last + 1]?.[next + 1]
        if (travelTime == null || !Number.isFinite(travelTime)) continue

        const nextMask = mask | (1 << next)
        const candidate = dp[mask][last] + travelTime
        if (candidate < dp[nextMask][next]) {
          dp[nextMask][next] = candidate
          parent[nextMask][next] = last
        }
      }
    }
  }

  const fullMask = stateCount - 1
  let last = -1
  let bestCost = Infinity

  for (let index = 0; index < stopCount; index += 1) {
    if (dp[fullMask][index] < bestCost) {
      bestCost = dp[fullMask][index]
      last = index
    }
  }

  if (last === -1 || !Number.isFinite(bestCost)) return null

  const reversedStops = []
  let mask = fullMask
  while (last !== -1) {
    reversedStops.push(last + 1)
    const previous = parent[mask][last]
    mask ^= 1 << last
    last = previous
  }

  return [0, ...reversedStops.reverse()]
}

function LocationResults({ results, onSelect, query, isLoading }) {
  if (isLoading) {
    return (
      <div className="location-results location-results--status">
        <span className="spinner spinner--dark" />
        <span>Finding places named “{query}”…</span>
      </div>
    )
  }

  if (!results.length) return null

  return (
    <div className="location-results" role="listbox" aria-label={`Places matching ${query}`}>
      <div className="location-results-head">
        <span>Choose the exact place</span>
        <small>{results.length} matches</small>
      </div>
      <div className="location-results-list">
        {results.map((result) => (
          <button
            className="location-result"
            key={result.id}
            onClick={() => onSelect(result)}
            type="button"
            role="option"
          >
            <span className="location-result-icon"><MapPin size={14} /></span>
            <span className="location-result-copy">
              <strong>{result.label}</strong>
              <small>{result.context}</small>
              <em>{result.displayName}</em>
            </span>
            {result.countryCode && <span className="country-code">{result.countryCode}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

function App() {
  const [originInput, setOriginInput] = useState('')
  const [origin, setOrigin] = useState(null)
  const [originResults, setOriginResults] = useState([])
  const [stopInput, setStopInput] = useState('')
  const [stopResults, setStopResults] = useState([])
  const [stops, setStops] = useState([])
  const [optimizedStops, setOptimizedStops] = useState([])
  const [routeData, setRouteData] = useState(null)
  const [baselineSeconds, setBaselineSeconds] = useState(0)
  const [baselineDistance, setBaselineDistance] = useState(0)
  const [isSearchingOrigin, setIsSearchingOrigin] = useState(false)
  const [isSearchingStop, setIsSearchingStop] = useState(false)
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [vehicleId, setVehicleId] = useState('motorcycle')
  const [vehicleEfficiency, setVehicleEfficiency] = useState(getVehicleProfile('motorcycle').efficiencyKmpl)
  const [fuelPrice, setFuelPrice] = useState(900)
  const [showSettings, setShowSettings] = useState(false)
  const [routeHistory, setRouteHistory] = useState(() => loadRouteHistory())
  const [historyFilter, setHistoryFilter] = useState('all')
  const [activeHistoryId, setActiveHistoryId] = useState(null)
  const resultRef = useRef(null)

  const vehicle = getVehicleProfile(vehicleId)

  const orderedPoints = useMemo(() => {
    if (!origin) return []
    return [origin, ...(optimizedStops.length ? optimizedStops : stops)]
  }, [origin, stops, optimizedStops])

  const routeGeometry = useMemo(
    () => routeData?.geometry?.coordinates?.map(([lon, lat]) => [lat, lon]) || [],
    [routeData],
  )

  const filteredHistory = useMemo(
    () => historyFilter === 'saved' ? routeHistory.filter((item) => item.saved) : routeHistory,
    [historyFilter, routeHistory],
  )

  const historyStats = useMemo(() => ({
    runs: routeHistory.length,
    savedSeconds: routeHistory.reduce((sum, item) => sum + Number(item.savedSeconds || 0), 0),
    savedDistance: routeHistory.reduce((sum, item) => sum + Number(item.savedDistance || 0), 0),
  }), [routeHistory])

  const activeHistory = routeHistory.find((item) => item.id === activeHistoryId)

  const legs = routeData?.legs || []
  const totalTime = routeData?.duration || 0
  const totalDistance = routeData?.distance || 0
  const savedSeconds = Math.max(0, baselineSeconds - totalTime)
  const savedDistance = Math.max(0, baselineDistance - totalDistance)
  const tripFuelLitres = vehicleEfficiency > 0 ? (totalDistance / 1000) / vehicleEfficiency : 0
  const tripFuelCost = tripFuelLitres * fuelPrice
  const savedFuelLitres = vehicleEfficiency > 0 ? (savedDistance / 1000) / vehicleEfficiency : 0
  const savedFuelCost = savedFuelLitres * fuelPrice
  const savingsPercent = baselineSeconds > 0 && Number.isFinite(baselineSeconds)
    ? Math.max(0, Math.round((savedSeconds / baselineSeconds) * 100))
    : 0

  const clearFeedback = () => {
    setError('')
    setMessage('')
  }

  const resetCalculatedRoute = () => {
    setOptimizedStops([])
    setRouteData(null)
    setBaselineSeconds(0)
    setBaselineDistance(0)
    setActiveHistoryId(null)
  }

  const handleVehicleChange = (nextVehicleId) => {
    const nextVehicle = getVehicleProfile(nextVehicleId)
    setVehicleId(nextVehicleId)
    setVehicleEfficiency(nextVehicle.efficiencyKmpl)
    resetCalculatedRoute()
    clearFeedback()
    setMessage(`${nextVehicle.label} profile selected. Re-optimize to refresh ETA and fuel estimates.`)
  }

  const handleOriginSearch = async () => {
    const query = originInput.trim()
    if (!query) return
    clearFeedback()
    setOriginResults([])
    setIsSearchingOrigin(true)

    try {
      const results = await searchLocations(query)
      setOriginResults(results)
      if (!results.length) setError(`No places named “${query}” were found. Try adding a city, area or street.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setIsSearchingOrigin(false)
    }
  }

  const handleSelectOrigin = (location) => {
    clearFeedback()
    setOrigin({ id: 'origin', ...location })
    setOriginInput('')
    setOriginResults([])
    resetCalculatedRoute()
    setMessage(`Starting point set to ${location.displayName}.`)
  }

  const handleUseCurrentLocation = () => {
    clearFeedback()
    setOriginResults([])
    if (!navigator.geolocation) {
      setError('Geolocation is not supported on this device.')
      return
    }

    setIsSearchingOrigin(true)
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          let displayName = 'Current location'
          try {
            displayName = await reverseGeocode(coords.latitude, coords.longitude)
          } catch {
            // Coordinates are enough to route even if reverse geocoding fails.
          }
          setOrigin({
            id: 'origin',
            label: 'Current location',
            displayName,
            lat: coords.latitude,
            lon: coords.longitude,
          })
          resetCalculatedRoute()
          setMessage('Using your current location as the starting point.')
        } finally {
          setIsSearchingOrigin(false)
        }
      },
      () => {
        setError('Location access was unavailable. Enter your starting point manually.')
        setIsSearchingOrigin(false)
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const handleStopSearch = async () => {
    const query = stopInput.trim()
    if (!query || stops.length >= MAX_STOPS) return
    clearFeedback()
    setStopResults([])
    setIsSearchingStop(true)

    try {
      const results = await searchLocations(query)
      setStopResults(results)
      if (!results.length) setError(`No places named “${query}” were found. Try adding a city, area or street.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setIsSearchingStop(false)
    }
  }

  const handleSelectStop = (location) => {
    clearFeedback()
    setStops((currentStops) => [
      ...currentStops,
      { id: `stop-${Date.now()}-${location.id}`, ...location },
    ])
    resetCalculatedRoute()
    setStopInput('')
    setStopResults([])
    setMessage(`${location.label} added. Add another stop or optimize your route.`)
  }

  const handleRemoveStop = (id) => {
    setStops((currentStops) => currentStops.filter((stop) => stop.id !== id))
    resetCalculatedRoute()
  }

  const handleOptimize = async () => {
    if (!origin || stops.length < 2) {
      setError('Set a starting point and add at least two delivery stops first.')
      return
    }

    clearFeedback()
    setIsOptimizing(true)

    try {
      const departureTime = new Date()
      const points = [origin, ...stops]
      const table = await getTravelTable(points, vehicleId, departureTime)
      const originalOrder = points.map((_, index) => index)
      const bestOrder = optimizeOrder(table.durations, points.length)

      if (!bestOrder) {
        throw new Error('One or more stops could not be connected by a driveable route.')
      }

      const ordered = bestOrder.map((index) => points[index])
      const originalSeconds = routeCost(originalOrder, table.durations)

      let originalDistance = 0
      for (let index = 0; index < originalOrder.length - 1; index += 1) {
        const distance = table.distances?.[originalOrder[index]]?.[originalOrder[index + 1]]
        if (distance != null && Number.isFinite(distance)) originalDistance += distance
      }

      const roadRoute = await getRoadRoute(ordered, vehicleId, departureTime)
      const computedSavedSeconds = Number.isFinite(originalSeconds)
        ? Math.max(0, originalSeconds - roadRoute.duration)
        : 0
      const computedSavedDistance = Math.max(0, originalDistance - roadRoute.distance)
      const historyId = `route-${Date.now()}`

      setBaselineSeconds(Number.isFinite(originalSeconds) ? originalSeconds : roadRoute.duration)
      setBaselineDistance(originalDistance || roadRoute.distance)
      setOptimizedStops(ordered.slice(1))
      setRouteData({
        ...roadRoute,
        matrixProvider: table.provider,
        matrixTrafficSource: table.trafficSource,
      })
      setActiveHistoryId(historyId)

      const entry = {
        id: historyId,
        createdAt: new Date().toISOString(),
        saved: false,
        origin,
        inputStops: stops,
        optimizedStops: ordered.slice(1),
        vehicleId,
        vehicleLabel: vehicle.label,
        totalTime: roadRoute.duration,
        etaRange: roadRoute.etaRange,
        totalDistance: roadRoute.distance,
        baselineSeconds: Number.isFinite(originalSeconds) ? originalSeconds : roadRoute.duration,
        baselineDistance: originalDistance || roadRoute.distance,
        savedSeconds: computedSavedSeconds,
        savedDistance: computedSavedDistance,
        trafficSource: roadRoute.trafficSource || table.trafficSource || 'modeled',
        trafficLabel: roadRoute.trafficLabel || 'Traffic adjusted',
        provider: roadRoute.provider || table.provider || 'Routing provider',
      }

      setRouteHistory((currentHistory) => addRouteHistory(currentHistory, entry))
      setMessage(
        roadRoute.trafficSource === 'live'
          ? 'Route optimized with live traffic data.'
          : 'Route optimized with Routly traffic modeling. Configure the live traffic provider for real-time conditions.',
      )
      window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)
    } catch (err) {
      setError(err.message)
    } finally {
      setIsOptimizing(false)
    }
  }

  const handleLoadExample = () => {
    clearFeedback()
    setOrigin(exampleLocations.start)
    setStops(exampleLocations.stops)
    setOriginResults([])
    setStopResults([])
    resetCalculatedRoute()
    setMessage('Demo stops loaded. Hit optimize to see Routly reorder them.')
  }

  const handleReset = () => {
    setOrigin(null)
    setStops([])
    resetCalculatedRoute()
    setOriginInput('')
    setStopInput('')
    setOriginResults([])
    setStopResults([])
    clearFeedback()
  }

  const handleToggleSaved = (routeId) => {
    setRouteHistory((currentHistory) => toggleSavedRoute(currentHistory, routeId))
  }

  const handleDeleteHistory = (routeId) => {
    setRouteHistory((currentHistory) => deleteRouteHistory(currentHistory, routeId))
    if (activeHistoryId === routeId) setActiveHistoryId(null)
  }

  const handleClearHistory = () => {
    if (!window.confirm('Clear all Routly route history saved on this device?')) return
    setRouteHistory(clearRouteHistory())
    setActiveHistoryId(null)
  }

  const handleRestoreHistory = (entry) => {
    const restoredVehicle = getVehicleProfile(entry.vehicleId)
    setOrigin({ ...entry.origin, id: 'origin' })
    setStops((entry.inputStops || []).map((stop, index) => ({
      ...stop,
      id: stop.id || `restored-stop-${Date.now()}-${index}`,
    })))
    setVehicleId(restoredVehicle.id)
    setVehicleEfficiency(restoredVehicle.efficiencyKmpl)
    setOriginResults([])
    setStopResults([])
    resetCalculatedRoute()
    clearFeedback()
    setMessage('Route loaded from history. Optimize again to refresh current traffic and ETA.')
    window.setTimeout(() => {
      document.querySelector('.workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Routly home">
          <span className="brand-mark"><Route size={19} strokeWidth={2.6} /></span>
          <span>Routly</span>
        </a>
        <div className="topbar-badge"><span></span> Built for last-mile delivery</div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow"><Sparkles size={14} /> Route intelligence for everyday riders</div>
          <h1>Stop riding in circles.<br /><span>Take the smarter route.</span></h1>
          <p>
            Add every delivery drop. Routly reshuffles them into a faster road sequence,
            estimates each leg, and shows how much time, distance and fuel you can save.
          </p>
          <div className="hero-proof">
            <div><strong>01</strong><span>Add your drops</span></div>
            <ArrowRight size={16} />
            <div><strong>02</strong><span>Optimize once</span></div>
            <ArrowRight size={16} />
            <div><strong>03</strong><span>Ride smarter</span></div>
          </div>
        </div>

        <div className="hero-orbit" aria-hidden="true">
          <div className="orbit-card orbit-card--one"><MapPin size={18} /> C</div>
          <div className="orbit-card orbit-card--two"><MapPin size={18} /> A</div>
          <div className="orbit-card orbit-card--three"><MapPin size={18} /> B</div>
          <div className="orbit-bike"><Bike size={34} /></div>
          <svg viewBox="0 0 460 300" className="orbit-line">
            <path d="M55 220C96 88 188 248 240 137C278 57 372 63 412 123" />
          </svg>
          <div className="orbit-caption"><Zap size={15} /> A → B → C becomes C → A → B</div>
        </div>
      </section>

      <section className="workspace">
        <aside className="planner-panel">
          <div className="panel-heading">
            <div>
              <span className="section-kicker">Plan a run</span>
              <h2>Where are you going?</h2>
            </div>
            {(origin || stops.length) && (
              <button className="icon-button" onClick={handleReset} title="Reset route" aria-label="Reset route">
                <RotateCcw size={17} />
              </button>
            )}
          </div>

          <div className="input-section">
            <label className="field-label">Starting point</label>
            {origin ? (
              <div className="selected-location selected-location--origin">
                <span className="location-dot"><Navigation size={14} /></span>
                <div>
                  <strong>{origin.label}</strong>
                  <small>{origin.displayName}</small>
                </div>
                <button onClick={() => { setOrigin(null); resetCalculatedRoute() }} aria-label="Remove starting point"><X size={16} /></button>
              </div>
            ) : (
              <>
                <div className="input-row location-search-row">
                  <div className="text-input-wrap">
                    <Navigation size={17} />
                    <input
                      value={originInput}
                      onChange={(event) => {
                        setOriginInput(event.target.value)
                        setOriginResults([])
                      }}
                      onKeyDown={(event) => event.key === 'Enter' && handleOriginSearch()}
                      placeholder="e.g. Victoria Island"
                      aria-label="Starting point"
                      autoComplete="off"
                    />
                  </div>
                  <button className="compact-button" onClick={handleOriginSearch} disabled={!originInput.trim() || isSearchingOrigin} aria-label="Search starting points">
                    {isSearchingOrigin ? <span className="spinner" /> : <Search size={17} />}
                  </button>
                  <LocationResults results={originResults} onSelect={handleSelectOrigin} query={originInput} isLoading={isSearchingOrigin} />
                </div>
                <p className="search-helper">Search first, then choose the exact city or address from the matches.</p>
                <button className="location-button" onClick={handleUseCurrentLocation} disabled={isSearchingOrigin}>
                  <LocateFixed size={16} /> Use my current location
                </button>
              </>
            )}
          </div>

          <div className="stop-divider"><span>Delivery stops</span><small>{stops.length}/{MAX_STOPS}</small></div>

          <div className="stop-list">
            {stops.map((stop, index) => (
              <div className="stop-item" key={stop.id}>
                <span className="drag-handle" aria-hidden="true"><GripVertical size={17} /></span>
                <span className="stop-number">{index + 1}</span>
                <div className="stop-name">
                  <strong>{stop.label}</strong>
                  <small>{stop.displayName}</small>
                </div>
                <button onClick={() => handleRemoveStop(stop.id)} aria-label={`Remove ${stop.label}`}><Trash2 size={16} /></button>
              </div>
            ))}
          </div>

          {stops.length < MAX_STOPS && (
            <div className="location-search-block">
              <div className="input-row add-stop-row location-search-row">
                <div className="text-input-wrap">
                  <MapPin size={17} />
                  <input
                    value={stopInput}
                    onChange={(event) => {
                      setStopInput(event.target.value)
                      setStopResults([])
                    }}
                    onKeyDown={(event) => event.key === 'Enter' && handleStopSearch()}
                    placeholder="Add a delivery address"
                    aria-label="Delivery stop"
                    autoComplete="off"
                  />
                </div>
                <button className="compact-button" onClick={handleStopSearch} disabled={!stopInput.trim() || isSearchingStop} aria-label="Search delivery stops">
                  {isSearchingStop ? <span className="spinner" /> : <Search size={18} />}
                </button>
                <LocationResults results={stopResults} onSelect={handleSelectStop} query={stopInput} isLoading={isSearchingStop} />
              </div>
              {stopInput && !stopResults.length && !isSearchingStop && (
                <p className="search-helper">Press Enter or the search button, then pick the correct match.</p>
              )}
            </div>
          )}

          {!stops.length && (
            <button className="example-button" onClick={handleLoadExample}>
              <Sparkles size={15} /> Load a Lagos example route
            </button>
          )}

          <div className="vehicle-section">
            <div className="vehicle-section-head">
              <span>Vehicle type</span>
              <small>Changes ETA + fuel assumptions</small>
            </div>
            <div className="vehicle-grid">
              {VEHICLE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`vehicle-option ${vehicleId === option.id ? 'vehicle-option--active' : ''}`}
                  onClick={() => handleVehicleChange(option.id)}
                  aria-pressed={vehicleId === option.id}
                  title={option.description}
                >
                  <strong>{option.label.slice(0, 1)}</strong>
                  <span>{option.shortLabel}</span>
                </button>
              ))}
            </div>
            <p className="vehicle-note">
              {vehicle.description} Routly adjusts congestion response, urban speed and fuel defaults. Van/truck height and weight restrictions are not yet enforced.
            </p>
          </div>

          <div className="fuel-settings">
            <button className="fuel-settings-toggle" onClick={() => setShowSettings((value) => !value)}>
              <span><Fuel size={16} /> Fuel assumptions</span>
              <ChevronDown size={16} className={showSettings ? 'rotate' : ''} />
            </button>
            {showSettings && (
              <div className="fuel-settings-grid">
                <label>
                  <span>Efficiency</span>
                  <div><input type="number" min="1" step="0.1" value={vehicleEfficiency} onChange={(event) => setVehicleEfficiency(Number(event.target.value))} /><small>km/L</small></div>
                </label>
                <label>
                  <span>Fuel price</span>
                  <div><input type="number" min="0" value={fuelPrice} onChange={(event) => setFuelPrice(Number(event.target.value))} /><small>₦/L</small></div>
                </label>
              </div>
            )}
          </div>

          {error && <div className="feedback feedback--error"><CircleAlert size={16} /><span>{error}</span></div>}
          {message && !error && <div className="feedback feedback--success"><Check size={16} /><span>{message}</span></div>}

          <button className="optimize-button" onClick={handleOptimize} disabled={!origin || stops.length < 2 || isOptimizing}>
            {isOptimizing ? <><span className="spinner spinner--dark" /> Checking roads & traffic…</> : <><Zap size={18} fill="currentColor" /> Optimize my route</>}
          </button>
          <p className="planner-hint">
            Routly keeps your start fixed, reorders delivery stops, and refreshes ETA using live traffic when configured. Otherwise it falls back to its time-of-day traffic model.
          </p>
        </aside>

        <div className="map-card">
          <MapContainer center={LAGOS_CENTER} zoom={11} scrollWheelZoom zoomControl className="route-map">
            <TileLayer
              attribution='&copy; OpenStreetMap contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapBounds points={orderedPoints} routeGeometry={routeGeometry} />
            {orderedPoints.map((point, index) => (
              <Marker
                key={point.id}
                position={[point.lat, point.lon]}
                icon={makePin(index === 0 ? 'S' : index, index === 0)}
              >
                <Popup>
                  <strong>{index === 0 ? 'Start' : `Stop ${index}`}: {point.label}</strong><br />
                  <span>{point.displayName}</span>
                </Popup>
              </Marker>
            ))}
            {routeGeometry.length > 0 && (
              <>
                <Polyline positions={routeGeometry} pathOptions={{ color: '#b7ff5a', weight: 8, opacity: 0.32 }} />
                <Polyline positions={routeGeometry} pathOptions={{ color: '#173c2c', weight: 4, opacity: 0.95 }} />
              </>
            )}
          </MapContainer>

          {!orderedPoints.length && (
            <div className="map-empty-overlay">
              <span className="map-empty-icon"><Navigation size={24} /></span>
              <strong>Your route will live here</strong>
              <p>Add a start and delivery stops to put the map to work.</p>
            </div>
          )}

          <div className="map-chip map-chip--top"><span className="status-dot"></span> Road map</div>
          <div className="map-chip map-chip--bottom"><MapPin size={14} /> {orderedPoints.length ? `${Math.max(0, orderedPoints.length - 1)} stops` : 'Lagos, Nigeria'}</div>
        </div>
      </section>

      <section className={`results ${routeData ? 'results--visible' : ''}`} ref={resultRef}>
        <div className="results-heading">
          <div>
            <span className="section-kicker">Optimized run</span>
            <h2>Your traffic-aware delivery sequence</h2>
          </div>
          {savingsPercent > 0 && <div className="savings-pill"><Zap size={15} /> {savingsPercent}% faster than entered order</div>}
        </div>

        {routeData && (
          <>
            <div className="route-meta-row">
              <span className={`route-meta-chip route-meta-chip--${routeData.trafficSource === 'live' ? 'live' : 'modeled'}`}>
                <span className="traffic-dot" />
                {routeData.trafficSource === 'live' ? 'Live traffic' : 'Modeled traffic'}
              </span>
              <span className="route-meta-chip">{routeData.trafficLabel || 'Traffic adjusted'}</span>
              <span className="route-meta-chip">{vehicle.label}</span>
              <span className="route-meta-chip">{routeData.provider || 'Routing provider'}</span>
            </div>

            <div className="results-actions">
              {activeHistoryId && (
                <button
                  className={`save-route-button ${activeHistory?.saved ? 'save-route-button--active' : ''}`}
                  onClick={() => handleToggleSaved(activeHistoryId)}
                >
                  <Bookmark size={15} fill={activeHistory?.saved ? 'currentColor' : 'none'} />
                  {activeHistory?.saved ? 'Saved route' : 'Save route'}
                </button>
              )}
            </div>
          </>
        )}

        <div className="metrics-grid">
          <article className="metric-card metric-card--accent">
            <span className="metric-icon"><Clock3 size={19} /></span>
            <small>Traffic-adjusted ETA</small>
            <strong>{formatDuration(totalTime)}</strong>
            <p>
              {routeData?.etaRange
                ? `Likely ${formatDuration(routeData.etaRange.min)} – ${formatDuration(routeData.etaRange.max)}`
                : savedSeconds > 0 ? `${formatDuration(savedSeconds)} saved` : 'Best road sequence found'}
            </p>
          </article>
          <article className="metric-card">
            <span className="metric-icon"><Route size={19} /></span>
            <small>Total distance</small>
            <strong>{formatDistance(totalDistance)}</strong>
            <p>{savedDistance > 50 ? `${formatDistance(savedDistance)} less riding` : 'Road distance'}</p>
          </article>
          <article className="metric-card">
            <span className="metric-icon"><Fuel size={19} /></span>
            <small>Estimated {vehicle.shortLabel.toLowerCase()} fuel</small>
            <strong>{tripFuelLitres > 0 ? `${tripFuelLitres.toFixed(2)} L` : '—'}</strong>
            <p>
              {tripFuelCost > 0
                ? `≈ ₦${Math.round(tripFuelCost).toLocaleString()}${savedFuelCost > 0 ? ` • ₦${Math.round(savedFuelCost).toLocaleString()} saved` : ''}`
                : 'Based on your fuel assumptions'}
            </p>
          </article>
        </div>

        <div className="route-breakdown">
          <div className="route-breakdown-head">
            <h3>Trip breakdown</h3>
            <span>{legs.length} legs</span>
          </div>

          <div className="timeline">
            {orderedPoints.map((point, index) => (
              <div className="timeline-row" key={`${point.id}-route`}>
                <div className="timeline-rail">
                  <span className={index === 0 ? 'timeline-node timeline-node--start' : 'timeline-node'}>{index === 0 ? <Navigation size={13} /> : index}</span>
                  {index < orderedPoints.length - 1 && <span className="timeline-line" />}
                </div>
                <div className="timeline-place">
                  <small>{index === 0 ? 'START' : `DROP ${index}`}</small>
                  <strong>{point.label}</strong>
                  <p>{point.displayName}</p>
                </div>
                {index < legs.length && (
                  <div className="leg-stat">
                    <strong>{formatDuration(legs[index].duration)}</strong>
                    <span>{formatDistance(legs[index].distance)}</span>
                    {legs[index].trafficLabel && <span>{legs[index].trafficLabel}</span>}
                  </div>
                )}
                {index === orderedPoints.length - 1 && <span className="done-badge"><Check size={14} /> Done</span>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="history-section" id="history">
        <div className="history-shell">
          <div className="history-heading">
            <div>
              <span className="section-kicker">Route history</span>
              <h2>Runs this device remembers.</h2>
            </div>
            <div className="history-stats">
              <div className="history-stat"><strong>{historyStats.runs}</strong><small>optimized runs</small></div>
              <div className="history-stat"><strong>{historyStats.savedSeconds ? formatDuration(historyStats.savedSeconds) : '—'}</strong><small>estimated time saved</small></div>
              <div className="history-stat"><strong>{historyStats.savedDistance ? formatDistance(historyStats.savedDistance) : '—'}</strong><small>estimated distance saved</small></div>
            </div>
          </div>

          <div className="history-toolbar">
            <div className="history-tabs">
              <button className={`history-tab ${historyFilter === 'all' ? 'history-tab--active' : ''}`} onClick={() => setHistoryFilter('all')}>
                <History size={13} /> All runs
              </button>
              <button className={`history-tab ${historyFilter === 'saved' ? 'history-tab--active' : ''}`} onClick={() => setHistoryFilter('saved')}>
                <Bookmark size={13} /> Saved
              </button>
            </div>
            {routeHistory.length > 0 && <button className="history-clear" onClick={handleClearHistory}>Clear history</button>}
          </div>

          <div className="history-list">
            {filteredHistory.length ? filteredHistory.map((entry) => {
              const historyVehicle = getVehicleProfile(entry.vehicleId)
              const routeNames = [
                entry.origin?.label,
                ...(entry.optimizedStops || []).map((stop) => stop.label),
              ].filter(Boolean)

              return (
                <article className="history-card" key={entry.id}>
                  <div className="history-card-main">
                    <div className="history-card-top">
                      <strong>{formatDate(entry.createdAt)}</strong>
                      <span className="history-vehicle">{historyVehicle.shortLabel}</span>
                      <span className={`history-source ${entry.trafficSource === 'live' ? 'history-source--live' : ''}`}>
                        {entry.trafficSource === 'live' ? 'Live traffic' : 'Modeled traffic'}
                      </span>
                      {entry.saved && <span className="history-saved">Saved</span>}
                    </div>
                    <p className="history-route">{routeNames.join(' → ')}</p>
                    <div className="history-card-metrics">
                      <span>{formatDuration(entry.totalTime)}</span>
                      <span>{formatDistance(entry.totalDistance)}</span>
                      <span>{(entry.optimizedStops || []).length} stops</span>
                      {entry.savedSeconds > 0 && <span>{formatDuration(entry.savedSeconds)} saved</span>}
                    </div>
                  </div>
                  <div className="history-card-actions">
                    <button title="Load this route" aria-label="Load this route" onClick={() => handleRestoreHistory(entry)}>
                      <RotateCcw size={15} />
                    </button>
                    <button title={entry.saved ? 'Remove from saved' : 'Save route'} aria-label={entry.saved ? 'Remove from saved' : 'Save route'} onClick={() => handleToggleSaved(entry.id)}>
                      <Bookmark size={15} fill={entry.saved ? 'currentColor' : 'none'} />
                    </button>
                    <button title="Delete from history" aria-label="Delete from history" onClick={() => handleDeleteHistory(entry.id)}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </article>
              )
            }) : (
              <div className="history-empty">
                <div>
                  <strong>{historyFilter === 'saved' ? 'No saved routes yet.' : 'No optimized runs yet.'}</strong>
                  <p>{historyFilter === 'saved' ? 'Bookmark a useful route after optimizing it.' : 'Your optimized runs will appear here automatically.'}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="why-routly">
        <div>
          <span className="section-kicker">Why it matters</span>
          <h2>Four drops shouldn’t feel like eight.</h2>
        </div>
        <p>
          Riders usually receive stops in whatever order they were entered. Routly compares road travel time between them,
          factors in traffic and the selected vehicle, then gives the rider one clearer run. Less backtracking. Less fuel burned. Less Lagos-induced suffering.
        </p>
      </section>

      <footer>
        <a className="brand brand--footer" href="#top"><span className="brand-mark"><Route size={18} /></span><span>Routly</span></a>
        <p>Smarter multi-stop routing for delivery riders and small fleets.</p>
        <span>Traffic-aware routing with OpenStreetMap fallback.</span>
      </footer>
    </main>
  )
}

export default App
