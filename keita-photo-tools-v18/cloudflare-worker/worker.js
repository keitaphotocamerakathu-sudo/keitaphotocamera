const te = new TextEncoder();
const td = new TextDecoder();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const originCheck = checkOrigin(request, env);
    if (originCheck instanceof Response) return originCheck;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });

    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        return json(request, env, { ok: true, service: 'KEITA License API', version: '18.0', now: new Date().toISOString() });
      }
      if (url.pathname === '/api/activate' && request.method === 'POST') return activate(request, env);
      if (url.pathname === '/api/status' && request.method === 'POST') return licenseStatus(request, env);
      if (url.pathname === '/api/admin/licenses/create' && request.method === 'POST') return adminCreate(request, env);
      if (url.pathname === '/api/admin/licenses/list' && request.method === 'POST') return adminList(request, env);
      if (url.pathname === '/api/admin/licenses/revoke' && request.method === 'POST') return adminRevoke(request, env);
      return json(request, env, { ok: false, error: 'NOT_FOUND' }, 404);
    } catch (err) {
      console.error(err);
      return json(request, env, { ok: false, error: 'SERVER_ERROR', message: String(err?.message || err) }, 500);
    }
  }
};

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  let allow = '*';
  if (allowed.length) allow = allowed.includes('*') ? '*' : (allowed.includes(origin) ? origin : allowed[0]);
  return {
    'Access-Control-Allow-Origin': allow,
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store'
  };
}

function checkOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!origin || !allowed.length || allowed.includes('*') || allowed.includes(origin)) return true;
  return new Response(JSON.stringify({ ok: false, error: 'ORIGIN_NOT_ALLOWED' }), {
    status: 403,
    headers: { ...corsHeaders(request, env), 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function json(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request, env), 'Content-Type': 'application/json; charset=utf-8' }
  });
}

async function readJson(request) {
  try { return await request.json(); } catch { throw new Error('INVALID_JSON'); }
}

function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
}

function b64uToBytes(s) {
  s = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const raw = atob(s), out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function sha256Hex(text) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(text)));
  return [...h].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}

async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, te.encode(text)));
  return [...sig].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}

async function keyHash(env, key) {
  if (!env.LICENSE_PEPPER) throw new Error('LICENSE_PEPPER_NOT_CONFIGURED');
  return hmacHex(env.LICENSE_PEPPER, 'KEITA-LICENSE|' + String(key || '').trim());
}

function safeEq(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

function requireAdmin(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return !!env.ADMIN_SECRET && safeEq(token, env.ADMIN_SECRET);
}

function randomChar(chars) {
  const a = new Uint32Array(1); crypto.getRandomValues(a); return chars[a[0] % chars.length];
}

function makeLicenseKey() {
  const groups = ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '0123456789', '!@#$%^&*_+-=?'];
  const all = groups.join('');
  const out = groups.map(randomChar);
  while (out.length < 20) out.push(randomChar(all));
  for (let i = out.length - 1; i > 0; i--) {
    const a = new Uint32Array(1); crypto.getRandomValues(a); const j = a[0] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}

function addMonthsClamped(iso, months) {
  const d = new Date(iso), day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + months);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  const last = new Date(Date.UTC(y, m + 1, 0, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds())).getUTCDate();
  d.setUTCDate(Math.min(day, last)); return d.toISOString();
}

function addYearsClamped(iso, years) {
  return addMonthsClamped(iso, years * 12);
}

function computeExpiry(row, activatedAt) {
  const type = row.plan_type;
  const n = Math.max(1, Number(row.duration_value || 1));
  if (type === 'lifetime') return null;
  if (type === 'custom') return row.fixed_expires_at || null;
  const d = new Date(activatedAt);
  if (type === 'trial') { d.setUTCDate(d.getUTCDate() + n); return d.toISOString(); }
  if (type === 'monthly') return addMonthsClamped(activatedAt, n);
  if (type === 'yearly') return addYearsClamped(activatedAt, n);
  throw new Error('UNKNOWN_PLAN');
}

async function deviceIdentityFromJwk(jwk) {
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-384' || !jwk.x || !jwk.y) throw new Error('INVALID_DEVICE_KEY');
  const fp = await sha256Hex(stable(jwk));
  return { fingerprint: 'SHA256:' + fp, deviceId: 'KEITA-' + fp.slice(0, 36) };
}

async function noteActivationAttempt(request, env, deviceId) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const bucket = Math.floor(Date.now() / 3600000);
  const id = await hmacHex(env.LICENSE_PEPPER || 'fallback', `${ip}|${deviceId}|${bucket}`);
  const row = await env.DB.prepare('SELECT attempts FROM activation_attempts WHERE id=?').bind(id).first();
  if (Number(row?.attempts || 0) >= 30) return false;
  await env.DB.prepare(`INSERT INTO activation_attempts(id,bucket,attempts,updated_at) VALUES(?,?,1,?)
    ON CONFLICT(id) DO UPDATE SET attempts=attempts+1, updated_at=excluded.updated_at`).bind(id, bucket, new Date().toISOString()).run();
  if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM activation_attempts WHERE bucket < ?').bind(bucket - 48).run();
  return true;
}

async function activate(request, env) {
  const body = await readJson(request);
  const key = String(body.key || '').trim();
  if (key.length !== 20) return json(request, env, { ok: false, error: 'INVALID_KEY' }, 400);
  let ident;
  try { ident = await deviceIdentityFromJwk(body.device_public_jwk); } catch { return json(request, env, { ok: false, error: 'INVALID_DEVICE' }, 400); }
  if (body.device_id !== ident.deviceId) return json(request, env, { ok: false, error: 'DEVICE_ID_MISMATCH' }, 400);
  if (!(await noteActivationAttempt(request, env, ident.deviceId))) return json(request, env, { ok: false, error: 'TOO_MANY_ATTEMPTS' }, 429);

  const hash = await keyHash(env, key);
  let row = await env.DB.prepare('SELECT * FROM licenses WHERE key_hash=?').bind(hash).first();
  if (!row) return json(request, env, { ok: false, error: 'INVALID_KEY' }, 404);
  if (row.status === 'revoked') return json(request, env, { ok: false, error: 'REVOKED' }, 403);

  const now = new Date().toISOString();
  if (!row.device_id) {
    const exp = computeExpiry(row, now);
    if (exp && Date.parse(exp) <= Date.now()) return json(request, env, { ok: false, error: 'EXPIRED' }, 403);
    await env.DB.prepare(`UPDATE licenses SET
      device_id=?, device_public_jwk=?, activated_at=?, expires_at=?, status='active', activation_count=activation_count+1, last_seen_at=?
      WHERE id=? AND device_id IS NULL AND status!='revoked'`)
      .bind(ident.deviceId, JSON.stringify(body.device_public_jwk), now, exp, now, row.id).run();
    row = await env.DB.prepare('SELECT * FROM licenses WHERE id=?').bind(row.id).first();
  }

  if (row.device_id !== ident.deviceId) return json(request, env, { ok: false, error: 'DEVICE_BOUND', message: 'License Key นี้ถูกผูกกับเครื่องอื่นแล้ว' }, 409);
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) return json(request, env, { ok: false, error: 'EXPIRED' }, 403);
  await env.DB.prepare('UPDATE licenses SET last_seen_at=? WHERE id=?').bind(now, row.id).run();
  return json(request, env, { ok: true, license: publicLicense(row) });
}

function proofText(licenseId, deviceId, timestamp, nonce) {
  return `KEITA_STATUS|${licenseId}|${deviceId}|${timestamp}|${nonce}`;
}

async function verifyProof(row, body) {
  if (!row.device_public_jwk) return false;
  const ts = Number(body.timestamp || 0);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) return false;
  if (!body.nonce || String(body.nonce).length < 12 || !body.signature) return false;
  const jwk = JSON.parse(row.device_public_jwk);
  const pub = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-384' }, false, ['verify']);
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-384' }, pub, b64uToBytes(body.signature), te.encode(proofText(row.id, row.device_id, ts, body.nonce)));
}

async function licenseStatus(request, env) {
  const body = await readJson(request);
  const id = String(body.license_id || '');
  if (!id || !body.device_id) return json(request, env, { ok: false, error: 'INVALID_REQUEST' }, 400);
  const row = await env.DB.prepare('SELECT * FROM licenses WHERE id=?').bind(id).first();
  if (!row) return json(request, env, { ok: false, error: 'NOT_FOUND' }, 404);
  if (row.device_id !== body.device_id) return json(request, env, { ok: false, error: 'DEVICE_BOUND' }, 403);
  if (!(await verifyProof(row, body))) return json(request, env, { ok: false, error: 'DEVICE_PROOF_FAILED' }, 403);
  if (row.status === 'revoked') return json(request, env, { ok: false, error: 'REVOKED' }, 403);
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
    await env.DB.prepare("UPDATE licenses SET status='expired' WHERE id=? AND status!='revoked'").bind(id).run();
    return json(request, env, { ok: false, error: 'EXPIRED', license: publicLicense({ ...row, status: 'expired' }) }, 403);
  }
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE licenses SET last_seen_at=?, status='active' WHERE id=?").bind(now, id).run();
  row.last_seen_at = now; row.status = 'active';
  return json(request, env, { ok: true, license: publicLicense(row) });
}

function publicLicense(row) {
  return {
    id: row.id,
    customer_name: row.customer_name || '',
    photographer_code: row.photographer_code || '',
    plan_type: row.plan_type,
    duration_value: row.duration_value,
    created_at: row.created_at,
    activated_at: row.activated_at,
    expires_at: row.expires_at,
    status: row.status,
    device_id: row.device_id,
    key_hint: row.key_hint,
    last_seen_at: row.last_seen_at
  };
}

function validatePlan(body) {
  const type = String(body.plan_type || 'trial');
  if (!['trial', 'monthly', 'yearly', 'custom', 'lifetime'].includes(type)) throw new Error('INVALID_PLAN');
  let n = Number(body.duration_value || 1);
  if (!Number.isInteger(n) || n < 1 || n > 3650) n = 1;
  let fixed = null;
  if (type === 'custom') {
    fixed = String(body.fixed_expires_at || '');
    if (!fixed || !Number.isFinite(Date.parse(fixed)) || Date.parse(fixed) <= Date.now()) throw new Error('INVALID_EXPIRY');
  }
  return { type, n, fixed };
}

async function adminCreate(request, env) {
  if (!requireAdmin(request, env)) return json(request, env, { ok: false, error: 'UNAUTHORIZED' }, 401);
  const body = await readJson(request), plan = validatePlan(body), now = new Date().toISOString();
  for (let attempt = 0; attempt < 5; attempt++) {
    const key = makeLicenseKey(), hash = await keyHash(env, key), id = crypto.randomUUID(), hint = key.slice(0, 3) + '••••' + key.slice(-3);
    try {
      await env.DB.prepare(`INSERT INTO licenses
        (id,key_hash,key_hint,customer_name,photographer_code,plan_type,duration_value,fixed_expires_at,created_at,status,activation_count,notes)
        VALUES(?,?,?,?,?,?,?,?,?,'unused',0,?)`)
        .bind(id, hash, hint, String(body.customer_name || ''), String(body.photographer_code || ''), plan.type, plan.n, plan.fixed, now, String(body.notes || '')).run();
      return json(request, env, { ok: true, key, license: { id, key_hint: hint, customer_name: body.customer_name || '', photographer_code: body.photographer_code || '', plan_type: plan.type, duration_value: plan.n, fixed_expires_at: plan.fixed, created_at: now, status: 'unused' } });
    } catch (e) {
      if (attempt === 4) throw e;
    }
  }
}

async function adminList(request, env) {
  if (!requireAdmin(request, env)) return json(request, env, { ok: false, error: 'UNAUTHORIZED' }, 401);
  const body = await readJson(request), limit = Math.min(200, Math.max(1, Number(body.limit || 100)));
  const rows = await env.DB.prepare('SELECT id,key_hint,customer_name,photographer_code,plan_type,duration_value,fixed_expires_at,created_at,activated_at,expires_at,device_id,status,last_seen_at,activation_count,notes FROM licenses ORDER BY created_at DESC LIMIT ?').bind(limit).all();
  return json(request, env, { ok: true, licenses: rows.results || [] });
}

async function adminRevoke(request, env) {
  if (!requireAdmin(request, env)) return json(request, env, { ok: false, error: 'UNAUTHORIZED' }, 401);
  const body = await readJson(request), id = String(body.license_id || '');
  if (!id) return json(request, env, { ok: false, error: 'INVALID_REQUEST' }, 400);
  await env.DB.prepare("UPDATE licenses SET status='revoked' WHERE id=?").bind(id).run();
  return json(request, env, { ok: true });
}
