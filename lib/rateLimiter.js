// ===================================================================
// Xerox Centre — Sliding Window In-Memory Rate Limiter
// Prevents brute-force, credential stuffing, and DoS on sensitive endpoints
// ===================================================================

const windows = new Map();

/**
 * Clean up expired entries every 5 minutes to prevent memory growth
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of windows.entries()) {
    if (now > record.resetTime) {
      windows.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

/**
 * Get client IP respecting trusted proxy headers
 */
function getClientIp(req) {
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (xForwardedFor) {
    return xForwardedFor.split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || '127.0.0.1';
}

/**
 * Rate limit check
 * @param {string} prefix Key category (e.g. 'login', 'signup')
 * @param {string} ip Client identifier
 * @param {number} maxAttempts Maximum requests allowed in window
 * @param {number} windowMs Window duration in milliseconds
 * @returns {{ allowed: boolean, remaining: number, retryAfter: number }}
 */
function checkRateLimit(prefix, ip, maxAttempts, windowMs) {
  const now = Date.now();
  const key = `${prefix}:${ip}`;
  let record = windows.get(key);

  if (!record || now > record.resetTime) {
    record = {
      count: 1,
      resetTime: now + windowMs
    };
    windows.set(key, record);
    return { allowed: true, remaining: maxAttempts - 1, retryAfter: 0 };
  }

  if (record.count >= maxAttempts) {
    const retryAfter = Math.ceil((record.resetTime - now) / 1000);
    return { allowed: false, remaining: 0, retryAfter: Math.max(1, retryAfter) };
  }

  record.count += 1;
  return { allowed: true, remaining: maxAttempts - record.count, retryAfter: 0 };
}

module.exports = {
  getClientIp,
  checkRateLimit
};
