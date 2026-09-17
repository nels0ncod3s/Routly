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
  Sparkles,
  Trash2,
  X,
  Zap,
} from 'lucide-react'

const LAGOS_CENTER = [6.5244, 3.3792]
const MAX_STOPS = 10

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

async function geocodeLocation(query) {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=ng&q=${encodeURIComponent(query)}`,
    {
      headers: {
        Accept: 'application/json',
      },
    },
  )

  if (!response.ok) throw new Error('Could not search that location right now.')
  const [result] = await response.json()
  if (!result) throw new Error(`We couldn't find “${query}”. Try a more specific Lagos address.`)

  return {
    label: query.trim(),
    displayName: result.display_name,
    lat: Number(result.lat),
    lon: Number(result.lon),
  }
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

function App() {
  const [originInput, setOriginInput] = useState('')
  const [origin, setOrigin] = useState(null)
  const [stopInput, setStopInput] = useState('')
  const [stops, setStops] = useState([])
  const [optimizedStops, setOptimizedStops] = useState([])
  const [routeData, setRouteData] = useState(null)
  const [baselineSeconds, setBaselineSeconds] = useState(0)
  const [baselineDistance, setBaselineDistance] = useState(0)
  const [isSearchingOrigin, setIsSearchingOrigin] = useState(false)
  const [isAddingStop, setIsAddingStop] = useState(false)
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

  const handleSetOrigin = async () => {
    if (!originInput.trim()) return
    clearFeedback()
    setIsSearchingOrigin(true)
    try {
      const location = await geocodeLocation(originInput)
      setOrigin({ id: 'origin', ...location })
      resetCalculatedRoute()
      setOriginInput('')
      setMessage('Starting point set.')
    } catch (err) {
      setError(err.message)
    } finally {
      setIsSearchingOrigin(false)
    }
  }

  const handleUseCurrentLocation = () => {
    clearFeedback()
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

  const handleAddStop = async () => {
    if (!stopInput.trim() || stops.length >= MAX_STOPS) return
    clearFeedback()
    setIsAddingStop(true)
    try {
      const location = await geocodeLocation(stopInput)
      setStops((current) => [
        ...current,
        { id: `stop-${Date.now()}`, ...location },
      ])
      resetCalculatedRoute()
      setStopInput('')
      setMessage('Stop added. Add another or optimize your route.')
    } catch (err) {
      setError(err.message)
    } finally {
      setIsAddingStop(false)
    }
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
                <div className="input-row">
                  <div className="text-input-wrap">
                    <Navigation size={17} />
                    <input
                      value={originInput}
                      onChange={(event) => setOriginInput(event.target.value)}
                      onKeyDown={(event) => event.key === 'Enter' && handleSetOrigin()}
                      placeholder="e.g. Yaba, Lagos"
                      aria-label="Starting point"
                    />
                  </div>
                  <button className="compact-button" onClick={handleSetOrigin} disabled={!originInput.trim() || isSearchingOrigin}>
                    {isSearchingOrigin ? <span className="spinner" /> : <Check size={17} />}
                  </button>
                </div>
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
            <div className="input-row add-stop-row">
              <div className="text-input-wrap">
                <MapPin size={17} />
                <input
                  value={stopInput}
                  onChange={(event) => setStopInput(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && handleAddStop()}
                  placeholder="Add a delivery address"
                  aria-label="Delivery stop"
                />
              </div>
              <button className="compact-button" onClick={handleAddStop} disabled={!stopInput.trim() || isAddingStop}>
                {isAddingStop ? <span className="spinner" /> : <Plus size={18} />}
              </button>
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
