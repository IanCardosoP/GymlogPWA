import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

const BASE = '/GymlogPWA/';
const PLACEHOLDER = '__APP_VERSION__';
// El placeholder de precache va entrecomillado en public/sw.js (`const PRECACHE =
// '__PRECACHE_MANIFEST__';`): se reemplaza el literal completo (comillas incluidas)
// por un array JSON, no un fragmento dentro de otra cadena como __APP_VERSION__.
const PRECACHE_PLACEHOLDER = "'__PRECACHE_MANIFEST__'";
const { version } = JSON.parse(readFileSync('./package.json', 'utf8'));

// El sha hace que CADA deploy tenga un CACHE_NAME distinto aunque nadie suba la
// versión semántica: es lo que garantiza que el Service Worker de los clientes
// tire su caché vieja. La versión sola no basta — es justo lo que se olvida.
function idDeBuild() {
  const sha = process.env.GITHUB_SHA ?? (() => {
    try { return execSync('git rev-parse HEAD').toString().trim(); } catch { return ''; }
  })();
  return sha ? sha.slice(0, 7) : 'local';
}

// Vite copia public/sw.js tal cual (no sustituye variables ahí), así que el sello
// se estampa sobre el archivo ya emitido: closeBundle corre después de esa copia.
function selloDeVersion() {
  // Capturado en generateBundle (sí recibe `bundle`) y consumido en closeBundle
  // (no lo recibe) — de ahí el estado de closure entre ambos hooks.
  let precacheDelShell = [];

  return {
    name: 'sello-de-version',
    apply: 'build',
    generateBundle(_options, bundle) {
      // Nota: en esta versión de Vite/rolldown, `index.html` NO aparece entre
      // las keys de `bundle` en generateBundle (se escribe por una vía
      // aparte) — por eso se añade a mano en closeBundle, igual que
      // manifest.json. Aquí solo se capturan los JS/CSS hasheados.
      precacheDelShell = Object.keys(bundle)
        // El catálogo (public/assets/catalogo/**) y sw.js no pasan por el
        // bundle de Rollup (los copia Vite tal cual desde public/), pero se
        // excluyen igual como seguro explícito: el catálogo jamás se
        // precachea (regla no negociable de CLAUDE.md) y sw.js no se
        // autoprecachea a sí mismo.
        .filter(key => !key.startsWith('assets/catalogo/') && key !== 'sw.js')
        .filter(key => key.endsWith('.js') || key.endsWith('.css'))
        .map(key => `${BASE}${key}`);
    },
    closeBundle() {
      const ruta = 'dist/sw.js';
      let fuente = readFileSync(ruta, 'utf8');

      if (!fuente.includes(PLACEHOLDER)) {
        throw new Error(
          `sw.js no contiene ${PLACEHOLDER}: alguien fijó el CACHE_NAME a mano. ` +
          'Restaura el placeholder o el caché de los clientes dejará de invalidarse.'
        );
      }
      const sello = `${version}+${idDeBuild()}`;
      fuente = fuente.replaceAll(PLACEHOLDER, sello);

      if (!fuente.includes(PRECACHE_PLACEHOLDER)) {
        throw new Error(
          `sw.js no contiene ${PRECACHE_PLACEHOLDER}: alguien fijó PRECACHE a mano. ` +
          'Restaura el placeholder o el shell dejará de precachearse en el install.'
        );
      }
      // La entrada del scope (BASE sola, sin sufijo) es la que hace que el
      // fallback de navegación (`caches.match(self.registration.scope)`)
      // siempre acierte, aunque el usuario nunca haya pedido `index.html`.
      // Set: index.html se añade a mano (ver nota en generateBundle) y podría
      // duplicarse si una versión futura de Vite sí la incluyera en `bundle`.
      // manifest.json, appUrl.png y los dos íconos vienen de public/ (no
      // pasan por el bundle) pero SÍ se referencian en runtime — el QR del
      // resumen de sesión (diario.js) y el manifest de instalación (PWA) los
      // necesitan offline. icons/ascii-end.txt y motiv.txt quedan fuera: se
      // inlinean en el bundle vía imports `?raw`, no se piden por red.
      const lista = [...new Set([
        BASE, `${BASE}index.html`, ...precacheDelShell,
        `${BASE}manifest.json`,
        `${BASE}assets/appUrl.png`,
        `${BASE}icons/icon-192.svg`,
        `${BASE}icons/icon-512.svg`,
      ])];
      fuente = fuente.replaceAll(PRECACHE_PLACEHOLDER, JSON.stringify(lista));

      writeFileSync(ruta, fuente);
      this.info(`CACHE_NAME → gymlog-v${sello}`);
      this.info(`PRECACHE → ${lista.length} entradas`);
    },
  };
}

export default defineConfig({
  base: BASE,
  build: { outDir: 'dist' },
  plugins: [selloDeVersion()],
});
