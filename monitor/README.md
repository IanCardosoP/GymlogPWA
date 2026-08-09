# GymLog Monitor (local, personal)

Dashboard local para ver gráficamente la telemetría de GymLog. No se despliega ni se
commitea — vive solo en tu máquina (`monitor/` está en `.gitignore`).

## Cómo correrlo

```bash
cd monitor
pnpm install   # solo la primera vez
pnpm start
```

Abrí **http://localhost:5959**.

## Cómo funciona

- `server.js` es un servidor Express chiquito. Cuando el browser pide `/api/dashboard`,
  corre por vos un solo `wrangler d1 execute ... --json` con todas las queries juntas
  (separadas por `;`) contra la D1 real (`--remote`), y devuelve todo como JSON.
- Reusa tu sesión de `wrangler login` ya activa en esta máquina — no hay tokens propios
  guardados acá.
- El frontend (`public/`) es HTML + CSS + JS plano, sin build, con Chart.js servido local
  (no depende de un CDN).
- Auto-refresca cada 60s (toggle arriba a la derecha), o botón `[ REFRESCAR ]` manual.

## Qué muestra

- **Cards**: dispositivos únicos totales, aperturas totales, nuevos hoy, activos hoy.
- **Actividad diaria (30 días)**: aperturas + dispositivos únicos por día.
- **Nuevos vs. recurrentes (30 días)**: cuántos dispositivos son primera vez vs. ya conocidos, por día.
- **Sistema operativo** y **PWA instalada vs. navegador**: donas de distribución.
- **Top dispositivos**: los más activos, con primera/última vez.
- **Copiar un device_id**: las celdas de usuario/ID salen abreviadas, pero un clic
  copia el UUID completo al portapapeles (para pegarlo en `etiquetas.js`).
- **Log en vivo**: últimos 50 pings crudos.

## Si algo falla

El banner rojo arriba te dice si `wrangler` no está autenticado — corré
`wrangler login` desde `../worker/` y refrescá.
