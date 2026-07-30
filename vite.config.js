import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

const BASE = '/GymlogPWA/';
const PLACEHOLDER = '__APP_VERSION__';
// Los placeholders de precache van entrecomillados en public/sw.js (`const
// PRECACHE_SHELL = '__PRECACHE_SHELL__';`): se reemplaza el literal completo
// (comillas incluidas) por un array JSON, no un fragmento dentro de otra cadena
// como __APP_VERSION__.
const SHELL_PLACEHOLDER  = "'__PRECACHE_SHELL__'";
const ASSETS_PLACEHOLDER = "'__PRECACHE_ASSETS__'";
const LEGADO_PLACEHOLDER = "'__ASSETS_LEGADO__'";

// Artefactos del motor LEGADO (PGLite): 16.2 MB que solo hacen falta una vez, y
// solo a quien viene de una versión anterior, para migrar sus datos a SQLite.
// No se precachean (un usuario nuevo no debe bajar 16 MB de un motor que nunca
// va a usar) pero TAMPOCO se podan: quien ya los tenga cacheados de la versión
// anterior debe poder migrar sin red. Se retiran del todo en la fase de limpieza,
// cuando ya nadie quede sin migrar.
const esMotorLegado = clave => /(^|\/)(pglite|initdb)-/.test(clave);
const { version } = JSON.parse(readFileSync('./package.json', 'utf8'));

// El sha hace que CADA deploy tenga un SHELL_CACHE distinto aunque nadie suba la
// versión semántica: es lo que garantiza que los clientes tiren su copia vieja
// de index.html. La versión sola no basta — es justo lo que se olvida.
//
// Ojo: esto aplica SOLO al shell. La caché de assets hasheados (gymlog-assets)
// es deliberadamente independiente del sello y NO se invalida por deploy: sus
// nombres ya llevan hash de contenido, así que invalidarla por sha era
// exactamente el bug que dejaba a los iPhones sin poder arrancar offline.
function idDeBuild() {
  const sha = process.env.GITHUB_SHA ?? (() => {
    try { return execSync('git rev-parse HEAD').toString().trim(); } catch { return ''; }
  })();
  return sha ? sha.slice(0, 7) : 'local';
}

// El mismo sello alimenta el CACHE_NAME del SW y la telemetría, así que se calcula
// una sola vez: si divergieran, el monitor reportaría una versión distinta de la
// que el dispositivo tiene realmente cacheada.
const SELLO = `${version}+${idDeBuild()}`;

// Vite copia public/sw.js tal cual (no sustituye variables ahí), así que el sello
// se estampa sobre el archivo ya emitido: closeBundle corre después de esa copia.
function selloDeVersion() {
  // Capturado en generateBundle (sí recibe `bundle`) y consumido en closeBundle
  // (no lo recibe) — de ahí el estado de closure entre ambos hooks.
  let assetsHasheados = [];

  return {
    name: 'sello-de-version',
    apply: 'build',
    generateBundle(_options, bundle) {
      // Nota: en esta versión de Vite/rolldown, `index.html` NO aparece entre
      // las keys de `bundle` en generateBundle (se escribe por una vía
      // aparte) — por eso se añade a mano en closeBundle, igual que
      // manifest.json. Todo lo que SÍ emite Rollup lleva hash de contenido en
      // el nombre y vive plano bajo `assets/`.
      //
      // DENYLIST, no allowlist. Antes esto filtraba por `.js`/`.css`, y ese
      // filtro dejaba fuera del precache los artefactos de PGLite
      // (pglite.wasm 9.7 MB, pglite.data 6.1 MB, initdb.wasm) y las fuentes
      // .woff2 — los bytes SIN los que la app no arranca. Solo se cacheaban al
      // vuelo, en la caché versionada que activate() borra en cada deploy: de
      // ahí la pantalla en blanco offline en iOS. Excluir a mano y dejar pasar
      // todo lo demás falla del lado seguro; una allowlist de extensiones
      // vuelve a olvidarse del siguiente formato que aparezca.
      assetsHasheados = Object.keys(bundle)
        // El catálogo (public/assets/catalogo/**) y sw.js no pasan por el
        // bundle de Rollup (los copia Vite tal cual desde public/), pero se
        // excluyen igual como seguro explícito: el catálogo jamás se
        // precachea (regla no negociable de CLAUDE.md) y sw.js no se
        // autoprecachea a sí mismo.
        .filter(key => !key.startsWith('assets/catalogo/') && key !== 'sw.js')
        // Sourcemaps: no se generan hoy, pero si alguien los activa no tienen
        // por qué ocupar cuota offline en el móvil del usuario.
        .filter(key => !key.endsWith('.map'))
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
      fuente = fuente.replaceAll(PLACEHOLDER, SELLO);

      for (const ph of [SHELL_PLACEHOLDER, ASSETS_PLACEHOLDER, LEGADO_PLACEHOLDER]) {
        if (!fuente.includes(ph)) {
          throw new Error(
            `sw.js no contiene ${ph}: alguien fijó el manifiesto a mano. ` +
            'Restaura el placeholder o dejará de precachearse en el install.'
          );
        }
      }

      // Los dos manifiestos se parten por MUTABILIDAD, no por tipo de archivo:
      //  - shell  → nombres fijos que cambian de contenido en cada deploy.
      //             Van a gymlog-shell-v<sello>, que activate() borra entera.
      //  - assets → todo lo que Vite emite con hash de contenido en el nombre,
      //             o sea inmutable. Va a gymlog-assets, SIN versión, que
      //             activate() poda contra este manifiesto en vez de borrar.
      //             Por eso un deploy que no toca PGLite conserva sus 16 MB y
      //             no los vuelve a bajar nunca.
      //
      // La entrada del scope (BASE sola, sin sufijo) es la que hace que el
      // fallback de navegación (`caches.match(self.registration.scope)`)
      // siempre acierte, aunque el usuario nunca haya pedido `index.html`.
      // Set: index.html se añade a mano (ver nota en generateBundle) y podría
      // duplicarse si una versión futura de Vite sí la incluyera en `bundle`.
      // manifest.json y los dos íconos vienen de public/ (no pasan por el
      // bundle) pero SÍ se piden por red en runtime — el manifest de
      // instalación (PWA) los referencia. assets/appUrl.png NO va acá:
      // diario.js lo importa con `?inline` (data URI embebido en el JS del
      // bundle), así que nunca se pide por red — el archivo en public/ solo
      // queda como fuente del import, no como asset servido. icons/ascii-end.txt
      // y motiv.txt quedan fuera por lo mismo: se inlinean vía `?raw`.
      const shell = [...new Set([
        BASE, `${BASE}index.html`,
        `${BASE}manifest.json`,
        `${BASE}icons/icon-192.svg`,
        `${BASE}icons/icon-512.svg`,
      ])];
      const todos = [...new Set(assetsHasheados)];
      const assets = todos.filter(u => !esMotorLegado(u));
      const legado = todos.filter(esMotorLegado);

      // Guard de regresión en el propio build: si el motor de la base de datos no
      // está en el manifiesto de assets, la app no puede arrancar offline y no
      // tiene sentido publicar ese build. Es el seguro contra volver a introducir
      // una allowlist de extensiones en generateBundle. Cuenta solo el motor
      // VIGENTE: si algún día el filtro dejara pasar únicamente el legado, esto
      // seguiría fallando, que es lo que se quiere.
      const motor = assets.filter(u => u.endsWith('.wasm') || u.endsWith('.data'));
      if (motor.length === 0) {
        throw new Error(
          'El manifiesto de assets no contiene ningún .wasm/.data vigente: el motor ' +
          'de la base de datos quedaría fuera del precache y la app no arrancaría ' +
          'sin red. Revisa los filtros de generateBundle en vite.config.js.'
        );
      }

      fuente = fuente.replaceAll(SHELL_PLACEHOLDER, JSON.stringify(shell));
      fuente = fuente.replaceAll(ASSETS_PLACEHOLDER, JSON.stringify(assets));
      fuente = fuente.replaceAll(LEGADO_PLACEHOLDER, JSON.stringify(legado));

      writeFileSync(ruta, fuente);
      this.info(`SHELL_CACHE → gymlog-shell-v${SELLO}`);
      this.info(`PRECACHE_SHELL  → ${shell.length} entradas`);
      this.info(`PRECACHE_ASSETS → ${assets.length} entradas (${motor.length} del motor)`);
      this.info(`ASSETS_LEGADO   → ${legado.length} entradas (no se precachean, no se podan)`);
    },
  };
}

export default defineConfig({
  base: BASE,
  build: { outDir: 'dist' },
  // La telemetría necesita la versión REAL de la app. Estaba hardcodeada a '1.0'
  // en telemetria.js, así que el monitor no podía distinguir qué versión abría
  // cada dispositivo — justo el dato que hace falta para saber si un iPhone ya
  // recibió el arreglo. Nombre distinto de __APP_VERSION__ a propósito: ese lo
  // sella el plugin sobre dist/sw.js, que Vite copia verbatim y define no toca.
  define: { __GYMLOG_VERSION__: JSON.stringify(SELLO) },
  plugins: [selloDeVersion()],
});
