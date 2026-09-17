# Routly

Routly is a multi-stop delivery route planner built for riders and small delivery teams. Add a starting point and multiple delivery drops, then let Routly reorder the stops to reduce driving time and distance.

## MVP features

- React + Vite, written in JSX
- OpenStreetMap + Leaflet interactive map
- OpenStreetMap Nominatim geocoding
- OSRM road travel-time matrix + road route geometry
- Exact fixed-start route optimization for up to 10 delivery stops
- ETA and distance for every route leg
- Total trip time and distance
- Estimated fuel and fuel-cost savings based on configurable efficiency / fuel price
- Current-location support
- Lagos demo route
- Responsive mobile UI
- Pinch zoom disabled at page viewport level
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

## Routing approach

Routly first asks OSRM for the road travel-time and distance matrix between the starting point and every stop. It then solves the fixed-start shortest Hamiltonian path with dynamic programming, keeping the rider's origin fixed while finding the fastest ordering of the remaining stops. The final ordered route is requested from OSRM and drawn on the map.

## Production note

This MVP uses public OpenStreetMap/Nominatim and OSRM demo infrastructure. For production traffic, move geocoding and routing behind a paid or self-hosted provider and add request caching/rate limiting.
