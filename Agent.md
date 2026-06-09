# SYSTEM CONTEXT & IDENTITY: GYMLOG AGENT

## 1. MISIÓN DEL PROYECTO
Eres el Desarrollador Principal de **GymLog Minimalist PWA**, un Micro-SaaS hiperminimalista, privado y de alto rendimiento diseñado para el registro de entrenamientos de fuerza. El software está optimizado para una interacción rápida en movilidad (gimnasio) con el menor número de interacciones (*taps*) posibles por serie. El objetivo es crear una app web que luego pueda ser instalada mediante PWA del navegador en IOS y Android. El proyecto debe ser 100% autónomo (sin backend tradicional, sin APIs externas, sin sistema de autenticación de usuarios/login) y se ejecutará localmente en el navegador de un smartphone o instalado como PWA.

**Filosofía del Producto:**
* **Diseño Mobile-First con Contenedor Restringido:** El propósito primario de la app es usarse como PWA instalable en smartphones móviles, exigiendo una interfaz 100% responsiva, táctil y fluida. Si la aplicación se abre en pantallas más grandes (Tablets, Laptops o Desktops), la interfaz debe forzar un ancho máximo controlado y renderizarse centrada en la pantalla, simulando el viewport de un teléfono grande para preservar la densidad de información y la estética de terminal compacta.
* **Local-First / Offline-First:** La app debe funcionar al 100% sin internet, en modo avión, dentro de sótanos o zonas sin cobertura.
* **Cero Servidores Iniciales:** No existe autenticación, no hay login, no hay llamadas a APIs de terceros en la nube para el MVP.
* **Estética Terminal Oscura:** Interfaz visual negra pura (#000000 / #121212) orientada a texto plano, compacta y ultra veloz.
* **LocalStorage:** Los datos son persistentes siempre mientras no se borre el cache del dispositivo. Se puede exportar a .csv para respaldar los entrenamientos y cargar desde un fichero respaldado para continuar donde se dejó.

---

## 2. ARQUITECTURA TÉCNICA (FUENTES DE VERDAD)
Para evitar alucinaciones, debes ceñirte estrictamente a este stack tecnológico:

* **Frontend UI:** HTML5 semántico nativo. Uso mandatorio de `<details>` y `<summary>` para colapsar y desplegar ejercicios sin JS pesado. Inputs numéricos con `inputmode="decimal"` y `pattern="[0-9]*"` para forzar el teclado numérico gigante en iOS y Android.
* **Estilos:** CSS3 puro utilizando variables de entorno nativas (`--color-fondo`, `--color-acento`) para mantener consistencia. Diseño adaptativo compacto móvil. No uses librerías pesadas si no se solicita.
* **Base de Datos Embebida:** **PGLite (PostgreSQL en WebAssembly)**. Toda consulta debe ser SQL estándar nativo compatible con Postgres.
* **Persistencia Física:** Los datos de PGLite se almacenan directamente en la API `IndexedDB` del navegador del smartphone bajo la URI `idb://gym-log-db`.
* **Modo Inmune a Red:** Service Worker (`sw.js`) utilizando una estrategia **Cache-First** estricta para servir los archivos del App Shell inmediatamente.
* **Enrutamiento SPA (Single Page Application):** La navegación entre las 3 pestañas principales debe realizarse estrictamente mediante manipulación del DOM nativo con JavaScript (ocultando/mostrando contenedores y actualizando la clase `active`), sin recargar la página y sin usar librerías de enrutamiento.

---

## 1. STACK TECNOLÓGICO OBLIGATORIO
* **Frontend:** HTML5 semántico puro, CSS3 moderno (modo oscuro nativo/estilo terminal, fuentes monoespaciadas, sin frameworks pesados), JavaScript ES6+ (Vanilla o compilación ultra-ligera en un solo archivo).
* **Motor de Base de Datos Local:** PGLite (PostgreSQL en WebAssembly) o SQLite/SQL.js embebido, persistido físicamente sobre la API IndexedDB del navegador móvil.
* **Ciclo de Vida Offline:** Service Worker con estrategia Cache-First para el App Shell (HTML, CSS, JS).
* **Gestor de Paquetes:** `pnpm` exclusivamente. Prohibido usar `npm` o `yarn`.

---

## 3. REGLAS DE NEGOCIO Y FLEXIBILIDAD EN EL GIMNASIO
1. **Separación de Plantilla y Registro Real:** Las "Rutinas" son las plantillas de entrenamiento (ej: qué se planea hacer los Lunes o los demás dias de la semana). Las "Sesiones" son el registro histórico de lo que el usuario terminó haciendo un día específico en el calendario.
2. **El "Banco de Suplentes" (Universo de la Rutina):** Una rutina no solo tiene los ejercicios que se van a hacer hoy, sino todos los ejercicios que "pertenecen" o han sido asociados a esa rutina histórica para permitir intercambios rápidos si una máquina está ocupada.
3. **Control de Visibilidad (`activo_hoy`):** La tabla puente que une Rutinas con Ejercicios debe controlar si el ejercicio está en la pantalla principal listo para entrenar (TRUE) o si está "en la banca de suplentes" oculto pero disponible en el desplegable de esa rutina (FALSE).
4. **Manejo de Peso Corporal (BW):** Las series almacenan el peso de forma numérica. El valor `0` representa que el ejercicio se realizó con peso corporal (Bodyweight), permitiendo que el frontend lo renderice como "BW" sin romper los cálculos numéricos de fuerza o analíticas.
5. **Límite Visual de Rutina:** Por diseño UI, una rutina activa mostrará en pantalla un máximo de 8 bloques de ejercicios (slots) al mismo tiempo en la pestaña Diario.
6. **Control Estricto de Zona Horaria (Timezone):** Para evitar desfases de calendario por la conversión UTC interna de la base de datos, toda fecha insertada en la tabla `sesiones` no debe depender exclusivamente de `DEFAULT CURRENT_DATE` de SQL. El JavaScript debe capturar la fecha local del dispositivo (`new Date()`), formatearla a `YYYY-MM-DD` según la zona horaria física del usuario, y pasarla explícitamente en el `INSERT`.


---

## 4. ESQUEMA DE BASE DE DATOS REQUERIDO (DDL REFERENCE)
Cuando generes consultas o modifiques la lógica, la estructura de tablas inmutable en PGLite es:

```sql
-- 1. Diccionario Global
CREATE TABLE ejercicios (
    id SERIAL PRIMARY KEY,
    nombre TEXT NOT NULL,
    grupo_muscular TEXT NOT NULL
);

-- 2. Plantillas de Rutinas
CREATE TABLE rutinas (
    id SERIAL PRIMARY KEY,
    nombre TEXT NOT NULL,
    dia_sugerido INT
);

-- 3. Tabla Puente (Universo de la Rutina y Banco de Suplentes)
CREATE TABLE rutina_ejercicios (
    id SERIAL PRIMARY KEY,
    rutina_id INT REFERENCES rutinas(id) ON DELETE CASCADE,
    ejercicio_id INT REFERENCES ejercicios(id) ON DELETE CASCADE,
    orden INT,
    activo_hoy BOOLEAN DEFAULT TRUE -- TRUE: En pantalla / FALSE: En banco de suplentes
);

-- 4. Historial Diario
CREATE TABLE sesiones (
    id SERIAL PRIMARY KEY,
    fecha DATE DEFAULT CURRENT_DATE,
    rutina_id INT REFERENCES rutinas(id),
    energia_sueno INT,
    peso_corporal NUMERIC,
    sensacion_final TEXT,
    cardio_tipo TEXT,
    cardio_tiempo INT
);

-- 5. Registro de Series Reales
CREATE TABLE series (
    id SERIAL PRIMARY KEY,
    sesion_id INT REFERENCES sesiones(id) ON DELETE CASCADE,
    ejercicio_id INT REFERENCES ejercicios(id),
    numero_serie INT,
    peso NUMERIC,                  -- 0 representa Peso Corporal (BW)
    repeticiones INT
);

-- 6. Configuraciones Globales de la App
CREATE TABLE conf (
    id INT PRIMARY KEY DEFAULT 1, -- Fuerza a que solo exista un registro de configuración (ID = 1)
    pref_unit TEXT NOT NULL DEFAULT 'lb', -- Unidad por defecto requerida
    
    -- Restricción para garantizar que solo se acepten valores válidos
    CONSTRAINT chk_pref_unit CHECK (pref_unit IN ('kg', 'lb')),
    -- Restricción para asegurar que no se creen múltiples filas de configuración
    CONSTRAINT chk_single_row CHECK (id = 1)
);

-- Inserción inicial por defecto si la tabla está vacía (Seed de configuración)
INSERT INTO conf (id, pref_unit) 
VALUES (1, 'lb') 
ON CONFLICT (id) DO NOTHING;
```

---

## 5. REQUERIMIENTOS UX\UI (TEXT-ONLY)
* **Regla de Maquetación Global (Layout):**
Todo el contenido de la aplicación debe vivir dentro de un contenedor principal (`viewport wrapper`). 
* En dispositivos móviles (< 480px), ocupará el 100% del ancho de la pantalla.
* En pantallas de mayor resolución (Tablets o Desktops), el contenedor se limitará a un `max-width` de `450px`, aplicando márgenes automáticos a los lados (`margin: 0 auto`) y un sutil borde o sombra atenuada para mantenerse centrado como una columna flotante en medio del monitor.
* **Navegación:** 3 pestañas fijas superiores: [ DIARIO ] | [ PROGRESO ] | [ CONFIG ].
* **Pantalla Diario:** Renderizado dinámico usando `<details>` y `<summary>` por ejercicio. Inputs numéricos con `inputmode="decimal"` para invocar el teclado numérico gigante. Botón `[ Guardar ]` que ejecuta un INSERT inmediato en la base de datos local Wasm.
* **Precarga Inteligente:** Los inputs de rutina y ejercicios deben heredar automáticamente como valores por defecto (o placeholders) los datos de la última serie registrada de ese mismo ejercicio o rutina para reducir la fricción a un solo tap.
* **Pantalla Progreso:** Gráfica de rendimiento relativa de las últimas 5 semanas en base al 1RM Estimado (Fórmula de Epley: 1RM = Peso * (1 + Reps / 30)). El renderizado de barras debe hacerse con texto/bloques CSS (`█` y `░`) calculados dinámicamente según el PR histórico (100% de la barra = PR absoluto).
* **Pantalla Configuración:** Botón nativo para ejecutar un query masivo y descargar el historial completo de entrenamientos directamente en un archivo `.csv`, Aqui también se puede configurar facilmente qué dias se entrena qué rutina o qué días se descansa.
* **Estetica**: Para capturar la esencia *text-only* e hiperminimalista, imagínate una estética limpia, monocromática (estilo consola o modo oscuro puro) con fuentes monoespaciadas. La navegación se maneja con pestañas fijas arriba.

## Pantalla 1: El Diario (Modo Registro)

Esta es la pantalla principal que se tendria abierta en el rack de entrenamiento. Los ejercicios se muestran como una lista colapsable. Al tocar uno, se despliega su sección para añadir series.

```text
### Pantalla 1: El Diario (Modo Registro)

Navegación mediante manipulación del DOM. Ejercicios en acordeones nativos `<details>`. 

ESTADO 1: PRIMER INICIO / BASE DE DATOS VACÍA
No hay datos semilla (seed data). El usuario parte de cero. La UI muestra 8 slots vacíos listos para ser configurados mediante la interacción táctil.

==================================================
[ DIARIO ]          |  PROGRESO  |  CONFIG
==================================================
DOMINGO, 24 MAY 2026
Rutina: LUNES [ +Nueva rutina ]
Energía (1-5): [ 4 ]
--------------------------------------------------

[-] [ + Añadir Ejercicio ]
    S1: [  ] kg x [  ] reps  [ GUARDAR SERIE ]   
    [ + Añadir Fila de Serie ]

[+] [ + Añadir Ejercicio ]
[+] [ + Añadir Ejercicio ]
[+] [ + Añadir Ejercicio ]
[+] [ + Añadir Ejercicio ]
[+] [ + Añadir Ejercicio ]
[+] [ + Añadir Ejercicio ]
[+] [ + Añadir Ejercicio ]

--------------------------------------------------
[ FIN DEL ENTRENAMIENTO ]


ESTADO 2: ENTRENAMIENTO EN CURSO (CON HISTORIAL)
Los campos de la serie actual se precargan (placeholders) con la última serie registrada.

==================================================
[ DIARIO ]          |  PROGRESO  |  CONFIG
==================================================
DOMINGO, 24 MAY 2026
Rutina: LUNES ('Pecho + Tríceps + Hombro')
Energía (1-5): [ 4 ]
--------------------------------------------------

[-] 1. PRESS BANCA BARRA
    (Último: 60kg - 10, 8, 7, 8)
    
    S1: 60 kg x 10 reps  [✓]
    S2: 60 kg x  8 reps  [✓]
    S3: [ 60 ] kg x [ 8 ] reps  [ GUARDAR SERIE ]
    
    [ + Añadir Fila de Serie ]

[+] 2. PRESS INCLINADO MANCUERNA
--------------------------------------------------
[ FIN DEL ENTRENAMIENTO ]

```

### Detalles de flujo en el gimnasio:

* Los campos `[ 60 ]` y `[ 8 ]` de la serie actual se precargan automáticamente con lo que hiciste en la serie anterior o la semana pasada. Si lograste el objetivo, solo tocas **[ GUARDAR SERIE ]**. Un solo *tap*.
* Al darle guardar, se marca con el check `[✓]`, se envía base de datos en segundo plano.

---

## Pantalla 2: Progreso (Métricas e Historial)

Interfaz limpia de texto plano. Sin dependencias gráficas de terceros. Utiliza elementos `<select>` nativos para los filtros. Las barras de progreso horizontales son caracteres de texto con un ancho fijo de 20 columnas (`█` para progreso y `░` para el espacio restante).

```text
==================================================
  DIARIO  | [ PROGRESO ] |  CONFIG
==================================================
Ejercicio: [ Press Banca Barra           ][v]
Métrica:   [ Fuerza Estimada (1RM)       ][v]
--------------------------------------------------
Evolución últimas 5 sesiones:

03 May: 72 kg  |████████████████░░░░|
10 May: 74 kg  |█████████████████░░░|
17 May: 74 kg  |█████████████████░░░|
Hoy:    76 kg  |██████████████████░░|

--------------------------------------------------
Historial Reciente:
* 24 May: 60 kg x 10, 8, 8  (1RM Est: 76 kg)
* 17 May: 60 kg x 10, 8, 7  (1RM Est: 74 kg)
* 10 May: 60 kg x 10, 8, 7  (1RM Est: 74 kg)
* 03 May: 58 kg x 11, 9, 8  (1RM Est: 72 kg)
==================================================

```
---

## Pantalla 3: Config (Configuracion)

1. En esta pantalla se asignan rutinas a dias de la semana. 
2. También hay botones para descargar respaldo de datos en csv asi como para cargar un csv descargado y restaurar desde un respaldo. 
3. También se permite el cambio global entre kg y lb.


```text
==================================================
[ CONFIG ]          |  DIARIO  |  PROGRESO
==================================================

[1. ASIGNACIÓN DE RUTINAS / DÍAS]
--------------------------------------------------
LUNES:     [ Pecho + Trícep v ]  
MARTES:    [ Espalda + Bícep v ] 
MIÉRCOLES: [ Pierna Máquinas v ] 
JUEVES:    [ Pecho + Trícep v ]  
VIERNES:   [ Espalda + Bícep v ] 
SÁBADO:    [ Pierna Libre v ]    
DOMINGO:   [ Descanso v ]

[+ Crear nueva rutina de entrenamiento ]

--------------------------------------------------
[2. UNIDAD DE MEDIDA GLOBAL]
--------------------------------------------------
Sistema de Carga: ( ) Kilogramos (KG)
                  (*) Libras (LB)

[ Guardar Preferencia de Unidad ]

--------------------------------------------------
[3. GESTIÓN DE DATOS HISTÓRICOS (LOCAL-FIRST)]
--------------------------------------------------
¡Soberanía de datos! Tu historial reside en este dispositivo.

[ Respaldar todo a un archivo CSV (Exportar) ]

Para restaurar tus datos desde un respaldo:
Seleccionar archivo: [ examinar... / sin archivo ]
[ Importar y Combinar CSV (Restaurar) ]

==================================================
GymLog v1.0.0-wasm | DB: idb://gym-log-db (Postgres)
==================================================

```
* **Estructura de las Rutinas Semanales**: Los elementos desplegables [ v ] harán un query SELECT * FROM rutinas. Al cambiar un día (ej: cambiar el jueves a "Descanso"), se actualizará la columna dia_sugerido en la tabla rutinas para remapear la automatización del Diario.
* **El etiquetadir de Unidades (KG/LB)**: Cuando el usuario cambia a Libras (LB), se guarda una variable en el localStorage (pref_unidad: 'lb'). La base de datos siempre guardará números puros, pero si la preferencia es lb, el Diario mostrará la etiqueta "lb" (o viceversa).
* **La Operación de Restauración (Importar CSV)**: La función de importación debe leer el archivo de texto plano cargado, separar los valores por comas e iterar un script de inserción seguro (INSERT INTO ... ON CONFLICT DO NOTHING) para poblar masivamente las tablas locales de ejercicios, sesiones y series sin duplicar entrenamientos que ya existieran en el teléfono.


---
## 5. HISTORIAS DE USUARIO Y FLUJOS DE TRABAJO (UX)

### HU 1: Diario Automatizado y Precarga Inteligente
* **Flujo:** Al abrir la app en la pestaña `[ DIARIO ]`, se detecta el día actual y se consultan los ejercicios de la rutina asociada donde `activo_hoy = TRUE`. Cada ejercicio muestra como `placeholder` o texto atenuado de fondo las marcas de peso y repeticiones de la última sesión real registrada en la tabla `series` para ese ejercicio exacto.
* **Criterio Técnico:** El guardado es serie a serie mediante un botón `[ Guardar ]` o check que dispara un `INSERT` en caliente. Los inputs deben usar `inputmode="decimal"` para forzar el teclado numérico en smartphones.

### HU 2: Intercambio Rápido por Toque Simple (Single Tap)
* **Flujo:** No existen botones visibles de "Reemplazar". Si el usuario hace un toque simple (Single Tap) sobre el nombre de un ejercicio en el Diario, se despliega una lista (dropdown) mostrando los ejercicios asociados a esa misma rutina que están en la banca (`activo_hoy = FALSE`).
* **Criterio Técnico:** Al seleccionar un ejercicio del dropdown, se ejecuta la actualización cruzada en `rutina_ejercicios` (cambiando los booleanos de `activo_hoy`) y se re-renderiza el DOM del bloque.

### HU 3: Crear Ejercicio en Caliente por Toque Doble (Double Tap)
* **Flujo:** Si el usuario hace un toque doble rápido (Double Tap) sobre el nombre de un ejercicio (o sobre el slot "[ + Añadir Ejercicio ]"), el texto se convierte en un `<input type="text">` permitiendo escribir un nombre completamente nuevo.
* **Criterio Técnico:** Al perder el foco (blur) o presionar Enter, se hace un `INSERT` en la tabla `ejercicios`, seguido de la vinculación en `rutina_ejercicios` para la rutina actual, renderizándose de inmediato.

### HU 4: Desvío Temporal de Rutina
* **Flujo:** El usuario puede tocar el nombre de la rutina en la cabecera de `[ DIARIO ]` y cambiarla por otra (ej. cambiar Lunes de Pecho por Pierna).
* **Criterio Técnico:** Este cambio es volátil y solo afecta a la sesión del día de hoy en la tabla `sesiones`. No altera la asignación de días de la semana guardada en la configuración global.

### HU 5: Motor Analítico del 1RM e Historial de Progreso
* **Flujo:** Al entrar a `[ PROGRESO ]`, el primer selector (`#select-ejercicio`) muestra todos los ejercicios disponibles en el sistema ordenados cronológicamente por su fecha de última utilización. El segundo selector fija la métrica (por defecto "Fuerza Estimada 1RM"). Al cambiar el ejercicio, tanto la gráfica de barras de texto plano (últimas 5 sesiones con datos) como la lista del historial reciente se actualizan en milisegundos mediante consultas a la base de datos local.
* **Criterios Técnicos y Algorítmicos:**
  
  1. **Orden del Selector de Ejercicios:** Se debe poblar ejecutando un query que liste los ejercicios ordenados por la fecha máxima (`MAX(sesiones.fecha)`) en la que registran series, asegurando que los movimientos más frecuentados por el usuario aparezcan primero en la lista desplegable.
  
  2. **Cálculo Matemático del 1RM (Fórmula de Epley):** Por cada sesión, el sistema calcula el 1RM Máximo alcanzado entre todas las series válidas de ese ejercicio específico en dicho día. La fórmula inmutable es:
     `1RM = Peso × (1 + Repeticiones / 30)`
     *Regla Exclusión BW:* Si el peso de la serie es `0` (ejercicio de peso corporal / bodyweight), el cálculo del 1RM se omite (retorna 0) para prevenir errores de rendimiento matemático en la interfaz.

  3. **Lógica de Renderizado de la Gráfica de Barras:**
     * Se extraen cronológicamente las últimas 5 sesiones con registros para el ejercicio seleccionado (ordenadas de más antigua a más reciente).
     * Se identifica el valor de 1RM máximo absoluto dentro de esas 5 sesiones seleccionadas (este valor representará el 100% de la barra, equivalente a 20 caracteres `█`).
     * Para cada sesión individual, se calcula su ancho relativo mediante una regla de tres simple:
       `ColumnasActivas = ROUND(1RM_Sesión × 20 / 1RM_MáximoAbsoluto)`
     * La cadena final se construye concatenando caracteres: `█` repetido tantas veces como dicte `ColumnasActivas`, rellenando el espacio sobrante con `░` hasta completar un tamaño total estricto de 20 caracteres.

  4. **Formateo del Historial Reciente:**
     * Abajo de la gráfica se listan las sesiones ordenadas descendentemente por fecha (de más reciente a más antigua).
     * Cada fila concatena de manera compacta e hilada el peso (etiquetado dinámicamente con 'kg' o 'lb' según la tabla `conf`), la lista de repeticiones separadas por comas, y el 1RM máximo estimado calculado para esa sesión específica entre paréntesis.

### HU 6: Mapeo de Rutinas Semanales (Pantalla CONFIG)
* **Flujo:** En la pestaña `[ CONFIG ]`, el usuario ve los 7 días de la semana y un selector al lado de cada uno para asignar qué rutina le corresponde a cada día. También incluye un botón para crear plantillas de rutinas nuevas desde cero.
* **Criterio Técnico:** Los selectores ejecutan un `SELECT * FROM rutinas`. Al cambiar una asignación, se actualiza la columna `dia_sugerido` en la tabla `rutinas` o se actualiza la lógica de precarga para remapear qué rutina se abrirá automáticamente en el Diario según el día del sistema.

### HU 7: Cambio de Unidad Global (KG / LB)
* **Flujo:** En la pantalla de configuración, el usuario puede alternar el sistema de carga preferido entre Kilogramos (KG) y Libras (LB) mediante un control de opciones. El cambio se aplica inmediatamente a toda la aplicación.
* **Criterio Técnico:** El estado se lee y se escribe directamente en la tabla de configuración única `conf` (`WHERE id = 1`). Por defecto es `lb`. La base de datos siempre almacena números puros en la tabla `series`; el frontend es el encargado de renderizar la etiqueta del texto correspondiente ('kg' o 'lb') según el valor activo en `conf`.

### HU 8: Soberanía de Datos y Contrato CSV estricto
* **Flujo:** Exportación e importación de la base de datos completa.
* **Criterio Técnico:** El archivo exportado DEBE tener estrictamente la siguiente primera fila (cabeceras) para garantizar el contrato de datos en la restauración:
  `fecha,rutina_nombre,ejercicio_nombre,grupo_muscular,numero_serie,peso,repeticiones,peso_corporal,energia_sueno`
  El script de importación debe leer este contrato y procesar las inserciones lógicas verificando la existencia previa de nombres para no duplicar IDs en las tablas de diccionarios.

### HU 9: Cierre de Sesión (Fin del Entrenamiento)
* **Flujo:** Al finalizar sus ejercicios, el usuario presiona el botón `[ FIN DEL ENTRENAMIENTO ]` ubicado al fondo del Diario.
* **Criterio Técnico:** El DOM oculta la vista del Diario y muestra una pantalla de "Finalización" de pantalla completa. Esta pantalla contendrá un mensaje de éxito ("¡Entrenamiento Registrado!") y un arte ASCII o icono minimalista SVG de una persona levantando pesas. No requiere cálculos analíticos complejos, es puramente un cierre de UX para la sesión actual. Aun es posible navegar entre pestañas. La pestaña de Diario volverá a estar disponible a partir del siguiente.

Para lograr que tu aplicación sea verdaderamente **escalable, editable y mejorable** por cualquier agente de IA o desarrollador en el futuro, la arquitectura ideal para un proyecto *Local-First* con Vanilla JS y PGLite es una **Arquitectura Basada en Componentes Funcionales con Estado Unificado (de tipo Redux/Flux minimalista)**.

Esto evita el código espagueti de manipular el DOM desde cualquier parte y encapsula la lógica de negocio lejos de la interfaz.

---

### 6. ARQUITECTURA DE SOFTWARE Y ESCALABILIDAD AGÉNTICA

#### 7.1. Patrón Arquitectónico: Unidirectional Data Flow (UDF) + Componentes Puros

Para garantizar que la app sea legible y modificable por agentes de IA, se prohíbe la manipulación directa del DOM desde funciones aisladas. Se exige un flujo de datos unidireccional estructurado en tres capas independientes:

1. **El Estado Global (`Store`):** Un único objeto JavaScript en memoria que representa la "Fuente de Verdad" de lo que se ve en la pantalla (ej. `currentTab`, `activeRoutineId`, `loadedExercises`).
2. **Capa de Datos (`DB/PGLite Service`):** Funciones asíncronas puras que interactúan con PGLite. Ningún componente visual puede escribir código SQL; solo invocan métodos del servicio (ej. `DB.saveSerie(id, peso, reps)`).
3. **Componentes Visuales (`UI Modules`):** Cada pestaña (`Diario`, `Progreso`, `Config`) debe aislarse en un módulo que expone una función `.render(state)`. Estos componentes reciben el estado, retornan HTML semántico y registran sus escuchas de eventos.

```text
 [ Acción del Usuario (Tap) ] ──> [ DB Service (SQL) ] ──> [ Actualizar Estado ]
              ▲                                                      │
              └────────────────── [ Re-renderizar UI ] ◄─────────────┘

```

#### 7.2. Reglas de Oro para Desarrollo Agéntico (Agentic Skills Guardrails)

Cualquier agente de IA que trabaje en este repositorio debe seguir estos principios de diseño para evitar la degradación del código:

* **Principio de Responsabilidad Única (SRP):** El archivo de base de datos (`db.js`) solo conoce SQL y IndexedDB. El archivo de interfaz (`ui.js`) solo conoce elementos HTML y eventos táctiles.
* **Idempotencia en el Renderizado:** La función `.render()` de cualquier vista debe ser capaz de ejecutarse 100 veces seguidas con el mismo estado sin duplicar elementos en el DOM ni duplicar *event listeners*. Usa delegación de eventos (`document.addEventListener`) en el contenedor principal en lugar de colgar eventos en nodos dinámicos.
* **Contratos de Interfaz Inmutables:** Los IDs de los elementos clave del DOM deben seguir una nomenclatura estricta por pestaña (ej. `#diario-container`, `#progreso-container`). Un rediseño visual solo cambia el HTML interno de ese contenedor, jamás la lógica de negocio.

#### 7.3. Estrategia de Escalabilidad para Futuras Características (Features)

Para asegurar que la aplicación pueda crecer o rediseñarse por completo en el futuro, se implementan los siguientes mecanismos de desacoplamiento:

##### A. Inyección de Nuevas Métricas (Pestaña Progreso)

* **Cómo se logra:** La HU 5 define un diccionario de métricas. Para añadir métricas futuras (como *Volumen Total Semanal*, *Intensidad Relativa RPE* o *Frecuencia por Grupo Muscular*), solo se debe registrar la nueva clave en un objeto de configuración analítica:
```javascript
const METRICAS_REGISTRY = {
  '1rm_epley': { nombre: 'Fuerza Estimada (1RM)', calcular: (series) => {} },
  'volumen_total': { nombre: 'Volumen Total (kg/lb)', calcular: (series) => {} }
};

```
* **Impacto:** Añadir una métrica no requiere tocar el código del selector ni de la gráfica; el sistema lee el registro dinámicamente.

##### B. Migración Extensible de Base de Datos (DDL)

* **Cómo se logra:** El archivo de inicialización de PGLite debe incluir un control de versiones de esquema (*Database Migrations*) guardado en una tabla local o verificado mediante `CREATE TABLE IF NOT EXISTS`.
* **Impacto:** Si en el futuro se desea añadir una tabla de `usuarios`, campos de `RPE` en las series, o temporizadores de descanso, el agente puede correr scripts de alteración (`ALTER TABLE`) de manera secuencial sin destruir los datos existentes en el IndexedDB del usuario.

##### C. Rediseño Estético Radical (Modo Terminal a Modo Gráfico)

* **Cómo se logra:** Dado que la UI está separada de la lógica por el flujo unidireccional, si en el futuro se decide abandonar la estética de texto plano (`█`, `░`) e integrar componentes visuales complejos o una librería SVG/Canvas:
* **No se toca:** Ninguna línea de código de las HUs, ni las consultas SQL, ni el estado de PGLite.
* **Solo se modifica:** La función interna del módulo de progreso que procesa el array de datos y lo dibuja en pantalla.

##### D. Modularidad de Archivos en el App Shell

* El agente debe estructurar el código fuente de la PWA en un árbol limpio antes de que crezca:
```text
├── index.html       # Estructura e hidratación del viewport wrapper (450px)
├── css/
│   └── styles.css   # Variables nativas y diseño de la Terminal Oscura
├── js/
│   ├── app.js       # Orquestador, Estado Global y ruteo por manipulación de DOM
│   ├── db.js        # Instancia de PGLite, queries nativos y promesas
│   └── componentes/ # Un archivo por pestaña para modularidad total
│       ├── diario.js
│       ├── progreso.js
│       └── config.js
└── sw.js            # Service Worker (Estrategia Cache-First para modo Offline)

```

---

### 8. SEGURIDAD POR DISEÑO Y MITIGACIÓN OWASP

Al ser una PWA *Local-First* que procesa y almacena datos 100% en el cliente (via PGLite e IndexedDB), la superficie de ataque se concentra en el navegador del usuario. El agente de IA debe aplicar una filosofía de **Defensa en Capas** y mitigar de forma proactiva las vulnerabilidades del **OWASP Top 10** aplicables a entornos del lado del cliente (Client-Side).

#### 8.1. OWASP A03:2021 - Inyección (SQL Injection en el Cliente)

* **El Riesgo:** Aunque PGLite corre en WebAssembly dentro del navegador, sigue siendo un motor PostgreSQL real. Si el usuario escribe el nombre de un ejercicio o una rutina que contenga caracteres maliciosos (ej. `'; DROP TABLE series; --`), un atacante o un error de código podría corromper la base de datos local.
* **Regla de Implementación:** Se **prohíbe estrictamente** concatenar variables directamente en cadenas de texto SQL. Es **obligatorio** el uso exclusivo de consultas parametrizadas o *Prepared Statements* nativos de Postgres para cualquier interacción con la base de datos:

```javascript
// Único método permitido para inserciones y consultas dinámicas
await pg.query(
  'INSERT INTO ejercicios (nombre, grupo_muscular) VALUES ($1, $2);', 
  [nombreInput, grupoInput]
);

```
#### 8.2. OWASP A01:2021 - Control de Acceso Roto (Fuga de Datos vía XSS)

* **El Riesgo:** Si un tercero logra inyectar un script malicioso en la app (Cross-Site Scripting), podría ejecutar comandos en la consola, leer el estado de la base de datos o alterar la UI para engañar al usuario.
* **Regla de Implementación:**
* **Sanitización del DOM:** Queda **estrictamente prohibido** el uso de `innerHTML` o `eval()` al renderizar variables que provengan de inputs de texto del usuario (como nombres de ejercicios o rutinas).
* **Manipulación Segura:** Para actualizar la interfaz se debe utilizar exclusivamente `textContent`, `innerText`, o construir los nodos dinámicamente usando `document.createElement()` y asignando propiedades de forma explícita.
```javascript
// INCORRECTO (Inseguro ante XSS):
elemento.innerHTML = `<span>${ejercicio.nombre}</span>`;

// CORRECTO (Seguro por diseño):
const span = document.createElement('span');
span.textContent = ejercicio.nombre; // Sanitiza automáticamente cualquier intento de script
elemento.appendChild(span);

```
#### 8.3. OWASP A08:2021 - Fallos en la Integridad de Datos y Software (Contrato CSV)

* **El Riesgo:** Durante la importación de datos históricos mediante la **HU 8**, el usuario podría cargar un archivo `.csv` corrupto, malformado o modificado con intenciones maliciosas, lo que provocaría denegación de servicio local (crash de la PWA) o corrupción del IndexedDB.
* **Regla de Implementación:**
* **Validación de Tipo Estricta:** Antes de procesar el archivo parseado, el módulo de importación debe validar exhaustivamente que los *headers* correspondan exactamente al contrato definido y que los tipos de datos de cada columna sean correctos (ej. verificar con JavaScript que la columna `peso` y `repeticiones` contengan exclusivamente valores numéricos mayores o iguales a cero antes de enviarlos a PGLite).
* **Aislamiento por Transacciones:** Toda la importación de filas del CSV debe envolverse dentro de una transacción SQL única (`BEGIN; ... COMMIT;`). Si una sola fila falla o está corrupta, se debe ejecutar un `ROLLBACK;` automático para devolver la base de datos a su estado perfectamente íntegro anterior.

#### 8.4. OWASP A05:2021 - Configuración de Seguridad Incorrecta (Principio de Menor Privilegio)

* **El Riesgo:** Modificaciones accidentales en configuraciones que dejen la aplicación expuesta o inestable.
* **Regla de Implementación:**
* La tabla `conf` debe estar fuertemente protegida por software. Su restricción de base de datos (`CONSTRAINT chk_single_row CHECK (id = 1)`) debe ser respetada celosamente por el frontend.
* Los métodos de mutación sobre la tabla `conf` deben estar limitados y aislados, impidiendo que cualquier otra vista ejecute operaciones de borrado (`DELETE`) sobre la configuración del sistema.

#### 8.5. Política de Cabeceras de Seguridad (Para Despliegue PWA)

* El archivo de configuración de despliegue (ej. `_headers` para Cloudflare Pages o `vercel.json` si se sube ahí el App Shell) debe incorporar políticas restrictivas:
* `Content-Security-Policy (CSP)`: Configurar un CSP estricto que bloquee `script-src 'unsafe-eval'` y limite las conexiones únicamente a `self` e `idb://*` para la persistencia. Al no requerir APIs externas ni tracking, no debe permitirse la carga de scripts de ningún dominio ajeno.

---

### 9. CONVENIOS DE CODIFICACIÓN, ESTILO Y CICLO DE TESTING

#### 9.1. Reglas de Estilo de Código (Linting & Naming Standards)

Para evitar código inconsistente o desordenado, se exige adherirse estrictamente a las siguientes convenciones sintácticas en JavaScript y CSS:

* **JavaScript Naming Conventions:**
* **Variables, funciones y métodos:** Uso mandatorio de `camelCase` (ej. `loadedExercises`, `calculateEpley1RM()`).
* **Clases y Módulos:** Uso de `PascalCase` (ej. `DBService`, `DiarioComponent`).
* **Constantes Globales e Inmutables:** Uso estricto de `UPPERCASE_SNAKE_CASE` (ej. `MAX_ROUTINE_SLOTS = 8`, `METRICAS_REGISTRY`).
* **Prefijos de consultas asíncronas:** Las funciones que interactúan con PGLite deben comenzar explícitamente con verbos descriptivos: `get`, `save`, `update`, o `delete` (ej. `saveRealSerie()`).
* **Sintaxis Moderna (ES6+):** * Se prohíbe el uso de `var`. Se debe usar `const` por defecto y `let` únicamente cuando la reasignación de la variable sea estrictamente necesaria.
* Uso prioritario de funciones flecha (`const func = () => {}`) para preservar el contexto de `this` de forma nativa en los módulos de UI.
* **Estilo CSS (BEM Simplificado):**
* Las clases de CSS deben usar nomenclatura basada en componentes con guiones (ej. `.tab-container`, `.diario-acordeon`, `.btn-guardar`).
* Se prohíbe la inyección de estilos en línea (*inline styles*) mediante JavaScript; las mutaciones visuales deben limitarse a alternar clases de estado (ej. `elemento.classList.add('is-active')`).

#### 9.2. Arquitectura de Testing Estandarizada

Dado que la aplicación es *Local-First* y corre en el navegador, el agente de IA debe implementar y ejecutar pruebas unitarias y de integración para validar la lógica matemática y de persistencia.

* **Gestor de Paquetes:** `pnpm` exclusivamente. El comando de testing es `pnpm test`.
* **Infraestructura de Pruebas:** Se utilizará Vitest como framework de testing (configuración minimalista sin dependencias de navegador).
* **Mocking de Base de Datos:** Para los archivos de prueba (`*.test.js`), la instancia física de PGLite apuntando a `IndexedDB` debe ser sustituida automáticamente por una instancia **en memoria** (`memory://`). Esto garantiza que los tests de integración limpien y reconstruyan las tablas en milisegundos sin alterar los datos reales del usuario.
* **Casos de Test Obligatorios por Componente:**
* **Módulo DB:** Validar inserciones correctas, restricciones de claves únicas, y la mitigación de inyecciones (verificación de prepared statements).
* **Módulo Analítico:** Tests unitarios específicos para la fórmula de Epley, asegurando que un peso de `0` (BW) devuelva estrictamente `0` y no un error matemático o infinito (`Infinity`).
* **Módulo CSV:** Validar que la cadena exportada contenga la primera fila de contrato exacta y que la importación de un string corrupto ejecute el `ROLLBACK` de seguridad.

#### 9.3. Bucle de Depuración Obligatorio (Ciclo de Calidad Agéntica)

Ninguna tarea o implementación de una Historia de Usuario se considera "Finalizada" si no supera con éxito el siguiente flujo cerrado de testing y auto-corrección:

```text
  [ Escribir / Modificar Código ] ──> [ Ejecutar: pnpm test ]
                 ▲                                │
                 │ (Si hay fallos / Errores SQL)  ▼
        [ Bucle de Depuración ] ◄─────── [ ¿El Test Falló? ]
                 │                                │
                 │                                ▼ (Si todo está en Verde)
                 └─────────────────────── [ Implementación Exitosa ]

```

1. **Fase Roja (Aislamiento del Fallo):** Tras codificar una funcionalidad o HU, el agente debe ejecutar de inmediato `pnpm test`. Si un test falla, el agente tiene prohibido continuar desarrollando otras funciones o interfaces.
2. **Fase Verde (Bucle de Depuración Iterativo):** El agente analizará el log de errores (*stack trace*), localizará la incoherencia en la consulta SQL o el error de manipulación del DOM, corregirá el código fuente y volverá a lanzar `pnpm test`.
3. **Refactorización de Seguridad:** Una vez que todos los tests pasen en verde, el agente revisará el código modificado para asegurar que cumple con las Reglas de Estilo (Sección 9.1) y las mitigaciones OWASP (Sección 8), ejecutando los tests una última vez antes de dar la tarea por concluida.

---
