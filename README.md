# Satisfactory Calculator

Planificador visual de fábricas para [Satisfactory](https://www.satisfactorygame.com/). Colocas
nodos de recurso, edificios, generadores, divisores y unificadores en un lienzo, los unes con
cintas y tuberías, y la calculadora te dice al momento cuánto fluye por cada conexión, qué
edificios se quedan cortos y cuánta energía hace falta.

Todo funciona en el navegador: no hay servidor, cuentas ni telemetría.

## Qué hace

- **Lienzo libre** con zoom, desplazamiento, selección múltiple, copiar/pegar (con sus cintas),
  duplicar y deshacer/rehacer.
- **Buscador de recetas**: escribe lo que quieres fabricar y se añade el edificio ya configurado.
- **Todas las recetas del juego**, incluidas alternativas y de evento, con sus edificios.
- **Extracción**: taladros Mk.1–3, extractores de petróleo y agua y pozos de recursos, con pureza.
- **Logística como en el juego**: divisores y unificadores giratorios con un puerto por lado,
  divisores inteligentes y programables con sus filtros, y uniones de tuberías.
- **Cintas y tuberías por tier**, con cuellos de botella señalados sobre el lienzo.
- **Overclock, esquirlas de energía y Somersloops**, con la fórmula de consumo del juego.
- **Generadores**: biomasa, carbón, combustible, geotérmico y nuclear (con agua y residuos).
- **Resumen**: avisos de lo que no va al 100 %, extracción, productos finales, puntos del
  AWESOME Sink, lista de edificios y balance de energía.
- **Tus fábricas son tuyas**: se guardan solas en el navegador, se exportan a un archivo JSON y
  se comparten con un enlace que lleva la fábrica dentro (nada se sube a ningún sitio).
- **Accesible**: todo se puede hacer con teclado y lector de pantalla.

Los atajos están en el botón **Ayuda** de la aplicación.

## Desarrollo

Requiere Node.js 22 o posterior.

```bash
npm install
npm start        # http://localhost:4200
npm test         # tests unitarios (Vitest)
npm run build    # compilación de producción en dist/
```

Hecho con Angular 22 (componentes standalone y signals), Tailwind CSS 4 y Angular Primitives.

### Estructura

```
src/app/
  core/                Acceso de solo lectura a los datos del juego
  data/                JSON generado desde el juego + sus tipos
  features/planner/    El planificador
    planner.model.ts     Nodos, cintas y geometría del lienzo
    planner.calc.ts      Fórmulas puras: flujos, repartos, energía, rutas
    planner.store.ts     Estado y vistas calculadas (signals)
    planner.plan.ts      Formato de guardado, validación y enlaces
    planner.history.ts   Deshacer / rehacer
    planner.storage.ts   Guardado en el navegador, archivos y enlaces
  ui/                  Controles reutilizables (select, combobox, menú…)
scripts/               Extracción de datos e iconos desde tu instalación del juego
```

## Datos del juego

Los datos no se escriben a mano: salen de tu propia instalación de Satisfactory.

```bash
# Recetas, objetos y edificios, desde CommunityResources/Docs del juego
npm run data:extract -- "D:/Juegos/Satisfactory"

# Iconos, desde una carpeta de texturas exportada con FModel (solo Windows)
npm run icons:extract -- "D:/exports"
```

Tras una actualización del juego basta con volver a ejecutarlos. Los planes guardados que usen
algo que ya no exista se abren igualmente: lo desconocido se descarta.

## Aviso

Proyecto de fans sin relación con Coffee Stain Studios. Satisfactory, sus nombres e iconos son
propiedad de Coffee Stain Studios AB.
