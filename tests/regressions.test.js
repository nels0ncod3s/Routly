import test from 'node:test'
import assert from 'node:assert/strict'
import { getLagosTrafficProfile, buildEtaRange } from '../src/lib/traffic.js'
import { loadRouteHistory } from '../src/lib/history.js'
import routeHandler from '../api/route.js'
import matrixHandler from '../api/route-matrix.js'

test('Lagos rush hour is independent of the viewer timezone', () => {
  const previous = process.env.TZ
  try {
    for (const timezone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = timezone
      assert.equal(getLagosTrafficProfile(new Date('2026-09-21T07:00:00Z')).label, 'Morning rush')
      assert.equal(getLagosTrafficProfile(new Date('2026-09-20T23:30:00Z')).label, 'Light traffic')
    }
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
})

test('short journeys cannot produce an inverted ETA range', () => {
  for (const duration of [0, 10, 30, 600]) {
    const range = buildEtaRange(duration, 'live')
    assert.ok(range.min <= range.max)
  }
})

test('malformed or blocked history cannot crash startup', () => {
  const previous = globalThis.window
  try {
    for (const value of ['[null, {}, {"id":"broken"}]', 'not json', '{}']) {
      globalThis.window = { localStorage: { getItem: () => value } }
      assert.deepEqual(loadRouteHistory(), [])
    }
    globalThis.window = { get localStorage() { throw new Error('blocked') } }
    assert.deepEqual(loadRouteHistory(), [])
  } finally { globalThis.window = previous }
})

test('route APIs reject null, coerced and out-of-range coordinates', async () => {
  const previous = process.env.GOOGLE_MAPS_API_KEY
  process.env.GOOGLE_MAPS_API_KEY = 'test-placeholder'
  try {
    for (const handler of [routeHandler, matrixHandler]) {
      for (const point of [null, { lat: null, lon: 3 }, { lat: '', lon: 3 }, { lat: 91, lon: 3 }, { lat: 6, lon: 181 }]) {
        const response = { status(code) { this.code = code; return this }, json(body) { this.body = body; return this } }
        await handler({ method: 'POST', body: { points: [point, { lat: 6.5, lon: 3.4 }] } }, response)
        assert.equal(response.code, 400)
      }
    }
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_MAPS_API_KEY
    else process.env.GOOGLE_MAPS_API_KEY = previous
  }
})
