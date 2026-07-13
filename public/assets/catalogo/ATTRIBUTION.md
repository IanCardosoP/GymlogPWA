# Atribución del catálogo de ejercicios

Los datos (nombres, equipamiento, músculos) y las imágenes de este directorio
provienen de **free-exercise-db**:

> https://github.com/yuhonas/free-exercise-db

Publicado bajo **The Unlicense** (dominio público). No se requiere atribución,
pero se incluye esta nota como buena práctica.

Transformaciones aplicadas para GymLog:

- Nombres y equipamiento traducidos al español (se conserva el original en
  inglés en `nombre_en` / `equipo_en` para búsqueda bilingüe).
- `primaryMuscles` mapeado al vocabulario de grupos musculares de la app
  (PECHO, ESPALDA, PIERNA, HOMBRO, BRAZO, CORE, GENERAL).
- Imágenes redimensionadas a 192px de ancho y convertidas a WebP
  (2 por ejercicio: posición inicial `_0` y final `_1`).
