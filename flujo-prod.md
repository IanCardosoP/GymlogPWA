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

## Cómo invalidar el caché en dispositivos existentes

El Service Worker cachea los assets en la primera carga. Si se despliega una nueva versión sin cambiar el nombre del caché, los usuarios que ya tienen la app instalada **seguirán usando la versión anterior** hasta que el navegador actualice el SW (puede tardar horas).

**Para forzar actualización inmediata en todos los dispositivos:**

Antes del merge a `main`, editar `public/sw.js` y bumpar `CACHE_NAME`:

```js
// Antes
const CACHE_NAME = 'gymlog-v3';

// Después (incrementar el número)
const CACHE_NAME = 'gymlog-v4';
```

Al activarse el nuevo SW, el `activate` handler borra todos los cachés anteriores y los usuarios reciben los assets frescos en la próxima carga.

**¿Cuándo es obligatorio bumparlo?**
- Siempre que cambie lógica de negocio (JS) o estilos (CSS)
- Siempre que se actualice el esquema de la DB (`initDB`)
- En general: en cada merge a `main` que no sea solo documentación

---

## Resumen de responsabilidades

| Acción | Quién |
|---|---|
| Crear rama y codificar | Developer |
| Correr `pnpm test` localmente antes del PR | Developer |
| Bumpar `CACHE_NAME` antes de mergear a main | Developer |
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

# Build local para inspeccionar dist/ antes de desplegar
pnpm run build

# Ver estado del último deploy
gh run list --limit 5
gh run view <run-id>
```
