import { describe, it, expect } from 'vitest';
import { detectOS } from '../js/telemetria.js';

const UA_IPHONE  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const UA_IPAD    = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0';
const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0';

describe('detectOS', () => {
  it('detecta iOS en iPhone', () => {
    expect(detectOS(UA_IPHONE)).toBe('ios');
  });

  it('detecta iOS en iPad', () => {
    expect(detectOS(UA_IPAD)).toBe('ios');
  });

  it('detecta Android', () => {
    expect(detectOS(UA_ANDROID)).toBe('android');
  });

  it('retorna "other" en desktop', () => {
    expect(detectOS(UA_DESKTOP)).toBe('other');
  });

  it('retorna "other" con user-agent vacío o ausente', () => {
    expect(detectOS('')).toBe('other');
    expect(detectOS()).toBe('other');
  });
});
