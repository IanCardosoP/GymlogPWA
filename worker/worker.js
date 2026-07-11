// Recolector de uso de GymLog. Guarda un ping anónimo por apertura de app.
const ALLOWED_ORIGIN = 'https://iancardosop.github.io'; // tu dominio GitHub Pages

export default {
  async fetch(request, env) {
    // Solo aceptamos POST
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }
    // Candado de origen: rechaza cualquier POST que no venga de tu app
    const origin = request.headers.get('Origin');
    if (origin !== ALLOWED_ORIGIN) {
      return new Response('Forbidden', { status: 403 });
    }

    let data;
    try {
      data = await request.json();
    } catch {
      return json({ ok: false }, 400, origin);
    }

    // INSERT con prepared statement (OWASP A03 — cero concatenación)
    await env.DB.prepare(
      'INSERT INTO pings (ts, device_id, evt, v) VALUES (?, ?, ?, ?)'
    ).bind(
      new Date().toISOString(),
      String(data.id  || ''),
      String(data.evt || 'open'),
      String(data.v   || '')
    ).run();

    return json({ ok: true }, 200, origin);
  }
};

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin,
    },
  });
}
