// TEST-ONLY stand-in for Supabase's API layer (PostgREST + GoTrue), backed by the REAL
// schema in a local Postgres. It runs each RPC under the same role + JWT-claim mechanism
// Supabase uses (`set local role`, `request.jwt.claim.sub`), so the database's own
// permissions and RLS are what the browser tests exercise. Never deploy this.
import http from 'node:http'
import pg from 'pg'

const ADMIN_EMAIL = 'admin@example.com'
const ADMIN_PASSWORD = 'admin-pass'
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')

export function startShim({ database = 'vibe_e2e', port = 54321 } = {}) {
  const pool = new pg.Pool({ host: '127.0.0.1', database, user: 'vibe_e2e', password: 'vibe_e2e' })
  let adminId
  const ready = pool.query('select id from auth.users where email = $1', [ADMIN_EMAIL]).then((r) => { adminId = r.rows[0]?.id })

  const send = (res, status, body) => {
    res.writeHead(status, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': '*',
    })
    res.end(body === undefined ? '' : JSON.stringify(body))
  }
  const readBody = (req) => new Promise((ok) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => ok(d ? JSON.parse(d) : {})) })
  const subOf = (req) => {
    const t = (req.headers.authorization || '').replace(/^Bearer /, '')
    try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).sub ?? null } catch { return null }
  }

  const server = http.createServer(async (req, res) => {
    await ready
    const url = new URL(req.url, 'http://x')
    if (req.method === 'OPTIONS') return send(res, 204)

    if (url.pathname === '/auth/v1/token') {
      const { email, password } = await readBody(req)
      if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
        return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' })
      }
      const now = Math.floor(Date.now() / 1000)
      const jwt = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: adminId, role: 'authenticated', aud: 'authenticated', exp: now + 3600, email })}.x`
      return send(res, 200, {
        access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r',
        user: { id: adminId, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
      })
    }
    if (url.pathname === '/auth/v1/logout') return send(res, 204)

    const m = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/)
    if (m && req.method === 'POST') {
      const args = await readBody(req)
      const keys = Object.keys(args)
      const sub = subOf(req)
      const client = await pool.connect()
      try {
        await client.query('begin')
        await client.query(`set local role ${sub ? 'authenticated' : 'anon'}`)
        await client.query("select set_config('request.jwt.claim.sub', $1, true)", [sub ?? ''])
        const call = `select public.${m[1]}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`
        const r = await client.query(call, keys.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k])))
        await client.query('commit')
        return send(res, 200, r.rows[0].r ?? null)
      } catch (e) {
        await client.query('rollback').catch(() => {})
        const denied = e.code === '42501'
        return send(res, denied ? 403 : 400, { code: e.code, message: e.message, details: null, hint: null })
      } finally { client.release() }
    }
    send(res, 404, { message: 'not found' })
  })
  return new Promise((ok) => server.listen(port, () => ok({ close: () => { server.close(); return pool.end() } })))
}

export const ADMIN = { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
