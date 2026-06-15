import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

describe('PGLite smoke test', () => {
  it('ejecuta SQL básico en memoria', async () => {
    const db = new PGlite('memory://');
    const result = await db.query('SELECT 1+1 AS result');
    expect(result.rows[0].result).toBe(2);
    await db.close();
  });
});
