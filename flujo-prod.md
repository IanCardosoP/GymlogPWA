# Flujo de trabajo — GymLog PWA en producción

## Ramas

| Rama | Rol | Quién escribe |
|---|---|---|
| `main` | Producción — lo que está vivo en GitHub Pages | Solo recibe merges de `dev` |
| `dev` | Integración — siempre debe pasar tests | Developer + merges de features |
| `feature/xxx`, `fix/xxx` | Trabajo en curso | Developer |
| `sprint-N` | Checkpoint de seguridad al inicio de cada sprint | Automático (regla CLAUDE.md) |

---

## Ciclo de una nueva feature o fix

```
1. Developer crea rama desde dev
   git checkout dev && git pull origin dev
   git checkout -b feature/nombre-corto

2. Developer codifica y corre tests localmente
   pnpm test   ← debe terminar en verde antes de abrir PR

3. Developer abre PR: feature/nombre-corto → dev
   gh pr create --base dev

4. CI corre automáticamente (GitHub Actions / ci.yml)
   ✓ pnpm test en ubuntu-latest

5. Developer mergea el PR (si CI pasa)

6. Cuando dev está lista para producción → PR: dev → main
   gh pr create --base main

7. CI corre de nuevo en el PR

8. Developer mergea a main

9. GitHub Actions (deploy.yml) corre automáticamente:
   pnpm test → pnpm run build → deploy a GitHub Pages
   URL: https://IanCardosoP.github.io/GymlogPWA/
```

---

## Invalidación del caché — automática, no se toca a mano

El Service Worker cachea los assets en la primera carga. Si se despliega una versión
nueva sin cambiar el nombre del caché, los usuarios con la app instalada **seguirían
usando la versión anterior**. Antes eso se evitaba subiendo `CACHE_NAME` a mano antes
de cada merge; **ese paso ya no existe** (y era justo el que se olvidaba).

Hoy `public/sw.js` no contiene ningún número, sino un placeholder:

```js
const CACHE_NAME = 'gymlog-v__APP_VERSION__';
```

En el build, el plugin `sello-de-version` (`vite.config.js`) lo reemplaza por la
versión de `package.json` **+ el sha corto del commit**:

```js
const CACHE_NAME = 'gymlog-v1.0.19+a691bee';
```

Como el sha cambia en cada merge a `main`, **cada deploy produce un `CACHE_NAME`
distinto por construcción**: el `activate` handler del SW borra los cachés anteriores
y los usuarios reciben los assets frescos en la siguiente carga. No hay nada que
recordar por PR.

> Si alguien vuelve a fijar el `CACHE_NAME` a mano, **el build falla a propósito**
> (el plugin exige el placeholder). Es el seguro contra reintroducir el paso manual.

---

## Cuándo subir la versión semántica (`pnpm version`)

La versión de `package.json` **ya no sirve para invalidar el caché** — el sha hace ese
trabajo. Se sube solo cuando el cambio *significa* algo para el usuario, como etiqueta
de la historia del proyecto. En `main`, con el árbol limpio, antes de pushear:

```bash
pnpm version patch    # 1.0.19 → 1.0.20 · arreglos sin cambiar lo que la app hace
pnpm version minor    # 1.0.19 → 1.1.0  · algo nuevo que el usuario puede usar
pnpm version major    # 1.0.19 → 2.0.0  · ruptura de compatibilidad
git push --follow-tags
```

`pnpm version` reescribe `package.json`, crea el commit y le pone el tag de git;
`--follow-tags` es lo que sube el tag además del commit.

**Qué cuenta como `major` en esta app:** en la práctica, un cambio de esquema en PGLite
o en el formato del backup JSON que rompa la importación de backups viejos o exija una
migración no trivial en la DB del usuario. Nada más.

Un push puramente interno (refactor, tests, docs) puede ir **sin bump**: los usuarios
reciben el código nuevo igual, porque el sha ya invalidó su caché.

---

## Resumen de responsabilidades

| Acción | Quién |
|---|---|
| Crear rama y codificar | Developer |
| Correr `pnpm test` localmente antes del PR | Developer |
| Subir la versión semántica (`pnpm version`) cuando el cambio lo amerite | Developer |
| Invalidar el `CACHE_NAME` de los clientes | Build — automático (sello sha, ver arriba) |
| Correr tests en CI (PRs a dev y main) | GitHub Actions — automático |
| Build + deploy a GitHub Pages | GitHub Actions — automático al mergear a main |
| Crear checkpoint `sprint-N` al inicio de cada sprint | Developer (regla CLAUDE.md) |

---

## Comandos frecuentes

```bash
# Iniciar nueva feature
git checkout dev && git pull origin dev
git checkout -b feature/mi-feature

# Verificar antes de abrir PR
pnpm test

# Marcar una versión (solo si el cambio lo amerita — ver arriba)
pnpm version minor && git push --follow-tags

# Build local para inspeccionar dist/ antes de desplegar
pnpm run build

# Ver estado del último deploy
gh run list --limit 5
gh run view <run-id>
```
