import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',
    // Sella dist/sw.js una sola vez antes de la corrida: lo consumen
    // tests/precache.test.js y tests/sw-ciclo-deploy.test.js.
    globalSetup: ['./tests/setup/build.js'],
  },
});
