// Monitor local de telemetría GymLog — herramienta personal, nunca se despliega.
// Hace de puente entre el dashboard (browser) y `wrangler d1 execute`, reusando
// la sesión de wrangler ya autenticada en esta máquina (sin tokens propios).
import express from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ETIQUETAS } from './etiquetas.js';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const WORKER_DIR = path.join(REPO_ROOT, 'worker');
const WRANGLER_CONFIG = path.join(WORKER_DIR, 'wrangler.toml');
const DB_NAME = 'gymlog-analytics';
const PORT = process.env.PORT || 5959;

// Todas las queries van en un solo `wrangler d1 execute` (una query por ';'),
// wrangler --json devuelve un array de resultados en el mismo orden.
const QUERIES = [
  ['overview', `
    SELECT COUNT(DISTINCT device_id) AS dispositivos, COUNT(*) AS aperturas FROM pings
  `],
  ['hoy', `
    SELECT
      (SELECT COUNT(DISTINCT device_id) FROM pings WHERE substr(ts,1,10) = date('now')) AS activos_hoy,
      (SELECT COUNT(*) FROM (
         SELECT device_id, MIN(substr(ts,1,10)) AS primera_vez FROM pings GROUP BY device_id
       ) WHERE primera_vez = date('now')) AS nuevos_hoy
  `],
  ['diario', `
    SELECT substr(ts,1,10) AS dia, COUNT(*) AS aperturas, COUNT(DISTINCT device_id) AS dispositivos
    FROM pings
    WHERE substr(ts,1,10) >= date('now', '-30 days')
    GROUP BY dia ORDER BY dia ASC
  `],
  ['tendencia', `
    WITH first_seen AS (
      SELECT device_id, MIN(substr(ts,1,10)) AS primera_vez FROM pings GROUP BY device_id
    ), daily_devices AS (
      SELECT DISTINCT substr(ts,1,10) AS dia, device_id FROM pings
      WHERE substr(ts,1,10) >= date('now', '-30 days')
    )
    SELECT dd.dia,
      SUM(CASE WHEN fs.primera_vez = dd.dia THEN 1 ELSE 0 END) AS nuevos,
      SUM(CASE WHEN fs.primera_vez <  dd.dia THEN 1 ELSE 0 END) AS recurrentes
    FROM daily_devices dd JOIN first_seen fs ON fs.device_id = dd.device_id
    GROUP BY dd.dia ORDER BY dd.dia ASC
  `],
  ['os', `
    SELECT os, COUNT(DISTINCT device_id) AS dispositivos FROM pings GROUP BY os ORDER BY dispositivos DESC
  `],
  ['pwa', `
    SELECT pwa, COUNT(*) AS aperturas FROM pings GROUP BY pwa
  `],
  // La versión, el os y el modo se toman del ping MÁS RECIENTE de cada
  // dispositivo (subconsulta por id DESC), no de un MAX() alfabético: lo que
  // interesa es qué está corriendo ahora, no qué corrió alguna vez.
  ['topDevices', `
    SELECT p.device_id,
           COUNT(*) AS aperturas,
           MIN(substr(p.ts,1,10)) AS primera_vez,
           MAX(substr(p.ts,1,10)) AS ultima_vez,
           (SELECT x.v   FROM pings x WHERE x.device_id = p.device_id ORDER BY x.id DESC LIMIT 1) AS version,
           (SELECT x.os  FROM pings x WHERE x.device_id = p.device_id ORDER BY x.id DESC LIMIT 1) AS os,
           (SELECT x.pwa FROM pings x WHERE x.device_id = p.device_id ORDER BY x.id DESC LIMIT 1) AS pwa
    FROM pings p GROUP BY p.device_id ORDER BY aperturas DESC LIMIT 30
  `],
  // Distribución de versiones: cuántos dispositivos siguen en una versión vieja.
  // Es la respuesta directa a «¿ya llegó el arreglo a todos?».
  ['versiones', `
    SELECT COALESCE(ultima_v, '(sin dato)') AS version,
           COUNT(*) AS dispositivos,
           SUM(CASE WHEN os = 'ios' THEN 1 ELSE 0 END) AS ios,
           MAX(ultimo_ts) AS ultima_vez
    FROM (
      SELECT device_id,
             (SELECT x.v  FROM pings x WHERE x.device_id = p.device_id ORDER BY x.id DESC LIMIT 1) AS ultima_v,
             (SELECT x.os FROM pings x WHERE x.device_id = p.device_id ORDER BY x.id DESC LIMIT 1) AS os,
             MAX(substr(p.ts,1,16)) AS ultimo_ts
      FROM pings p GROUP BY device_id
    ) GROUP BY version ORDER BY dispositivos DESC
  `],
  // Fallos de arranque (evt = 'boot_fail:<motivo>'). OJO al leerlos: el fallo
  // offline NO puede mandar beacon (sin red no hay a dónde), así que lo que
  // aparece acá son fallos CON red — o sea, problemas distintos del bug de caché
  // original. Vacío no prueba que ese bug esté arreglado.
  ['fallos', `
    SELECT evt AS motivo, os, pwa, v AS version,
           COUNT(*) AS veces, MAX(substr(ts,1,16)) AS ultima_vez
    FROM pings WHERE evt LIKE 'boot_fail%'
    GROUP BY evt, os, pwa, v ORDER BY veces DESC LIMIT 30
  `],
  ['fallosDiarios', `
    SELECT substr(ts,1,10) AS dia, COUNT(*) AS fallos
    FROM pings
    WHERE evt LIKE 'boot_fail%' AND substr(ts,1,10) >= date('now', '-30 days')
    GROUP BY dia ORDER BY dia ASC
  `],
  ['logs', `
    SELECT ts, device_id, evt, pwa, os, v AS version FROM pings ORDER BY id DESC LIMIT 50
  `],
];

async function runQueries() {
  const combined = QUERIES.map(([, sql]) => sql.trim()).join('; ');
  const { stdout } = await execFileAsync(
    'pnpm',
    ['exec', 'wrangler', 'd1', 'execute', DB_NAME,
      '--config', WRANGLER_CONFIG,
      '--remote', '--json',
      '--command', combined],
    { cwd: WORKER_DIR, maxBuffer: 10 * 1024 * 1024, timeout: 30_000 }
  );

  const parsed = JSON.parse(stdout);
  const out = {};
  QUERIES.forEach(([key], i) => {
    out[key] = parsed[i]?.results ?? [];
  });
  return out;
}

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
// Chart.js servido local (sin depender de un CDN externo)
app.get('/vendor/chart.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules/chart.js/dist/chart.umd.js'));
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const data = await runQueries();
    // Las etiquetas viajan al cliente para que el dashboard resuelva nombres sin
    // otra ida y vuelta. Nunca se escriben en D1: la telemetría es anónima.
    res.json({ ok: true, data, etiquetas: ETIQUETAS, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err.stderr || err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`GymLog Monitor → http://localhost:${PORT}`);
});
