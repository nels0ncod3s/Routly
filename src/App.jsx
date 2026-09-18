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
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  Fuel,
  GripVertical,
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

async function getTravelTable(points) {
  const coords = points.map((point) => `${point.lon},${point.lat}`).join(';')
  const response = await fetch(
    `https://router.project-osrm.org/table/v1/driving/${coords}?annotations=duration,distance`,
  )
  if (!response.ok) throw new Error('The routing service is unavailable. Try again in a moment.')
  const data = await response.json()
  if (data.code !== 'Ok') throw new Error('Could not calculate a road matrix for these locations.')
  return data
}

async function getRoadRoute(points) {
  const coords = points.map((point) => `${point.lon},${point.lat}`).join(';')
  const response = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`,
  )
  if (!response.ok) throw new Error('Could not draw the road route right now.')
  const data = await response.json()
  if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error('No driveable route was found between those stops.')
  return data.routes[0]
}

function routeCost(order, durations) {
  let total = 0
  for (let index = 0; index < order.length - 1; index += 1) {
    total += durations[order[index]][order[index + 1]] || Number.MAX_SAFE_INTEGER / 10
  }
  return total
}

function optimizeOrder(durations, pointCount) {
  const stopCount = pointCount - 1
  const stateCount = 1 << stopCount
  const dp = Array.from({ length: stateCount }, () => Array(stopCount).fill(Infinity))
  const parent = Array.from({ length: stateCount }, () => Array(stopCount).fill(-1))

  for (let stop = 0; stop < stopCount; stop += 1) {
    dp[1 << stop][stop] = durations[0][stop + 1] ?? Infinity
  }

  for (let mask = 1; mask < stateCount; mask += 1) {
    for (let last = 0; last < stopCount; last += 1) {
      if (!(mask & (1 << last)) || !Number.isFinite(dp[mask][last])) continue

      for (let next = 0; next < stopCount; next += 1) {
        if (mask & (1 << next)) continue
        const travelTime = durations[last + 1][next + 1]
        if (travelTime == null) continue

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
  let last = 0
  for (let index = 1; index < stopCount; index += 1) {
    if (dp[fullMask][index] < dp[fullMask][last]) last = index
  }

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
  const [vehicleEfficiency, setVehicleEfficiency] = useState(35)
  const [fuelPrice, setFuelPrice] = useState(900)
  const [showSettings, setShowSettings] = useState(false)
  const resultRef = useRef(null)

  const orderedPoints = useMemo(() => {
    if (!origin) return []
    return [origin, ...(optimizedStops.length ? optimizedStops : stops)]
  }, [origin, stops, optimizedStops])

  const routeGeometry = useMemo(
    () => routeData?.geometry?.coordinates?.map(([lon, lat]) => [lat, lon]) || [],
    [routeData],
  )

  const legs = routeData?.legs || []
  const totalTime = routeData?.duration || 0
  const totalDistance = routeData?.distance || 0
  const savedSeconds = Math.max(0, baselineSeconds - totalTime)
  const savedDistance = Math.max(0, baselineDistance - totalDistance)
  const savedFuelLitres = vehicleEfficiency > 0 ? (savedDistance / 1000) / vehicleEfficiency : 0
  const savedFuelCost = savedFuelLitres * fuelPrice
  const savingsPercent = baselineSeconds > 0 ? Math.round((savedSeconds / baselineSeconds) * 100) : 0

  const clearFeedback = () => {
    setError('')
    setMessage('')
  }

  const resetCalculatedRoute = () => {
    setOptimizedStops([])
    setRouteData(null)
    setBaselineSeconds(0)
    setBaselineDistance(0)
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
    setStops((current) => [
      ...current,
      { id: `stop-${Date.now()}-${location.id}`, ...location },
    ])
    resetCalculatedRoute()
    setStopInput('')
    setStopResults([])
    setMessage(`${location.label} added. Add another stop or optimize your route.`)
  }

  const handleRemoveStop = (id) => {
    setStops((current) => current.filter((stop) => stop.id !== id))
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
      const points = [origin, ...stops]
      const table = await getTravelTable(points)
      const originalOrder = points.map((_, index) => index)
      const bestOrder = optimizeOrder(table.durations, points.length)
      const ordered = bestOrder.map((index) => points[index])

      const originalSeconds = routeCost(originalOrder, table.durations)
      let originalDistance = 0
      for (let index = 0; index < originalOrder.length - 1; index += 1) {
        originalDistance += table.distances[originalOrder[index]][originalOrder[index + 1]] || 0
      }

      const roadRoute = await getRoadRoute(ordered)
      setBaselineSeconds(originalSeconds)
      setBaselineDistance(originalDistance)
      setOptimizedStops(ordered.slice(1))
      setRouteData(roadRoute)
      setMessage('Route optimized. The order below is your new delivery sequence.')
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
    setOptimizedStops([])
    setRouteData(null)
    setBaselineSeconds(0)
    setBaselineDistance(0)
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Routly home">
          <span className="brand-mark"><Route size={19} strokeWidth={2.6} /></span>
          <span>Routly</span>
        </a>
        <div className="topbar-badge"><span></span> Built for last-mile delivery</div>
      </header>

      <section className="hero" id="top" aria-labelledby="hero-title">
        <div className="hero-main">
          <div className="hero-copy">
            <div className="eyebrow"><span className="hero-status" /> LESS BACKTRACKING. MORE DELIVERING.</div>
            <h1 id="hero-title">Every stop.<br />One <span>smarter</span><br />route.</h1>
            <p>Your drops, in the right order. Plan a faster delivery run with clear trip estimates and a little more fuel left in the tank.</p>
            <div className="hero-actions">
              <a className="hero-primary" href="#planner">Plan my route <ArrowRight size={19} /></a>
              <button className="hero-secondary" onClick={() => {
                handleLoadExample()
                document.getElementById('planner')?.focus({ preventScroll: true })
                document.getElementById('planner')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
              }}>Try a Lagos example <ArrowRight size={16} /></button>
            </div>
            <div className="hero-note"><Check size={14} /> Up to 10 stops <span>·</span> No sign-up needed</div>
          </div>

          <div className="route-preview" role="img" aria-label="Illustration: a route connects a starting point to four delivery stops in a more efficient order. Actual routes and savings are calculated in the planner.">
            <div className="preview-heading"><span><Route size={17} /> THE BETTER WAY AROUND</span><span className="preview-demo">Illustration</span></div>
            <div className="preview-map" aria-hidden="true">
              <svg viewBox="0 0 560 360" className="preview-map-art">
                <defs>
                  <pattern id="street-grid" width="56" height="56" patternTransform="rotate(-18)" patternUnits="userSpaceOnUse"><path d="M0 0H56V56" fill="none" stroke="#294236" strokeWidth="1" /></pattern>
                </defs>
                <rect width="560" height="360" fill="url(#street-grid)" />
                <path d="M480 -20C365 60 460 120 390 190S380 315 290 380" stroke="#213e30" strokeWidth="60" fill="none" />
                <path d="M-20 275L580 75M90 -20L200 380M-20 100L580 280" stroke="#304a3a" strokeWidth="9" fill="none" />
                <path d="M80 258L182 81L455 129L275 246L350 62" className="preview-old-route" />
                <path d="M80 258L133 240Q149 235 156 213L182 81L316 57Q341 51 350 62L455 129L402 175L275 246" className="preview-new-route" />
                <g className="preview-start"><circle cx="80" cy="258" r="21" /><path d="M72 263L80 249L88 263L80 260Z" /></g>
                {[[182, 81, '1'], [350, 62, '2'], [455, 129, '3'], [275, 246, '4']].map(([x, y, label]) => (
                  <g className="preview-stop" key={label}><circle cx={x} cy={y} r="19" /><text x={x} y={y} dy=".35em" textAnchor="middle">{label}</text></g>
                ))}
                <text x="48" y="303" className="preview-map-label">START HERE</text>
                <text x="254" y="292" className="preview-map-label">LAST DROP</text>
              </svg>
              <div className="preview-map-key"><span /> Smarter order <span /> Entered order</div>
            </div>
            <div className="preview-summary">
              <span className="preview-summary-icon"><Check size={21} /></span>
              <div><strong>Same stops. Better sequence.</strong><p>A clear plan from your first drop to your last.</p></div>
              <ArrowRight size={20} />
            </div>
          </div>
        </div>
        <div className="hero-features" aria-label="Route planning features">
          <div><Route size={20} /><span><strong>A better stop order</strong><small>Less doubling back</small></span></div>
          <div><Clock3 size={20} /><span><strong>Know your trip time</strong><small>Estimates for every leg</small></span></div>
          <div><Fuel size={20} /><span><strong>See your fuel savings</strong><small>Compare before you ride</small></span></div>
          <a href="#planner">Your next run starts here <ArrowRight size={18} /></a>
        </div>
      </section>

      <section className="workspace" id="planner" tabIndex={-1} aria-label="Route planner">
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

          <div className="fuel-settings">
            <button className="fuel-settings-toggle" onClick={() => setShowSettings((value) => !value)}>
              <span><Fuel size={16} /> Fuel assumptions</span>
              <ChevronDown size={16} className={showSettings ? 'rotate' : ''} />
            </button>
            {showSettings && (
              <div className="fuel-settings-grid">
                <label>
                  <span>Efficiency</span>
                  <div><input type="number" min="1" value={vehicleEfficiency} onChange={(event) => setVehicleEfficiency(Number(event.target.value))} /><small>km/L</small></div>
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
            {isOptimizing ? <><span className="spinner spinner--dark" /> Finding your best route…</> : <><Zap size={18} fill="currentColor" /> Optimize my route</>}
          </button>
          <p className="planner-hint">Routly keeps your start fixed and reorders the delivery stops after it.</p>
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

          <div className="map-chip map-chip--top"><span className="status-dot"></span> Live road map</div>
          <div className="map-chip map-chip--bottom"><MapPin size={14} /> {orderedPoints.length ? `${Math.max(0, orderedPoints.length - 1)} stops` : 'Lagos, Nigeria'}</div>
        </div>
      </section>

      <section className={`results ${routeData ? 'results--visible' : ''}`} ref={resultRef}>
        <div className="results-heading">
          <div>
            <span className="section-kicker">Optimized run</span>
            <h2>Your fastest delivery sequence</h2>
          </div>
          {savingsPercent > 0 && <div className="savings-pill"><Zap size={15} /> {savingsPercent}% faster than entered order</div>}
        </div>

        <div className="metrics-grid">
          <article className="metric-card metric-card--accent">
            <span className="metric-icon"><Clock3 size={19} /></span>
            <small>Total trip time</small>
            <strong>{formatDuration(totalTime)}</strong>
            <p>{savedSeconds > 0 ? `${formatDuration(savedSeconds)} saved` : 'Best road sequence found'}</p>
          </article>
          <article className="metric-card">
            <span className="metric-icon"><Route size={19} /></span>
            <small>Total distance</small>
            <strong>{formatDistance(totalDistance)}</strong>
            <p>{savedDistance > 50 ? `${formatDistance(savedDistance)} less riding` : 'Road distance'}</p>
          </article>
          <article className="metric-card">
            <span className="metric-icon"><Fuel size={19} /></span>
            <small>Estimated fuel saved</small>
            <strong>{savedFuelLitres > 0 ? `${savedFuelLitres.toFixed(2)} L` : '—'}</strong>
            <p>{savedFuelCost > 0 ? `≈ ₦${Math.round(savedFuelCost).toLocaleString()} saved` : 'Based on your assumptions'}</p>
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
                  </div>
                )}
                {index === orderedPoints.length - 1 && <span className="done-badge"><Check size={14} /> Done</span>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="why-routly">
        <div>
          <span className="section-kicker">Why it matters</span>
          <h2>Four drops shouldn’t feel like eight.</h2>
        </div>
        <p>
          Riders usually receive stops in whatever order they were entered. Routly compares the road travel time between them,
          reorders the sequence, and gives the rider one clearer run. Less backtracking. Less fuel burned. Less Lagos-induced suffering.
        </p>
      </section>

      <footer>
        <a className="brand brand--footer" href="#top"><span className="brand-mark"><Route size={18} /></span><span>Routly</span></a>
        <p>Smarter multi-stop routing for delivery riders and small fleets.</p>
        <span>Built around OpenStreetMap road data.</span>
      </footer>
    </main>
  )
}

export default App