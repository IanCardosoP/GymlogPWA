# Cómo consultar la telemetría (D1) — guía rápida

> Esto NO es para correr una vez y olvidarse: es tu tablero de comando. Guardá este archivo,
> volvé cuando quieras saber "¿cuánta gente usa GymLog?".

## 0. Antes de nada — dos reglas para no pelearte con `wrangler`

**Regla 1 — siempre pasá `--config` con ruta absoluta.**
Esta versión de `wrangler` (4.110.0) tiene un bug: aunque tu terminal esté parada en
`worker/`, si no le pasás `--config` explícito busca la configuración desde la raíz del
repo y se confunde con el `vite.config.js` de la PWA. Para evitarlo, todos los comandos de
esta guía incluyen:

```
--config /home/ian/Code/GymlogPWA/worker/wrangler.toml
```

Copiá y pegá los comandos tal cual — no los acortes sacando el `--config`.

**Regla 2 — siempre pasá `--remote`.**
Sin `--remote`, `wrangler d1 execute` consulta una base local de prueba en tu disco
(vacía) en vez de la base real donde caen los pings de la app. Todos los comandos de abajo
ya lo incluyen.

Parado en cualquier carpeta, podés correr los comandos tal cual (no hace falta `cd worker`
si usás la ruta absoluta del `--config`).

Usar la ejecucion de paquetes

pnpm exec ...

---

## 1. El esquema — qué guarda cada ping

Tabla `pings` (ver `worker/schema.sql`):

| Columna     | Qué es                                                              |
|-------------|----------------------------------------------------------------------|
| `id`        | autoincremental, no importa                                          |
| `ts`        | fecha/hora UTC en formato ISO (`2026-07-12T03:04:55.549Z`)           |
| `device_id` | UUID anónimo, uno por instalación (persistido en `conf` de la app)   |
| `evt`       | tipo de evento — hoy solo `'open'`                                   |
| `v`         | versión de la app que mandó el ping (`'1.0'`)                        |
| `pwa`       | `1` = se abrió como app instalada (standalone), `0` = pestaña de navegador |
| `os`        | `'ios'` \| `'android'` \| `'other'` (desktop, o no se pudo detectar) |

No hay nombres, emails, IPs ni ubicación — el `device_id` es el único identificador y no se
puede rastrear a una persona.

---

## 2. Las 6 preguntas que probablemente quieras responder

### "¿Cuánta gente usa la app en total?" — dispositivos únicos

```bash
pnpm exec wrangler d1 execute gymlog-analytics --config /home/ian/Code/GymlogPWA/worker/wrangler.toml --remote \
  --command="SELECT COUNT(DISTINCT device_id) AS dispositivos_unicos FROM pings"
```

### "¿Cuánto se usa en total?" — aperturas totales

```bash
pnpm exec wrangler d1 execute gymlog-analytics --config /home/ian/Code/GymlogPWA/worker/wrangler.toml --remote \
  --command="SELECT COUNT(*) AS aperturas_totales FROM pings"
```

### "¿Cómo viene la actividad día a día?" — aperturas y dispositivos únicos por día

```bash
pnpm exec wrangler d1 execute gymlog-analytics --config /home/ian/Code/GymlogPWA/worker/wrangler.toml --remote \
  --command="SELECT substr(ts,1,10) AS dia, COUNT(*) AS aperturas, COUNT(DISTINCT device_id) AS dispositivos FROM pings GROUP BY dia ORDER BY dia DESC LIMIT 30"
```

Esto es lo más parecido a un "usuarios activos por día" (DAU) que vas a tener.

### "¿La gente instala la app o la usa desde el navegador?"

```bash
pnpm exec wrangler d1 execute gymlog-analytics --config /home/ian/Code/GymlogPWA/worker/wrangler.toml --remote \
  --command="SELECT CASE pwa WHEN 1 THEN 'instalada (PWA)' ELSE 'navegador' END AS modo, COUNT(DISTINCT device_id) AS dispositivos FROM pings GROUP BY pwa"
```

### "¿iOS o Android?"

```bash
pnpm exec wrangler d1 execute gymlog-analytics --config /home/ian/Code/GymlogPWA/worker/wrangler.toml --remote \
  --command="SELECT os, COUNT(DISTINCT device_id) AS dispositivos FROM pings GROUP BY os ORDER BY dispositivos DESC"
```

### "¿Cuánto hace que un dispositivo no vuelve?" — retención simple

Primera y última vez que se vio cada dispositivo (útil para ver quién "se fue"):

```bash
pnpm exec wrangler d1 execute gymlog-analytics --config /home/ian/Code/GymlogPWA/worker/wrangler.toml --remote \
  --command="SELECT device_id, MIN(substr(ts,1,10)) AS primera_vez, MAX(substr(ts,1,10)) AS ultima_vez, COUNT(*) AS aperturas FROM pings GROUP BY device_id ORDER BY ultima_vez DESC"
```

---

## 3. Para debug — ver los últimos pings crudos

Cuando probás algo nuevo (por ejemplo, un dispositivo recién agregado) y querés confirmar
que el beacon llegó, sin agrupar nada:

```bash
pnpm exec wrangler d1 execute gymlog-analytics --config /home/ian/Code/GymlogPWA/worker/wrangler.toml --remote \
  --command="SELECT ts, device_id, evt, pwa, os FROM pings ORDER BY id DESC LIMIT 20"
```

---

## 4. Ver los logs del Worker en vivo (opcional)

Si querés ver en tiempo real cada request que le llega al Worker (útil para confirmar que
un beacon recién enviado desde el celular efectivamente pasó el candado de `Origin`):

```bash
pnpm exec wrangler tail gymlog-analytics --config /home/ian/Code/GymlogPWA/worker/wrangler.toml
```

Dejalo corriendo, abrí la app en el celular, y mirá la terminal.

---

## 5. Notas

- **Free tier:** D1 permite 5M lecturas y 100k escrituras por día — con estas consultas
  (lecturas ocasionales) ni te acercás al límite.
- **Nada de esto bloquea el uso offline de la app.** Estas queries solo leen la copia que
  ya llegó al servidor; la app sigue funcionando 100% local aunque nunca las corras.
- Si agregás un nuevo tipo de evento (`evt`) en el futuro, simplemente agregá `WHERE evt = '...'`
  a cualquiera de estas queries para filtrarlo.
