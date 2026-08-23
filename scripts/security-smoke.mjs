// Security smoke test against a running production server (enforcement ON).
const BASE = 'http://127.0.0.1:3210';
let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

const jar = { cookie: '' };

async function hit(path, opts = {}, useCookie = true) {
  const headers = { ...(opts.headers ?? {}) };
  if (useCookie && jar.cookie) headers.cookie = jar.cookie;
  const res = await fetch(BASE + path, { ...opts, headers });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) jar.cookie = setCookie.split(';')[0];
  return res;
}

// 1. Unauthenticated API access is rejected
{
  const r = await fetch(`${BASE}/api/workspace/tree`);
  const body = await r.json().catch(() => ({}));
  check(
    '401 on API without token',
    r.status === 401 && body?.error?.code === 'UNAUTHORIZED',
    JSON.stringify(body)
  );
}

// 2. Page load sets the session cookie; same-origin flow then works
{
  const page = await fetch(BASE + '/');
  const setCookie = page.headers.get('set-cookie') ?? '';
  check(
    'HTML load sets HttpOnly SameSite=Strict cookie',
    /lstudio_token=/.test(setCookie) && /httponly/i.test(setCookie) && /samesite=strict/i.test(setCookie),
    setCookie.slice(0, 60) + '...'
  );
  jar.cookie = setCookie.split(';')[0];
}

{
  const r = await hit('/api/workspace/tree');
  // No workspace is open on a fresh server → business layer answers 409.
  // The point of this check: authentication passed (not 401/403).
  check('cookie-authenticated request passes auth layer', r.status !== 401 && r.status !== 403, `status=${r.status}`);
}

// 3. Token bootstrap endpoint + header auth
{
  const tr = await fetch(`${BASE}/api/auth/token`);
  const { token } = await tr.json();
  check('/api/auth/token issues token', typeof token === 'string' && token.length >= 32);
  const r = await fetch(`${BASE}/api/health`, {
    headers: { 'x-latex-studio-token': token },
  });
  check('header auth accepted', r.status === 200);
  const bad = await fetch(`${BASE}/api/health`, {
    headers: { 'x-latex-studio-token': 'wrong-token' },
  });
  check('wrong header token rejected (401)', bad.status === 401);
}

// 4. DNS rebinding: foreign Host is rejected before handlers
// (node:http allows Host override; undici fetch does not)
{
  const status = await new Promise((resolve) => {
    import('node:http').then(({ default: http }) => {
      const req = http.request(
        { host: '127.0.0.1', port: 3210, path: '/api/workspace/tree', method: 'GET', headers: { host: 'evil.example.com' } },
        (res) => {
          void res.resume();
          resolve(res.statusCode ?? 0);
        }
      );
      req.on('error', () => resolve(0));
      req.end();
    });
  });
  const bodyOk = status === 403;
  check('403 on foreign Host (DNS rebinding)', bodyOk, `status=${status}`);
}

// 5. Cross-origin request from an attacker page: no ACAO reflection
{
  const r = await fetch(`${BASE}/api/workspace/tree`, {
    headers: { origin: 'https://evil.example.com' },
  });
  const acao = r.headers.get('access-control-allow-origin');
  check('no ACAO reflection for foreign Origin', r.status === 403 && acao === null, `acao=${acao}`);
}

// 6. CORS preflight from attacker origin gets no ACAO
{
  const r = await fetch(`${BASE}/api/file/save`, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://evil.example.com',
      'access-control-request-method': 'POST',
    },
  });
  const acao = r.headers.get('access-control-allow-origin');
  check('preflight for attacker origin has no ACAO', acao === null, `acao=${acao}`);
}

console.log(`\n${fail === 0 ? 'ALL CHECKS PASSED' : 'FAILURES: ' + fail} (${pass} passed)`);
// Let keep-alive sockets settle before exiting (Node/Win32 libuv teardown noise).
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 150);
