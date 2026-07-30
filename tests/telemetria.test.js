import { describe, it, expect, vi, afterEach } from 'vitest';
import { detectOS, registrarFalloArranque } from '../js/telemetria.js';

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

// registrarFalloArranque corre cuando la app NO pudo iniciar: sin este evento,
// un iPhone que no arranca es indistinguible de un iPhone que nadie abrió.
describe('registrarFalloArranque', () => {
  const enviados = [];

  const montarNavegador = ({ onLine = true, hostname = 'iancardosop.github.io' } = {}) => {
    enviados.length = 0;
    // stubGlobal y no asignación directa: en Node 22 globalThis.navigator es una
    // propiedad solo-getter y asignarla lanza TypeError.
    vi.stubGlobal('navigator', {
      onLine,
      userAgent: UA_IPHONE,
      sendBeacon: (_url, blob) => { enviados.push(blob); return true; },
      standalone: true,
    });
    vi.stubGlobal('location', { hostname });
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    vi.stubGlobal('Blob', class { constructor(partes) { this.texto = partes.join(''); } });
  };

  afterEach(() => { vi.unstubAllGlobals(); });

  it('manda el evento con el código de motivo', () => {
    montarNavegador();
    registrarFalloArranque('motor');

    expect(enviados.length).toBe(1);
    expect(JSON.parse(enviados[0].texto).evt).toBe('boot_fail:motor');
  });

  it('un motivo fuera del conjunto cerrado cae a "db" (nunca string arbitrario)', () => {
    // Mismo criterio que el whitelist del worker: el mensaje de un error puede
    // traer una URL o la respuesta de un servidor, y eso no se guarda en D1.
    montarNavegador();
    registrarFalloArranque('<script>alert(1)</script>');

    expect(JSON.parse(enviados[0].texto).evt).toBe('boot_fail:db');
  });

  it('no manda nada sin conexión ni desde localhost', () => {
    montarNavegador({ onLine: false });
    registrarFalloArranque('motor');
    expect(enviados.length).toBe(0);

    montarNavegador({ hostname: 'localhost' });
    registrarFalloArranque('motor');
    expect(enviados.length).toBe(0);
  });

  it('reporta el OS y si la PWA está instalada (es el corte que importa en iOS)', () => {
    montarNavegador();
    registrarFalloArranque('sin-red');

    const payload = JSON.parse(enviados[0].texto);
    expect(payload.os).toBe('ios');
    expect(payload.pwa).toBe(true);
    expect(payload.id).toBe(''); // sin base de datos no hay device_id
  });
});
