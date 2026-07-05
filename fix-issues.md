# Flujo de corrección de issues en GitHub

Este documento describe el flujo completo para leer issues del repositorio,
aplicar un fix en una rama dedicada, integrarlo en `dev` y promoverlo a `main`.

---

## Requisitos previos

- Tener `gh` CLI autenticado (`gh auth status`)
- Estar en la rama `dev` actualizada (`git checkout dev && git pull origin dev`)
- Tener `pnpm` disponible

---

## Paso 1 — Listar issues abiertos

```bash
gh issue list --repo <owner>/<repo> --state open --limit 50
```

Salida esperada:

```
15  OPEN  Cambiar el botón de [ ₿ DONAR ]  2026-06-29T03:46:30Z
```

---

## Paso 2 — Leer el detalle del issue

```bash
gh issue view <número> --repo <owner>/<repo> --json title,body,labels,comments
```

Ejemplo:

```bash
gh issue view 15 --repo IanCardosoP/GymlogPWA --json title,body,labels,comments
```

Salida esperada (fragmento):

```json
{
  "title": "Cambiar el botón de [ ₿ DONAR ]",
  "body": "El botón debería decir [ ₿ BITCOIN ] en lugar de [ ₿ DONAR ]."
}
```

---

## Paso 3 — Crear una rama dedicada al fix

Siempre desde `dev` como punto de partida:

```bash
git checkout dev
git pull origin dev
git checkout -b fix/issue-<número>
```

Ejemplo:

```bash
git checkout -b fix/issue-15
```

Convención de nombre: `fix/issue-N` donde `N` es el número del issue.

---

## Paso 4 — Aplicar el fix

Localizar el código afectado:

```bash
grep -rn "<término clave>" js/ index.html
```

Editar el archivo correspondiente con el cambio mínimo necesario para resolver el issue.
No refactorizar ni limpiar código fuera del alcance del issue.

---

## Paso 5 — Verificar que los tests siguen en verde

```bash
pnpm test
```

El fix **no avanza** si algún test falla. Corregir antes de continuar.

---

## Paso 6 — Commit del fix

```bash
git add <archivo(s) modificado(s)>
git commit -m "fix(<área>): <descripción corta> (#<número>)"
```

Ejemplo:

```bash
git add js/componentes/config.js
git commit -m "fix(config): renombrar botón ₿ DONAR a ₿ BITCOIN (#15)"
```

Formato del mensaje: `fix(<scope>): <descripción> (#N)` siguiendo el estilo del proyecto.

---

## Paso 7 — Push de la rama fix al remoto

```bash
git push origin fix/issue-<número>
```

Ejemplo:

```bash
git push origin fix/issue-15
```

---

## Paso 8 — PR de la rama fix hacia `dev`

```bash
gh pr create \
  --repo <owner>/<repo> \
  --base dev \
  --head fix/issue-<número> \
  --title "fix(<área>): <descripción corta>" \
  --body "## Summary
- <bullet con el cambio>

Closes #<número>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Ejemplo:

```bash
gh pr create \
  --repo IanCardosoP/GymlogPWA \
  --base dev \
  --head fix/issue-15 \
  --title "fix(config): renombrar botón ₿ DONAR a ₿ BITCOIN" \
  --body "## Summary
- Cambia el texto del botón Bitcoin de \`[ ₿ DONAR ]\` a \`[ ₿ BITCOIN ]\`

Closes #15

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Paso 9 — Merge del PR fix → `dev`

```bash
gh pr merge <pr-número> --repo <owner>/<repo> --merge --delete-branch=false
```

Ejemplo:

```bash
gh pr merge 16 --repo IanCardosoP/GymlogPWA --merge --delete-branch=false
```

> `--delete-branch=false` conserva la rama fix como referencia.
> Usar `--delete-branch` si se prefiere limpiar automáticamente.

---

## Paso 10 — PR de `dev` hacia `main`

```bash
git checkout dev
git pull origin dev

gh pr create \
  --repo <owner>/<repo> \
  --base main \
  --head dev \
  --title "fix(<área>): <descripción corta>" \
  --body "## Summary
- <bullet con el cambio>

Closes #<número>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Paso 11 — Merge del PR `dev` → `main`

```bash
gh pr merge <pr-número> --repo <owner>/<repo> --merge --delete-branch=false
```

El `Closes #N` en el cuerpo del PR cierra el issue automáticamente al hacer merge.

---

## Paso 12 — Confirmar que el issue quedó cerrado

```bash
gh issue view <número> --repo <owner>/<repo> --json state,title
```

Salida esperada:

```json
{ "state": "CLOSED", "title": "Cambiar el botón de [ ₿ DONAR ]" }
```

Si por alguna razón no se cerró automáticamente, cerrarlo manualmente:

```bash
gh issue close <número> --repo <owner>/<repo> --comment "Resuelto en PR #<pr-número>."
```

---

## Resumen del flujo completo

```
gh issue list
    ↓
gh issue view <N>
    ↓
git checkout -b fix/issue-N   (desde dev)
    ↓
[ aplicar fix ]
    ↓
pnpm test  →  ¿fallo? → depurar → pnpm test
    ↓ verde
git add + git commit
    ↓
git push origin fix/issue-N
    ↓
gh pr create  (fix/issue-N → dev)
    ↓
gh pr merge   (fix/issue-N → dev)
    ↓
gh pr create  (dev → main)
    ↓
gh pr merge   (dev → main)  ← cierra issue automáticamente vía "Closes #N"
    ↓
gh issue view <N>  →  state: CLOSED ✓
```
