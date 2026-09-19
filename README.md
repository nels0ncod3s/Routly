# Routly

Routly is a multi-stop delivery route planner for riders and small delivery teams. Add a starting point and multiple delivery drops, choose the vehicle being used, and Routly reorders the stops to reduce travel time, distance and unnecessary fuel use.

## Current features

- React + Vite, written in JSX
- OpenStreetMap + Leaflet interactive map
- OpenStreetMap Nominatim location search with exact-place selection
- Fixed-start route optimization for up to 10 delivery stops
- Traffic-aware ETA with a live-provider-first architecture
- Google Routes live traffic support through server-side API routes
- Explicit Routly Lagos traffic model as a fallback when live traffic is unavailable
- ETA ranges instead of pretending traffic has single-minute precision
- Motorcycle, car, van and truck profiles
- Vehicle-specific congestion, speed and fuel assumptions
- Per-leg ETA, traffic state and distance
- Total trip time, distance and estimated fuel cost
- Current-location support
- Route history stored on the current device
- Save/bookmark useful routes
- Restore a historical route and re-optimize it with fresh traffic conditions
- Aggregate estimated time and distance savings
- Lagos demo route
- Responsive mobile UI
- Custom SVG favicon

## Run locally

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

## Live traffic setup

Routly can use Google Routes for traffic-aware route matrices and final route ETAs.

The API key stays server-side. Add this environment variable to the deployment:

```bash
GOOGLE_MAPS_API_KEY=your_google_maps_platform_key
```

The key needs access to the Google Maps Platform Routes API.

When deployed on Vercel, the serverless functions in `/api` expose:

- `POST /api/route-matrix` for the traffic-aware origin/destination matrix used by the optimizer
- `POST /api/route` for the ordered route, live ETA, per-leg ETA and route geometry

If the API key is not configured, the client automatically falls back to OSRM road data plus Routly's time-of-day traffic model. The UI explicitly identifies whether a result is using **Live traffic** or **Modeled traffic**.

## Vehicle profiles

Routly currently supports:

- Motorcycle
- Car
- Van
- Truck

The selected vehicle affects:

- traffic sensitivity
- effective urban speed assumptions
- default fuel efficiency
- per-leg handling/junction buffer

Motorcycles use Google's `TWO_WHEELER` mode when the live provider is available. Car, van and truck currently use `DRIVE`. Height, axle, weight and commercial-truck road restrictions are not yet enforced and should be added before presenting Routly as truck-specific navigation.

## Route history

Every successful optimization is recorded in local browser storage on that device, up to 30 recent runs.

A history entry stores:

- starting point
- originally entered stops
- optimized stop order
- selected vehicle
- traffic source/provider
- total ETA
- ETA range
- distance
- estimated time saved
- estimated distance saved
- saved/bookmarked state

Restoring a route intentionally does **not** restore a stale route geometry or ETA. Routly loads the original inputs and asks the user to optimize again so traffic and ETA are recalculated.

## Routing approach

Routly obtains a travel-time matrix between the origin and every stop. When live traffic is configured, that matrix comes from Google Routes with `TRAFFIC_AWARE` routing. Otherwise Routly obtains an OSRM matrix and applies an explicit traffic/vehicle model.

The client then solves the fixed-start shortest Hamiltonian path with dynamic programming. The origin remains fixed while the remaining stops are reordered by travel time.

After ordering the stops, Routly requests the final route. Google Routes is preferred when configured; otherwise OSRM supplies the road geometry and Routly applies its fallback ETA model.

## Production notes

The current fallback still uses public Nominatim and OSRM infrastructure. Before material production traffic:

- proxy geocoding behind Routly's backend
- add caching and rate limiting
- monitor provider failures and latency
- enforce API quotas
- store route history server-side for authenticated accounts
- add live traffic provider usage monitoring and billing protection
- add commercial vehicle restrictions before relying on van/truck routes for restricted roads

Local route history is appropriate for the current MVP, but an authenticated database should become the source of truth once Routly adds accounts, fleets or cross-device history.
