import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../..', import.meta.url));

// Build único para toda la corrida. tests/precache.test.js y
// tests/sw-ciclo-deploy.test.js dependen del dist/sw.js sellado; si cada uno
// lanzara su propio `pnpm run build`, correrían en paralelo (pool: 'forks')
// sobre el mismo dist/ y se pisarían — y los hashes de contenido de rolldown no
// son estables entre builds, así que un archivo podría leer el manifiesto de un
// build y las rutas de otro. Cuesta ~1.4 s.
export default function setup() {
  execFileSync('pnpm', ['run', 'build'], { cwd: RAIZ, stdio: 'pipe' });
}
