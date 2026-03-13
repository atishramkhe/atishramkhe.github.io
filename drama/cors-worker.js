/**
 * Cloudflare Worker — CORS Proxy for kisskh API
 * 
 * Deploy this as a Cloudflare Worker (free tier):
 * 
 *   1. Go to https://dash.cloudflare.com → Workers & Pages → Create
 *   2. Name it e.g. "kisskh-proxy"
 *   3. Click "Edit code", paste this file's content, click "Deploy"
 *   4. Your worker URL will be: https://kisskh-proxy.<your-subdomain>.workers.dev
 *   5. Update WORKER_URL in drama/index.html with that URL
 * 
 * Usage:  GET https://kisskh-proxy.xxx.workers.dev/?url=<encoded-kisskh-url>
 * 
 * Restrictions:
 *   - Only proxies requests to kisskh.ovh / kisskh.co / kisskh.la
 *   - Only allows requests from atishramkhe.github.io and localhost
 */

const ALLOWED_ORIGINS = [
  'https://atishramkhe.github.io',
  'https://localhost:8000',
  'http://localhost:8000',
  'http://localhost:8888',
  'null', // for local file:// testing
];

const ALLOWED_TARGETS = [
  'kisskh.ovh',
  'kisskh.co',
  'kisskh.la',
];

export default {
  async fetch(request) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCORS(request, new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');

    if (!targetUrl) {
      return handleCORS(request, new Response(
        JSON.stringify({ error: 'Missing ?url= parameter' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      ));
    }

    // Validate target
    let target;
    try {
      target = new URL(targetUrl);
    } catch {
      return handleCORS(request, new Response(
        JSON.stringify({ error: 'Invalid URL' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      ));
    }

    if (!ALLOWED_TARGETS.some(h => target.hostname === h || target.hostname.endsWith('.' + h))) {
      return handleCORS(request, new Response(
        JSON.stringify({ error: 'Target host not allowed' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      ));
    }

    // Fetch from upstream
    try {
      const upstream = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json, */*',
          'Referer': target.origin,
        },
        redirect: 'follow',
      });

      const body = await upstream.arrayBuffer();
      const response = new Response(body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: {
          'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
          'Cache-Control': 'public, max-age=300', // cache 5 min
        },
      });

      return handleCORS(request, response);
    } catch (err) {
      return handleCORS(request, new Response(
        JSON.stringify({ error: 'Upstream fetch failed', details: err.message }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      ));
    }
  },
};

function handleCORS(request, response) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) || origin.startsWith('http://localhost:');

  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', allowed ? origin : ALLOWED_ORIGINS[0]);
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  headers.set('Access-Control-Max-Age', '86400');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
