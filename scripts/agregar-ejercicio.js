#!/usr/bin/env node
// CLI para añadir un ejercicio al catálogo (public/assets/catalogo/).
//
//   pnpm run catalogo:add
//
// Pide los datos por consola, procesa las 2 imágenes (redimensiona a 192px de
// ancho y convierte a WebP, igual que el resto del catálogo) y actualiza
// catalogo.json e instrucciones.json.
//
// Los cambios quedan en el working tree: revísalos, corre `pnpm test` y
// commitea. Los usuarios verán el ejercicio nuevo en el próximo deploy —
// recuerda subir CACHE_NAME en public/sw.js para invalidar su caché.

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR_CATALOGO = resolve(RAIZ, 'public/assets/catalogo');
const F_CATALOGO = resolve(DIR_CATALOGO, 'catalogo.json');
const F_INSTRUCCIONES = resolve(DIR_CATALOGO, 'instrucciones.json');
const DIR_IMG = resolve(DIR_CATALOGO, 'img');

// Espejo de GRUPOS_MUSCULARES (js/componentes/catalogoModal.js)
const GRUPOS = ['PECHO', 'ESPALDA', 'PIERNA', 'HOMBRO', 'BRAZO', 'CORE', 'GENERAL'];

const ANCHO_WEBP = 192;   // mismo tamaño que el resto del catálogo
const CALIDAD_WEBP = 72;

const rl = createInterface({ input: stdin, output: stdout });

// Cola propia de líneas: con la entrada por tubería (`printf ... | pnpm run
// catalogo:add`), readline emite todas las líneas de golpe y las que llegan sin
// una pregunta pendiente se perderían. Encolarlas hace que el script funcione
// igual de forma interactiva que automatizado.
const pendientes = [];
let esperando = null;
let cerrado = false;

rl.on('line', (linea) => {
  if (esperando) {
    const resolver = esperando;
    esperando = null;
    resolver(linea);
  } else {
    pendientes.push(linea);
  }
});
rl.on('close', () => {
  cerrado = true;
  if (esperando) {
    const resolver = esperando;
    esperando = null;
    resolver(null); // EOF
  }
});

function leerLinea() {
  if (pendientes.length > 0) return Promise.resolve(pendientes.shift());
  if (cerrado) return Promise.resolve(null);
  return new Promise((resolver) => { esperando = resolver; });
}

const c = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  verde: (s) => `\x1b[32m${s}\x1b[0m`,
  rojo: (s) => `\x1b[31m${s}\x1b[0m`,
  cian: (s) => `\x1b[36m${s}\x1b[0m`,
};

async function prompt(texto) {
  stdout.write(texto);
  const linea = await leerLinea();
  if (linea === null) throw new Error('Entrada terminada de forma inesperada (EOF).');
  return linea.trim();
}

async function preguntar(etiqueta, { requerido = true, defecto = null } = {}) {
  const sufijo = defecto ? c.dim(` (${defecto})`) : '';
  for (;;) {
    const valor = await prompt(`${c.cian('›')} ${etiqueta}${sufijo}: `);
    if (valor) return valor;
    if (defecto) return defecto;
    if (!requerido) return '';
    console.log(c.rojo('  Este campo es obligatorio.'));
  }
}

async function elegir(etiqueta, opciones) {
  console.log(`\n${c.bold(etiqueta)}`);
  opciones.forEach((o, i) => console.log(`  ${c.dim(String(i + 1).padStart(2))}. ${o}`));
  for (;;) {
    const r = await prompt(`${c.cian('›')} Número: `);
    const i = Number(r);
    if (Number.isInteger(i) && i >= 1 && i <= opciones.length) return opciones[i - 1];
    console.log(c.rojo(`  Elige un número entre 1 y ${opciones.length}.`));
  }
}

async function pedirImagen(etiqueta) {
  for (;;) {
    const ruta = resolve(process.cwd(), await preguntar(etiqueta));
    if (!existsSync(ruta)) {
      console.log(c.rojo(`  No existe: ${ruta}`));
      continue;
    }
    try {
      const meta = await sharp(ruta).metadata();
      console.log(c.dim(`  ✓ ${meta.width}×${meta.height} ${meta.format}`));
      return ruta;
    } catch {
      console.log(c.rojo('  No parece una imagen válida.'));
    }
  }
}

// Deriva el id del nombre en inglés, al estilo del dataset original
// ("Barbell Bench Press" → "Barbell_Bench_Press").
function generarFuenteId(nombreEn, usados) {
  const base = nombreEn
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim().replace(/\s+/g, '_');
  if (!usados.has(base)) return base;
  let n = 2;
  while (usados.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

async function procesarImagen(origen, destino) {
  await sharp(origen)
    .resize({ width: ANCHO_WEBP, withoutEnlargement: false })
    .webp({ quality: CALIDAD_WEBP, effort: 6 })
    .toFile(destino);
}

async function main() {
  console.log(c.bold('\n▤  Añadir ejercicio al catálogo de GymLog\n'));

  const catalogo = JSON.parse(readFileSync(F_CATALOGO, 'utf-8'));
  const instrucciones = JSON.parse(readFileSync(F_INSTRUCCIONES, 'utf-8'));
  const idsUsados = new Set(catalogo.map((e) => e.fuente_id));
  console.log(c.dim(`Catálogo actual: ${catalogo.length} ejercicios\n`));

  // ── Nombres ──
  const nombreEs = await preguntar('Nombre en español');

  const yaExiste = catalogo.find(
    (e) => e.nombre_es.toLowerCase() === nombreEs.toLowerCase()
  );
  if (yaExiste) {
    console.log(c.rojo(`\n⚠  Ya existe un ejercicio con ese nombre: ${yaExiste.fuente_id}`));
    const seguir = await preguntar('¿Añadirlo igualmente? (s/N)', { requerido: false, defecto: 'n' });
    if (seguir.toLowerCase() !== 's') {
      console.log('Cancelado.');
      return rl.close();
    }
  }

  console.log(c.dim('  El nombre en inglés se usa para buscar en ambos idiomas.'));
  const nombreEn = await preguntar('Nombre en inglés');

  // ── Clasificación ──
  const grupoMuscular = await elegir('Grupo muscular:', GRUPOS);

  const equiposExistentes = [...new Set(catalogo.map((e) => e.equipo_es))].sort();
  const equipoEs = await elegir('Equipo:', [...equiposExistentes, c.dim('(otro — escribirlo)')]);
  let equipoFinalEs = equipoEs;
  let equipoFinalEn;
  if (equipoEs.includes('otro')) {
    equipoFinalEs = await preguntar('Equipo en español');
    equipoFinalEn = await preguntar('Equipo en inglés');
  } else {
    equipoFinalEn = catalogo.find((e) => e.equipo_es === equipoEs).equipo_en;
    console.log(c.dim(`  equipo_en: ${equipoFinalEn}`));
  }

  // ── Instrucciones ──
  console.log(`\n${c.bold('Instrucciones')} ${c.dim('(un paso por línea; línea vacía para terminar)')}`);
  const pasos = [];
  for (;;) {
    const paso = await prompt(`${c.cian('›')} Paso ${pasos.length + 1}: `);
    if (!paso) break;
    pasos.push(paso);
  }
  if (pasos.length === 0) {
    console.log(c.dim('  Sin instrucciones (válido: 5 ejercicios del catálogo tampoco las traen).'));
  }

  // ── Imágenes ──
  console.log(`\n${c.bold('Imágenes')} ${c.dim('(2: posición inicial y final — alternan en crossfade)')}`);
  const rutaA = await pedirImagen('Ruta de la imagen INICIAL');
  const rutaB = await pedirImagen('Ruta de la imagen FINAL');

  // ── Confirmación ──
  const fuenteId = generarFuenteId(nombreEn, idsUsados);
  const entrada = {
    fuente_id: fuenteId,
    nombre_es: nombreEs,
    nombre_en: nombreEn,
    grupo_muscular: grupoMuscular,
    equipo_es: equipoFinalEs,
    equipo_en: equipoFinalEn,
    imagen_a: `assets/catalogo/img/${fuenteId}_0.webp`,
    imagen_b: `assets/catalogo/img/${fuenteId}_1.webp`,
  };

  console.log(`\n${c.bold('Resumen')}`);
  console.log(`  id:          ${entrada.fuente_id}`);
  console.log(`  nombre:      ${entrada.nombre_es} ${c.dim(`/ ${entrada.nombre_en}`)}`);
  console.log(`  grupo:       ${entrada.grupo_muscular}`);
  console.log(`  equipo:      ${entrada.equipo_es} ${c.dim(`/ ${entrada.equipo_en}`)}`);
  console.log(`  pasos:       ${pasos.length}`);

  const ok = await preguntar('\n¿Guardar? (S/n)', { requerido: false, defecto: 's' });
  if (ok.toLowerCase() === 'n') {
    console.log('Cancelado. No se escribió nada.');
    return rl.close();
  }

  // ── Escritura ──
  if (!existsSync(DIR_IMG)) mkdirSync(DIR_IMG, { recursive: true });
  await procesarImagen(rutaA, resolve(DIR_IMG, `${fuenteId}_0.webp`));
  await procesarImagen(rutaB, resolve(DIR_IMG, `${fuenteId}_1.webp`));

  catalogo.push(entrada);
  instrucciones[fuenteId] = pasos;

  // Mismo formato minificado que el resto del catálogo
  writeFileSync(F_CATALOGO, JSON.stringify(catalogo));
  writeFileSync(F_INSTRUCCIONES, JSON.stringify(instrucciones));

  console.log(c.verde(`\n✓ "${nombreEs}" añadido. El catálogo tiene ahora ${catalogo.length} ejercicios.`));
  console.log(`\n${c.bold('Siguientes pasos:')}`);
  console.log('  1. pnpm test');
  console.log('  2. Sube CACHE_NAME en public/sw.js (invalida el caché de los usuarios)');
  console.log('  3. Commit + push a main → deploy\n');

  rl.close();
}

main().catch((err) => {
  console.error(c.rojo(`\nError: ${err.message}`));
  rl.close();
  process.exit(1);
});
