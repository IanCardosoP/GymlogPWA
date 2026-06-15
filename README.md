# GymLog — Registro de Entrenamiento

**Tu diario de fuerza personal, sin cuentas, sin internet, sin límites.**

GymLog es una aplicación web progresiva (PWA) para registrar tus entrenamientos de fuerza. Funciona desde el navegador de tu teléfono, se instala como una app nativa y guarda todos tus datos directamente en tu dispositivo — sin servidores, sin suscripciones, sin que nadie vea tus datos.

---

## Qué puedes hacer con GymLog

### Registrar tu entrenamiento diario
- Cada día la app muestra los ejercicios de tu rutina activa listos para rellenar
- Anota peso y repeticiones para cada serie con un solo tap
- Elimina o corrige series equivocadas al instante
- Soporte para ejercicios de peso corporal (dominadas, fondos, etc.)

### Organizar tus rutinas
- Crea rutinas personalizadas con los ejercicios que quieras
- Asigna cada rutina a los días de la semana que entrenas
- Cambia entre rutinas activas y ejercicios de reserva sin borrar nada
- Hasta 8 ejercicios visibles por sesión

### Ver tu progreso
- Gráfica de evolución por ejercicio a lo largo del tiempo
- Métrica de **fuerza estimada (1RM)** — calcula el máximo que podrías levantar en una sola repetición, aunque cada día uses pesos y repeticiones distintos
- Panel explicativo por cada métrica: qué significa, cómo se calcula y para qué sirve

### Configuración personal
- Unidad de peso: kilogramos o libras
- Color de acento de la interfaz (verde terminal, morado, rosa, cian)
- Exportar e importar tus datos en formato CSV como respaldo
- Borrado completo de datos con un solo botón (previa confirmación)

---

## Por qué GymLog es diferente

### Tu teléfono es el servidor

GymLog no tiene backend. No existe ningún servidor que reciba tus datos. Todo — ejercicios, rutinas, series, historial — vive en una base de datos dentro de tu propio teléfono.

Esto significa:
- **Privacidad total:** nadie puede ver tus entrenamientos
- **Sin cuenta ni registro:** abres la app y ya está
- **Sin suscripción:** es gratis para siempre, sin planes de pago
- **Sin dependencia externa:** si mañana el dominio desaparece, la app sigue funcionando en tu dispositivo

### Funciona sin internet

Una vez instalada, GymLog funciona exactamente igual con o sin conexión. Puedes registrar un entrenamiento en el gimnasio aunque el WiFi no funcione, en el sótano, en viaje, en cualquier lugar.

La primera vez que abres la app necesitas conexión para descargarla. A partir de ahí, **nunca más**.

---

## Casos de uso

| Situación | Cómo ayuda GymLog |
|---|---|
| Entrenas solo y quieres llevar un control serio | Reemplaza el cuaderno de papel con algo siempre en el bolsillo |
| Alternas varias rutinas según el día | Crea una rutina por día y asígnala al día correspondiente |
| Quieres saber si estás progresando | La gráfica de 1RM muestra si tu fuerza sube aunque cambies de peso o reps |
| Entrenas sin WiFi (sótano, campo, viaje) | Modo offline completo — funciona igual sin conexión |
| No quieres dar tu email a otra app de gimnasio | No hay registro, no hay cuenta, no hay email |
| Cambias de teléfono | Exporta en CSV, instala en el nuevo y reimporta — datos intactos |

---

## Instalar GymLog como aplicación

GymLog se instala directamente desde el navegador, sin pasar por ninguna tienda de apps. Una vez instalada aparece en tu pantalla de inicio igual que cualquier otra aplicación.

**URL:** [`https://iancardosop.github.io/GymlogPWA/`](https://iancardosop.github.io/GymlogPWA/)

---

### iPhone o iPad — Safari

> En iOS la instalación solo funciona desde **Safari**. Chrome y Firefox en iOS no permiten instalar PWAs.

1. Abre **Safari** y navega a la URL de la app
2. Espera a que la página cargue completamente
3. Toca el botón de compartir — el icono de cuadrado con flecha hacia arriba, en la barra inferior
4. Desliza hacia abajo en el menú y toca **"Agregar a pantalla de inicio"**
5. Ponle el nombre que quieras y toca **"Agregar"**
6. La app aparece en tu pantalla de inicio con su propio icono

---

### Android — Chrome (recomendado)

1. Abre **Chrome** y navega a la URL
2. Espera a que la página cargue completamente
3. Chrome mostrará un banner en la parte inferior: **"Instalar app"** — tócalo
4. Si el banner no aparece: toca el menú de tres puntos (arriba a la derecha) → **"Instalar app"** o **"Agregar a pantalla de inicio"**
5. Confirma tocando **"Instalar"**

---

### Android — Samsung Internet

1. Abre **Samsung Internet** y navega a la URL
2. Toca el icono de menú (tres líneas, abajo a la derecha)
3. Toca **"Agregar página a"** → **"Pantalla de inicio"**
4. Confirma el nombre y toca **"Agregar"**

---

### Android — Firefox

1. Abre **Firefox** y navega a la URL
2. Toca el menú de tres puntos (arriba a la derecha)
3. Toca **"Instalar"** o **"Agregar a pantalla de inicio"**
4. Confirma

---

### Ordenador — Chrome o Edge

1. Navega a la URL en Chrome o Edge
2. Fíjate en la barra de direcciones: aparecerá un icono de instalación (pantalla con flecha de descarga)
3. Haz clic en ese icono y confirma con **"Instalar"**
4. GymLog se abre como ventana independiente, sin barras del navegador

---

## Respaldar y migrar tus datos

GymLog incluye opciones de exportación e importación en la pestaña **CONFIG**:

- **Exportar CSV:** descarga un archivo con todo tu historial de series. Guárdalo en tu nube personal (Drive, iCloud, etc.) como respaldo
- **Importar CSV:** carga un respaldo previamente exportado para restaurar tus datos o migrar a otro dispositivo

Si cambias de teléfono: exporta en el antiguo, instala GymLog en el nuevo e importa el CSV. Tus datos estarán intactos.

---

## Para los curiosos

GymLog usa una base de datos PostgreSQL completa que corre directamente en tu navegador gracias a WebAssembly. No es una base de datos simplificada — es el mismo motor que usan aplicaciones empresariales, ejecutándose 100% en tu dispositivo sin enviar ningún dato a ningún servidor.
