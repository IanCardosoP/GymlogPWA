# Plan: Telemetría anónima de uso con Cloudflare Worker + D1

> **Qué es este documento:** una guía paso a paso para saber **cuántos dispositivos usan GymLog** (y cuántas veces se abre), sin costo, sin backend propio y sin datos personales.
>
> **Cómo leerlo — leyenda:**
> - 🧑 **TÚ (Ian)** → pasos manuales que haces en tu terminal y en el panel de Cloudflare. Es tu primera vez con Cloudflare, así que van con lujo de detalle.
> - 🤖 **AGENTE** → cambios de código dentro del repo que hará el agente de implementación.
>
> **Regla de oro del orden:** se ejecuta en 3 tandas → primero el 🤖 AGENTE crea los archivos del Worker (Parte 0), luego 🧑 TÚ despliegas en Cloudflare y obtienes una URL (Parte 1), y con esa URL el 🤖 AGENTE termina el código de la app (Parte 2). **No se puede saltar el orden.**

---

## 1. Contexto — por qué

GymLog es una PWA local-first en GitHub Pages, cacheada por Service Worker. Hoy **no hay forma de saber cuántos dispositivos la usan**:

- GitHub Pages no da analíticas del sitio (el `Insights → Traffic` del repo mide la página del repo en github.com, **no** la app desplegada).
- Por ser offline-first + Cache-First, tras la primera carga la app casi no toca la red.

Solución: cada instalación genera un **UUID anónimo** (guardado en la tabla `conf` de PGLite) y, al abrir la app estando online, envía un *beacon* a un **Cloudflare Worker** que lo guarda en una base de datos **D1** (SQLite serverless). Contar `DISTINCT device_id` = número real de dispositivos.

Elegimos Cloudflare Worker + D1 (sobre un Google Sheet) porque encaja mejor con el proyecto: es SQL, usa **prepared statements** (tu regla OWASP A03), y los secretos viven en el servidor, no en el cliente.

## 2. Qué vas a obtener

- **Dispositivos únicos** (instalaciones reales): `SELECT COUNT(DISTINCT device_id) FROM pings`
- **Aperturas totales** y **por día**
- Todo gratis, sin cookies, sin PII → GDPR por diseño.

## 3. Arquitectura

```
Tu PWA (GitHub Pages)              Cloudflare (edge, gratis)
┌────────────────────┐  POST     ┌──────────────────────────────┐
│ getOrCreateDeviceId│ ────────► │ Worker (worker.js)           │
│  → UUID en conf    │ {id,evt}  │  1. ¿es POST?                │
│ navigator.sendBeacon│          │  2. ¿Origin == tu dominio?   │ ← candado
└────────────────────┘           │  3. INSERT prepared statement├──┐
                                 └──────────────────────────────┘  │
                                                                    ▼
                                                        D1 (SQLite serverless)
                                                        tabla: pings
```

---

# PARTE 0 — 🤖 AGENTE: crear los archivos del Worker

> Estos 3 archivos viven en una carpeta nueva `worker/` en la raíz del repo. **No** forman parte del build de Vite (Vite solo empaqueta `index.html` + `js/`), así que no afectan la app. Se despliegan aparte con `wrangler`.

### `worker/schema.sql`
```sql
CREATE TABLE IF NOT EXISTS pings (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        TEXT NOT NULL,
  device_id TEXT NOT NULL,
  evt       TEXT NOT NULL,
  v         TEXT
);
CREATE INDEX IF NOT EXISTS idx_device ON pings(device_id);
```

### `worker/worker.js`
```javascript
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
```

### `worker/wrangler.toml`
```toml
name = "gymlog-analytics"
main = "worker.js"
compatibility_date = "2026-07-01"

[[d1_databases]]
binding = "DB"
database_name = "gymlog-analytics"
database_id = "RELLENAR_EN_PARTE_1"   # 🧑 TÚ lo pegas tras crear la D1
```

> Cuando el agente termine la Parte 0, **avisa a Ian** de que ya puede hacer la Parte 1.

---

# PARTE 1 — 🧑 TÚ: configurar y desplegar en Cloudflare

> Es tu primera vez, así que sigue en orden. Todo esto es **gratis** y no pide tarjeta.

### Paso 1.1 — Crear cuenta de Cloudflare
1. Ve a **https://dash.cloudflare.com/sign-up** y crea una cuenta con tu email.
2. Confirma el email. No necesitas añadir ningún dominio ni tarjeta.

### Paso 1.2 — Instalar y autenticar wrangler
`wrangler` es la CLI de Cloudflare. En tu terminal, dentro del repo:
```bash
pnpm add -D wrangler          # instala wrangler como dev-dependency del repo
cd worker                     # todos los comandos wrangler se corren aquí
pnpm exec wrangler login      # abre el navegador para autorizar tu cuenta
```
- Se abrirá una pestaña del navegador → clic en **"Allow"**.
- Al volver a la terminal debe decir algo como *"Successfully logged in"*.

### Paso 1.3 — Crear la base de datos D1
```bash
pnpm exec wrangler d1 create gymlog-analytics
```
Esto imprime un bloque parecido a:
```
[[d1_databases]]
binding = "DB"
database_name = "gymlog-analytics"
database_id = "a1b2c3d4-....-....-....-............"
```
👉 **Copia el valor de `database_id`.**

### Paso 1.4 — Pegar el `database_id` en `wrangler.toml`
Abre `worker/wrangler.toml` y reemplaza `RELLENAR_EN_PARTE_1` por el id que copiaste.
*(Si prefieres, pídele al agente que lo pegue — pero es un cambio de una línea que puedes hacer tú.)*

### Paso 1.5 — Crear la tabla en la D1 (remota)
```bash
pnpm exec wrangler d1 execute gymlog-analytics --remote --file=./schema.sql
```
- El flag `--remote` es **clave**: crea la tabla en la base real (no en una local de prueba).
- Debe decir *"Executed ... queries"* sin errores.

### Paso 1.6 — Desplegar el Worker
```bash
pnpm exec wrangler deploy
```
- Si es tu primer Worker, te pedirá **registrar un subdominio `workers.dev`** (elige cualquier nombre, p. ej. tu usuario). Solo se hace una vez.
- Al terminar imprime la **URL pública** de tu Worker, algo como:
  ```
  https://gymlog-analytics.TU-SUBDOMINIO.workers.dev
  ```
👉 **Copia esa URL completa. Es el dato que necesita el agente para la Parte 2.**

### Paso 1.7 — (Opcional, más adelante) Endurecer
No es necesario para empezar; el candado de origen ya bloquea el abuso casual desde navegadores. Cuando quieras más:
- **Bot Fight Mode** y **rate limiting** nativos requieren conectar un dominio propio a Cloudflare (los subdominios `workers.dev` no los soportan en free). Si algún día compras un dominio, ahí se activan con un toggle.
- **Turnstile** (CAPTCHA invisible) da protección anti-bot real, pero mete un script externo en la PWA y complica el `sendBeacon` → se deja como mejora futura, no ahora.

> Cuando tengas la **URL del Worker** (Paso 1.6), pásasela al agente para la Parte 2.

---

# PARTE 2 — 🤖 AGENTE: cambios en la app

> **Requisito previo:** que Ian haya entregado la URL del Worker (Parte 1, Paso 1.6).
> Antes de codificar, crear rama: `git checkout -b feat/telemetria` (regla de fix workflow).

### 2.1 — `js/db.js` — migración + método dedicado
- **Migración idempotente** junto a las otras `ALTER TABLE` (~línea 62), mismo patrón existente:
  ```sql
  ALTER TABLE conf ADD COLUMN IF NOT EXISTS device_id TEXT;
  ```
- **Método dedicado** en la sección `// ── Conf ──` (junto a `getConf`/`updatePrefUnit`, ~línea 385). Mantiene las mutaciones de `conf` aisladas en `db.js` (OWASP A05) y usa prepared statement:
  ```javascript
  export async function getOrCreateDeviceId() {
    const { rows } = await db.query('SELECT device_id FROM conf WHERE id = 1');
    if (rows[0]?.device_id) return rows[0].device_id;
    const id = crypto.randomUUID();
    await db.query('UPDATE conf SET device_id = $1 WHERE id = 1', [id]);
    return id;
  }
  ```
- **Backup CSV:** ninguna acción. El export en `js/db.js:590` usa lista de columnas explícita (`SELECT pref_unit, pref_acento ...`), así que `device_id` queda **excluido** a propósito: restaurar un backup en otro equipo no debe clonar la identidad del dispositivo.

### 2.2 — `js/telemetria.js` — módulo nuevo (capa de red pura; sin imports de DOM ni de `db`)
```javascript
// Beacon anónimo de uso (fire-and-forget). El device_id llega desde app.js.
const TELEMETRY_URL = 'PEGAR_URL_DEL_WORKER_DE_LA_PARTE_1'; // https://gymlog-analytics.xxx.workers.dev

export const registrarUso = (deviceId, evt = 'open') => {
  if (!navigator.onLine) return;                 // offline-first: sin red, no molesta
  if (location.hostname === 'localhost') return; // no contaminar datos con el dev server
  const payload = JSON.stringify({ id: deviceId, evt, v: '1.0' });
  const blob = new Blob([payload], { type: 'application/json' });
  navigator.sendBeacon(TELEMETRY_URL, blob);
};
```

### 2.3 — `js/app.js` — disparar en el arranque
En `initApp()`, tras `initDB(...)`, añadir `getOrCreateDeviceId` al import existente (línea 81) y disparar **sin `await`** (no bloquea el boot):
```javascript
const { initDB, getConf, getOrCreateDeviceId } = await import('./db.js');
await initDB('idb://gym-log-db');
// ... (conf / acento como ya está) ...
getOrCreateDeviceId().then(id => registrarUso(id, 'open')); // fire-and-forget
```
Con `import { registrarUso } from './telemetria.js';` al inicio del archivo.

### 2.4 — `public/sw.js` — dejar pasar los beacons intactos
`sendBeacon` va como POST; la Cache API ya ignora POST, pero endurecemos el `fetch` handler para que ni los toque. Al inicio del listener (línea 19):
```javascript
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return; // beacons POST pasan directo a la red
  event.respondWith(/* ...lógica actual sin cambios... */);
});
```
Subir `CACHE_NAME` a `'gymlog-v13'` para forzar el reemplazo del SW en dispositivos ya instalados. *(Editar solo `public/sw.js`; Vite copia `public/` → `dist/` en el build.)*

### 2.5 — `tests/db.test.js` — cobertura (instancia `memory://`)
- `getOrCreateDeviceId()` devuelve un UUID válido en la 1ª llamada.
- Es **idempotente**: la 2ª llamada devuelve el mismo id (persistido en `conf`).
- La columna `device_id` existe tras `initDB` (migración aplicada).

---

# PARTE 3 — Verificación (conjunta)

1. 🤖 `pnpm test` → verde (incluye los nuevos tests de `db.test.js`).
2. 🧑 `pnpm run dev` y abrir la app: como `localhost` está excluido, en la pestaña **Network** de DevTools **no** debe salir ningún POST al Worker. *(Este paso lo corres tú.)*
3. 🧑 Prueba real (host distinto de localhost): mergear a `main` para desplegar a GitHub Pages, o probar el build. Abrir la app real → en **Network** debe verse un `sendBeacon` POST **200** a la URL del Worker.
4. 🧑 Confirmar el dato en D1:
   ```bash
   cd worker
   pnpm exec wrangler d1 execute gymlog-analytics --remote \
     --command="SELECT COUNT(*) AS aperturas, COUNT(DISTINCT device_id) AS dispositivos FROM pings"
   ```
   Debe mostrar al menos 1 apertura y 1 dispositivo.
5. 🧑 Abrir la app en un 2º dispositivo/navegador → `dispositivos` sube a 2. Recargar en el mismo → **no** sube (mismo `device_id`).
6. 🧑 Modo avión → abrir app → no se emite beacon (offline-first respetado).

---

# Cómo lees tus métricas (cuando quieras)

Desde `worker/`:
```bash
# Dispositivos únicos y aperturas totales
pnpm exec wrangler d1 execute gymlog-analytics --remote \
  --command="SELECT COUNT(DISTINCT device_id) AS dispositivos, COUNT(*) AS aperturas FROM pings"

# Aperturas por día
pnpm exec wrangler d1 execute gymlog-analytics --remote \
  --command="SELECT substr(ts,1,10) AS dia, COUNT(*) FROM pings GROUP BY dia ORDER BY dia DESC"
```

# Notas

- **Free tier holgadísimo:** Workers 100k req/día · D1 5 GB, 5M lecturas y 100k escrituras/día. Para GymLog sobra por mucho.
- **Privacidad/OWASP:** solo UUID aleatorio, sin PII, sin cookies. `INSERT` con prepared statement (A03). Mutación de `conf` aislada en `db.js` (A05).
- **Seguridad de escritura:** el candado de `Origin` bloquea abuso casual. Para protección "a prueba de determinados" se añadiría Turnstile/rate-limit con un dominio propio (Paso 1.7) — innecesario para uso personal.
- **Archivos nuevos:** `worker/worker.js`, `worker/schema.sql`, `worker/wrangler.toml`, `js/telemetria.js`. Modificados: `js/db.js`, `js/app.js`, `public/sw.js`, `tests/db.test.js`, `package.json` (dev-dep wrangler).
```
