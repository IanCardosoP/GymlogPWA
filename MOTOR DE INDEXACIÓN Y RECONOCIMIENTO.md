# ESPECIFICACIÓN TÉCNICA: MOTOR DE INDEXACIÓN Y RECONOCIMIENTO DINÁMICO DE EJERCICIOS (LITERT.JS)

## 1. Arquitectura del Sistema (Offline-First)

El sistema opera completamente en el lado del cliente (Client-Side) utilizando la aceleración de hardware del navegador via **WebGPU** (prioritaria) o **WebAssembly / XNNPack** (fallback) administrada por el ciclo de vida del _Service Worker_ de la PWA.

```
       [ UX: Buscador / Cámara ]
                   │
                   ▼
     ┌─────────────┴─────────────┐
     ▼                           ▼
[Módulo Visión]          [Módulo Texto]
- MobileNetV3/YOLO       - Universal Sentence Encoder
- MoveNet (Pose)         - Similitud de Coseno
     │                           │
     └─────────────┬─────────────┘
                   ▼
       [Normalizador Semántico]
                   │
    (Mapeo a Patrón Raíz + WebP)
                   │
                   ▼
       [Persistencia: IndexedDB]
```

## 2. Especificación de Modelos Inteligentes (LiteRT)

Para mantener la PWA ligera y asegurar tiempos de descarga mínimos, todos los modelos seleccionados deben utilizar **cuantización INT8 o FP16**.

|**Módulo Inteligente**|**Arquitectura Base / Modelo**|**Formato**|**Tamaño Objetivo**|**Propósito Técnico**|
|---|---|---|---|---|
|**NLP (Buscador Semántico)**|_Universal Sentence Encoder (USE)_ o _MiniLM-L6_|`.tflite` (INT8)|`< 15 MB`|Generación de vectores densos (embeddings) de 256/384 dimensiones a partir de texto libre.|
|**Visión (Detección Máquinas)**|_MobileNetV3-Small_ o _YOLOv8-nano_|`.tflite` (INT8)|`< 5 MB`|Clasificación de bounding boxes para identificar equipamiento deportivo (mancuernas, racks, poleas).|
|**Visión (Estimación de Pose)**|_MoveNet Lightning_|`.tflite` (FP16)|`< 3 MB`|Detección en tiempo real de 17 puntos clave de articulaciones para deducir vectores cinemáticos.|

## 3. Flujo de Datos y Pipelines de Inferencia

### A. Pipeline de Texto (Búsqueda Semántica)

1. El usuario introduce texto crudo en la interfaz.
    
2. El string se tokeniza y se pasa por el modelo de embeddings de LiteRT.js:
    
    $$\vec{u} = \text{LiteRT\_Infer}(\text{input\_texto})$$
    
3. Se realiza un cálculo matricial local utilizando la **Similitud de Coseno** contra la matriz de patrones raíz prefijados ($\vec{p}_i$):
    
    $$\text{Similitud} = \frac{\vec{u} \cdot \vec{p}_i}{\Vert{}\vec{u}\Vert{} \Vert{}\vec{p}_i\Vert{}}$$
    
4. **Umbral de Decisión:**
    
    - Si $\text{Similitud} \ge 0.68$: Se empareja automáticamente con el patrón existente.
        
    - Si $\text{Similitud} < 0.68$: Se clasifica como "Ejercicio Personalizado" y se infiere el grupo muscular mediante análisis de palabras clave (_tags_).
        

### B. Pipeline de Visión (Reconocimiento Combinado)

Para mitigar el drenaje de batería, la inferencia visual no es continua:

**1.Muestreo Controlado de Fotogramas:**Frecuencia: 5-8 FPS.

Se abre la cámara mediante `getUserMedia` y se extraen fotogramas reducidos (224x224 px) usando un `OffscreenCanvas`.

**2.Inferencia en Cascada (Detección + Pose):**Paralelismo Local.

Se ejecutan los dos modelos simultáneamente sobre el mismo frame. El modelo de objetos devuelve las entidades presentes y el de pose extrae los vectores de movimiento y ángulos articulares.

**3.Fusión de Características Mapeadas:**Lógica Heurística.

Se evalúa la coocurrencia de datos. Ejemplo: Si `Objeto == "Polea alta"` y el vector de pose muestra `Ángulo_Codo` pasando de 180° a 90° de manera vertical, se deduce con alta probabilidad: _Jalón al pecho_.

## 4. Estructura de Datos Dinámica (Almacenamiento Local)

Para romper la rigidez de una base de datos centralizada, los datos se almacenan en **IndexedDB** estructurados en dos almacenes de objetos principales (_Object Stores_):

### Almacén 1: `patrones_raiz` (Estático/Ligero)

Contiene las abstracciones anatómicas fundamentales. Es el que está vinculado a los recursos gráficos (`.webp`).

JSON

```
{
  "id": "patron_traccion_vertical",
  "nombre_estandar": "Tracción Vertical",
  "grupo_muscular_primario": "Espalda (Dorsal Ancho)",
  "asset_visual": "/assets/ejercicios/traccion_vertical.webp",
  "embedding_referencia": [0.012, -0.045, 0.231, "...", 0.089]
}
```

### Almacén 2: `ejercicios_usuario` (Dinámico/Incremental)

Este almacén crece de forma orgánica a medida que el usuario entrena y confirma detecciones de la IA.

JSON

```
{
  "id": "uuid_generado_localmente",
  "nombre_ingresado": "Jalón al pecho con agarre supino", 
  "patron_raiz_id": "patron_traccion_vertical",
  "grupo_muscular": "Espalda (Dorsal Ancho)",
  "origen_deteccion": "vision", // Opciones: 'texto' o 'vision'
  "historico_series": [], // Array de series (Peso x Reps) mapeadas a este ID
  "ultima_vez_usado": "2026-07-11T21:25:33Z"
}
```

## 5. Estrategia de UX y Carga de Assets

1. **Confirmación en un Toque (Soft Match):** La IA jamás inserta datos directamente en la bitácora histórica sin validación del usuario. Presenta una tarjeta con la imagen ligera del patrón (`asset_visual`) y un botón de confirmación de acción rápida.
    
2. **Estrategia de Almacenamiento en Caché (Cache Storage API):** Los modelos `.tflite` y el set de imágenes de patrones raíz (~20 archivos `.webp`) se descargan en la primera carga de la PWA mediante el _Cache Storage API_. Una vez guardados, las interacciones subsiguientes tienen latencia cercana a cero ($<20\text{ms}$).
# 6. Notas y correciones
1.  <-- Formato correcto para que funcione la IA en ambos sistemas sin romper la UI --> <video id="camara-stream" autoplay playsinline muted>"
2. Limitaciones Críticas en iOS que debes vigilar en 2026

Aunque funciona en ambos sistemas, Apple impone ciertas limitaciones que afectan directamente al rendimiento de modelos de IA como LiteRT:

- **Pérdida de Contexto en Segundo Plano:** En iOS, si el usuario minimiza la PWA o bloquea la pantalla con la cámara encendida, Safari **apaga inmediatamente el stream de la cámara** por motivos de privacidad. Tu código debe estar listo para escuchar el evento `visibilitychange` y reiniciar la cámara limpiamente cuando el usuario regrese.
    
- **WebGPU vs. WebAssembly:** Mientras que en Android WebGPU ya vuela para acelerar LiteRT, en iOS el soporte para WebGPU dentro de PWAs guardadas en la pantalla de inicio suele ser más conservador o requerir fallbacks robustos a **WebAssembly (Wasm) con XNNPack**. Asegúrate de configurar LiteRT para que si WebGPU falla, use Wasm automáticamente.
    
- **Límite de Memoria RAM:** iOS es muy estricto con el uso de memoria en apps web. Si intentas cargar al mismo tiempo el modelo de visión, el de pose y el de embeddings de texto, iOS podría forzar el reinicio de la PWA (Web Process Crash). **Por eso es vital usar modelos cuantizados INT8 pequeños (<15MB total) como definimos en las especificaciones.**
- 