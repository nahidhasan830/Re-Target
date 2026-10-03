import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

export async function fakeWaha(key) {
  let sessions = new Map();
  let failure = false;
  let qrRace = false;
  let sendStatus = 200;
  let sendDelay = 0;
  let pairingFailure = false;
  let numberCheckResponse;
  let partStatuses = [], malformedSend = false;
  let sendError;
  let sessionUpdateState;
  let calls = [];
  let messages = [];
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==';
  const server = createServer(async (request, response) => {
    const send = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
    const read = async () => { const chunks = []; for await (const chunk of request) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString() || '{}'); };
    if (request.headers['x-api-key'] !== key) return send(401, { error: 'Unauthorized' });
    if (request.url === '/__test/state' && request.method === 'POST') {
      const data = await read();
      sessions = new Map(Object.entries(data.sessions ?? {}));
      if (data.session) sessions.set('admin', { name: 'admin', ...data.session });
      numberCheckResponse = data.numberCheckResponse; failure = Boolean(data.failure); qrRace = Boolean(data.qrRace); calls = []; messages = [];
      partStatuses = data.partStatuses ?? []; malformedSend = Boolean(data.malformedSend);
      sendError = data.sendError;
      sessionUpdateState = data.sessionUpdateState;
      sendStatus = data.sendStatus ?? 200; sendDelay = data.sendDelay ?? 0; pairingFailure = Boolean(data.pairingFailure);
      return send(200, { ok: true });
    }
    if (request.url === '/__test/session' && request.method === 'POST') {
      const { name, ...state } = await read(); sessions.set(name, { name, ...state }); return send(200, { ok: true });
    }
    if (request.url === '/__test/calls') return send(200, calls);
    if (request.url === '/__test/messages') return send(200, messages);
    calls.push({ method: request.method, path: request.url });
    if (failure) return send(503, { error: `Private upstream details ${key}` });
    if (request.url.startsWith('/api/contacts/check-exists?')) {
      const url = new URL(request.url, 'http://localhost');
      const phone = url.searchParams.get('phone'), name = url.searchParams.get('session');
      if (sessions.get(name)?.status !== 'WORKING' || !/^8801[0-9]{9}$/.test(phone || '')) return send(422, {});
      return send(200, numberCheckResponse ?? { numberExists: phone.endsWith('8'), chatId: `${phone}@c.us` });
    }
    if (request.url === '/api/sessions?all=true') return send(200, [...sessions].map(([name, session]) => ({ ...session, name })));
    const detail = request.url.match(/^\/api\/sessions\/([A-Za-z0-9_-]+)$/);
    if (detail && request.method === 'GET') return send(sessions.has(detail[1]) ? 200 : 404, sessions.get(detail[1]) ?? {});
    if (detail && request.method === 'PUT') { const body = await read(); const current = sessions.get(detail[1]); if (!current) return send(404, {}); sessions.set(detail[1], { ...current, ...sessionUpdateState, config: body.config }); return send(200, sessions.get(detail[1])); }
    if (request.url === '/api/sessions' && request.method === 'POST') {
      const body = await read();
      if (sessions.has(body.name)) return send(409, { error: 'Already exists' });
      const state = { name: body.name, status: 'SCAN_QR_CODE', me: null }; sessions.set(body.name, state); return send(201, state);
    }
    const action = request.url.match(/^\/api\/sessions\/([A-Za-z0-9_-]+)\/(start|restart|logout|stop)$/);
    if (action && request.method === 'POST') {
      if (!sessions.has(action[1])) return send(404, {});
      const state = { name: action[1], status: ['stop', 'logout'].includes(action[2]) ? 'STOPPED' : 'SCAN_QR_CODE', me: null };
      sessions.set(action[1], state); return send(200, state);
    }
    if (/^\/api\/[^/]+\/auth\/qr$/.test(request.url)) return send(qrRace ? 422 : 200, { mimetype: 'image/png', data: png });
    if (/^\/api\/[^/]+\/auth\/request-code$/.test(request.url) && request.method === 'POST') {
      const body = await read();
      if (!/^8801[0-9]{9}$/.test(body.phoneNumber)) return send(400, { error: 'Wrong phone format' });
      return send(pairingFailure ? 503 : 200, pairingFailure ? {} : { code: 'AB12-CD34' });
    }
    if (['/api/sendText', '/api/sendImage', '/api/sendVideo'].includes(request.url) && request.method === 'POST') {
      const body = await read(); messages.push(body);
      if (!sessions.has(body.session) || !/^[0-9]+@(c\.us|lid)$/.test(body.chatId)) return send(400, { error: 'Invalid invitation sender' });
      if (sendDelay) await new Promise((resolve) => setTimeout(resolve, sendDelay));
      const status = partStatuses.shift() ?? sendStatus;
      return send(status, status === 200 ? (malformedSend ? {} : { id: randomUUID() }) : sendError ?? { error: `Private upstream details ${key}` });
    }
    send(404, { error: 'Missing fixture route' });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}
