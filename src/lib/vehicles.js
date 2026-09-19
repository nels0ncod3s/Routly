export const VEHICLE_PROFILES = {
  motorcycle: {
    id: 'motorcycle',
    label: 'Motorcycle',
    shortLabel: 'Bike',
    description: 'Best for dispatch riders and light parcels.',
    efficiencyKmpl: 35,
    congestionFactor: 0.82,
    speedFactor: 1.12,
    serviceBufferSeconds: 45,
    googleTravelMode: 'TWO_WHEELER',
  },
  car: {
    id: 'car',
    label: 'Car',
    shortLabel: 'Car',
    description: 'Standard urban driving profile.',
    efficiencyKmpl: 12,
    congestionFactor: 1,
    speedFactor: 1,
    serviceBufferSeconds: 60,
    googleTravelMode: 'DRIVE',
  },
  van: {
    id: 'van',
    label: 'Van',
    shortLabel: 'Van',
    description: 'More conservative timing for larger delivery vehicles.',
    efficiencyKmpl: 9,
    congestionFactor: 1.08,
    speedFactor: 0.92,
    serviceBufferSeconds: 85,
    googleTravelMode: 'DRIVE',
  },
  truck: {
    id: 'truck',
    label: 'Truck',
    shortLabel: 'Truck',
    description: 'Slowest urban profile with larger handling buffers.',
    efficiencyKmpl: 6.5,
    congestionFactor: 1.16,
    speedFactor: 0.84,
    serviceBufferSeconds: 110,
    googleTravelMode: 'DRIVE',
  },
}

export const VEHICLE_OPTIONS = Object.values(VEHICLE_PROFILES)

export function getVehicleProfile(vehicleId) {
  return VEHICLE_PROFILES[vehicleId] || VEHICLE_PROFILES.motorcycle
}
