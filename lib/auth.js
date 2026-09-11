// ===================================================================
// Xerox Centre — Authentication & Stateless Session Handling
// ===================================================================

const crypto = require('crypto');

const SESSION_SECRET = process.env.SESSION_SECRET || 'xerox-centre-production-secret-ait-pune-2026';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ---------- Password Hashing (built-in crypto, scrypt) ----------
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function makeSalt() {
  return crypto.randomBytes(16).toString('hex');
}

// ---------- Cookie Parsing ----------
function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(val);
    } catch (e) {
      out[key] = val;
    }
  });
  return out;
}

// ---------- Stateless Signed Session Tokens (HMAC-SHA256) ----------
// Enables sessions to work seamlessly across Vercel serverless function instances
function createSessionToken(user) {
  const payload = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role || 'user',
    exp: Date.now() + SESSION_MAX_AGE_MS
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payloadB64).digest('hex');
  return `${payloadB64}.${signature}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payloadB64).digest('hex');

  if (signature.length !== expectedSig.length) return null;
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

  try {
    const jsonStr = Buffer.from(payloadB64, 'base64url').toString('utf-8');
    const payload = JSON.parse(jsonStr);
    if (!payload || !payload.exp || Date.now() > payload.exp) return null;
    return {
      userId: payload.userId,
      name: payload.name,
      email: payload.email,
      role: payload.role || 'user'
    };
  } catch (err) {
    return null;
  }
}

function getSessionFromReq(req) {
  const cookies = parseCookies(req);
  const token = cookies.session;
  if (!token) return null;
  return verifySessionToken(token);
}

module.exports = {
  hashPassword,
  makeSalt,
  parseCookies,
  createSessionToken,
  verifySessionToken,
  getSessionFromReq
};
