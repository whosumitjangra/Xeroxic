// ===================================================================
// Xerox Centre — Authentication & Stateless Session Handling (Hardened)
// OWASP Top 10 Compliant: scrypt hashing, timing-safe equality, dynamic secrets
// ===================================================================

const crypto = require('crypto');

// Generate an ephemeral strong random secret if SESSION_SECRET is not supplied in environment
let runtimeSecret = process.env.SESSION_SECRET;
if (!runtimeSecret) {
  if (process.env.NODE_ENV === 'production' && !process.env.VERCEL) {
    console.error('CRITICAL SECURITY WARNING: SESSION_SECRET is not set in production! Generating runtime key.');
  }
  runtimeSecret = crypto.randomBytes(32).toString('hex');
}

const SESSION_SECRET = runtimeSecret;
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ---------- Password Hashing (OWASP-recommended scrypt) ----------
const SCRYPT_OPTIONS = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024
};

function hashPassword(password, salt) {
  if (typeof password !== 'string' || !password || typeof salt !== 'string' || !salt) {
    throw new Error('Password and salt are required for hashing.');
  }
  return crypto.scryptSync(password, salt, 64, SCRYPT_OPTIONS).toString('hex');
}

function makeSalt() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Constant-time verification of passwords against stored hashes
 */
function verifyPassword(password, salt, storedHash) {
  if (!password || !salt || !storedHash) return false;
  try {
    const computedHash = hashPassword(password, salt);
    const computedBuf = Buffer.from(computedHash, 'utf-8');
    const storedBuf = Buffer.from(storedHash, 'utf-8');

    if (computedBuf.length !== storedBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(computedBuf, storedBuf);
  } catch (err) {
    return false;
  }
}

/**
 * Perform a dummy hash calculation to ensure constant response times
 * even when an email does not exist in the database (prevents user enumeration)
 */
const DUMMY_SALT = crypto.randomBytes(16).toString('hex');
function dummyVerifyPassword(password) {
  try {
    hashPassword(password || 'dummy_password_constant_time', DUMMY_SALT);
  } catch (e) {}
  return false;
}

// ---------- Cookie Parsing & Formatting ----------
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

function formatSessionCookie(token, isSecure = false) {
  const maxAge = Math.floor(SESSION_MAX_AGE_MS / 1000);
  let cookie = `session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
  if (isSecure) {
    cookie += '; Secure';
  }
  return cookie;
}

// ---------- Stateless Signed Session Tokens (HMAC-SHA256) ----------
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
  const sigBuf = Buffer.from(signature, 'utf-8');
  const expBuf = Buffer.from(expectedSig, 'utf-8');
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
  verifyPassword,
  dummyVerifyPassword,
  parseCookies,
  formatSessionCookie,
  createSessionToken,
  verifySessionToken,
  getSessionFromReq
};
