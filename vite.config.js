import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

const PLACEHOLDER = '__APP_VERSION__';
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
  return {
    name: 'sello-de-version',
    apply: 'build',
    closeBundle() {
      const ruta = 'dist/sw.js';
      const fuente = readFileSync(ruta, 'utf8');
      if (!fuente.includes(PLACEHOLDER)) {
        throw new Error(
          `sw.js no contiene ${PLACEHOLDER}: alguien fijó el CACHE_NAME a mano. ` +
          'Restaura el placeholder o el caché de los clientes dejará de invalidarse.'
        );
      }
      const sello = `${version}+${idDeBuild()}`;
      writeFileSync(ruta, fuente.replaceAll(PLACEHOLDER, sello));
      this.info(`CACHE_NAME → gymlog-v${sello}`);
    },
  };
}

export default defineConfig({
  base: '/GymlogPWA/',
  build: { outDir: 'dist' },
  plugins: [selloDeVersion()],
});
