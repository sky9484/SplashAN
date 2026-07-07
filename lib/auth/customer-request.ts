const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

export function customerRequestOriginAllowed(request: Request): boolean {
  if (safeMethods.has(request.method.toUpperCase())) return true;

  const origin = request.headers.get('origin');
  if (origin) {
    try {
      return new URL(origin).origin === new URL(request.url).origin;
    } catch {
      return false;
    }
  }

  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return new URL(referer).origin === new URL(request.url).origin;
    } catch {
      return false;
    }
  }

  const fetchSite = request.headers.get('sec-fetch-site');
  return fetchSite !== 'cross-site';
}
