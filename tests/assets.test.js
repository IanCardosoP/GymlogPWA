import { describe, it, expect } from 'vitest';
import { openSync, readSync, closeSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Integridad binaria de los assets de imagen que la app sirve tal cual.
// Motivado por un caso real: un .webp del catálogo llegó corrupto al repo
// (bytes basura sin cabecera RIFF) y se renderizaba en blanco en todos los
// dispositivos. Leer solo la firma mantiene el test barato (~1750 archivos).

const IMG_DIR = fileURLToPath(new URL('../public/assets/catalogo/img', import.meta.url));
const QR_PNG  = fileURLToPath(new URL('../public/assets/appUrl.png', import.meta.url));

const leerFirma = (ruta, bytes) => {
  const buf = Buffer.alloc(bytes);
  const fd = openSync(ruta, 'r');
  readSync(fd, buf, 0, bytes, 0);
  closeSync(fd);
  return buf;
};

describe('assets de imagen (integridad binaria)', () => {
  it('todos los .webp del catálogo tienen firma RIFF....WEBP', () => {
    const archivos = readdirSync(IMG_DIR).filter(f => f.endsWith('.webp'));
    expect(archivos.length).toBeGreaterThanOrEqual(1746);
    const corruptos = archivos.filter(f => {
      const firma = leerFirma(join(IMG_DIR, f), 12);
      return firma.toString('ascii', 0, 4) !== 'RIFF' || firma.toString('ascii', 8, 12) !== 'WEBP';
    });
    expect(corruptos, `webp corruptos: ${corruptos.join(', ')}`).toEqual([]);
  });

  it('el PNG del QR tiene firma PNG válida', () => {
    const firma = leerFirma(QR_PNG, 8);
    expect([...firma]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
});
