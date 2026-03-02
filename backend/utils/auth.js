function getExpectedKey() {
  const key = process.env.PAWVY_API_KEY;
  if (!key) return null;
  const trimmed = String(key).trim();
  return trimmed ? trimmed : null;
}

function extractProvidedKey(req) {
  // HTTP: Authorization: Bearer <key>
  const auth = req.headers?.authorization;
  if (auth && typeof auth === 'string') {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }

  // HTTP: x-api-key: <key>
  const x = req.headers?.['x-api-key'];
  if (typeof x === 'string' && x.trim()) return x.trim();

  // WS or HTTP fallback: ?apiKey=<key>
  try {
    const url = new URL(req.url, 'http://localhost');
    const q = url.searchParams.get('apiKey') || url.searchParams.get('key');
    if (q && q.trim()) return q.trim();
  } catch {
    // ignore
  }

  return null;
}

function requireApiKey(opts = {}) {
  const { allowPaths = [] } = opts;
  return function pawvyAuthMiddleware(req, res, next) {
    const expected = getExpectedKey();
    if (!expected) return next();

    if (allowPaths.some((p) => req.path === p || req.path.startsWith(p + '/'))) return next();

    const provided = extractProvidedKey(req);
    if (provided && provided === expected) return next();

    res.status(401).json({
      error: 'unauthorized',
      message: 'Missing or invalid API key. Provide Authorization: Bearer <key> (or x-api-key).',
    });
  };
}

function isRequestAuthorized(req) {
  const expected = getExpectedKey();
  if (!expected) return true;
  const provided = extractProvidedKey(req);
  return Boolean(provided && provided === expected);
}

module.exports = {
  requireApiKey,
  isRequestAuthorized,
  extractProvidedKey,
};
