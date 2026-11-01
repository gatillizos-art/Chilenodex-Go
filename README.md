# Chilenodex 🦅🌿

Juego de exploración con GPS para Android (PWA instalable): caminas, aparecen especies de la flora y fauna de Chile según tu zona, hábitat y hora, y las fotografías o registras para completar tu Chilenodex.

- **71 especies** (40 fauna, 31 flora) en 7 zonas: Norte Grande, Norte Chico, Chile Central, Sur, Zona Austral, Rapa Nui y Juan Fernández.
- Especies nocturnas (monito del monte, chingue, búhos), marinas (solo cerca del mar) y de distintas rarezas.
- Mini-juego de foto: toca cuando el anillo calce. Piñones como cebo, refugios, niveles, fichas con datos curiosos.
- Funciona sin conexión (el mapa se cachea) y guarda el progreso en el teléfono.

## Cómo jugarlo en tu Android

El GPS del navegador exige **HTTPS**, así que hay que publicar la carpeta en algún sitio:

1. **GitHub Pages** (gratis): sube todos los archivos de esta carpeta a un repositorio, activa *Settings → Pages* y abre la URL desde Chrome en el teléfono.
   (Alternativas: Netlify, Cloudflare Pages.)
2. En Chrome: menú ⋮ → **Instalar app** / *Agregar a la pantalla de inicio*.
3. Al abrir, elige **Jugar con GPS** y acepta el permiso de ubicación.

Para probar en el computador: `python3 -m http.server 8000` y abre `http://localhost:8000` (localhost cuenta como seguro).

**Sin salir de casa:** *Probar sin GPS* activa los botones de dirección (o flechas/WASD en PC), y en *Ajustes* puedes teletransportarte a Arica, Pucón, Chiloé, Torres del Paine, Rapa Nui, etc., y forzar zona y hábitat.

## Estructura

| Archivo | Qué contiene |
|---|---|
| `data.js` | Zonas, hábitats, rarezas y **todas las especies** |
| `core.js` | Lógica pura: zonas por coordenada, apariciones, puntaje (sin DOM) |
| `map.js` | Mapa propio en canvas con mosaicos de OpenStreetMap |
| `game.js` | Interfaz, GPS, encuentros, Chilenodex, ajustes |
| `sw.js`, `manifest.webmanifest`, los íconos | Modo offline e instalación |

## Agregar una especie

En `data.js`, dentro de `CX.ESPECIES`:

```js
{ id: 'coipo', n: 'Coipo', c: 'Myocastor coypus', t: 'fauna', em: '🦫',
  z: [C, S], h: ['humedal'], r: 'poco', e: 'LC',
  d: 'Dato curioso…' }
```
`t`: fauna | flora · `z`: zonas · `h`: hábitats · `r`: comun, poco, raro, epico, legendario · `e`: LC, NT, VU, EN, CR, EW o `null` · opcional `noche: true` o `marino: true`.
Al actualizar archivos, cambia `VERSION` en `sw.js` para que los teléfonos descarguen la nueva versión.

## Cosas que debes revisar antes de publicar

- **Estados de conservación y datos curiosos son referenciales** (criterio UICN, escritos de memoria). Contrástalos con el Reglamento de Clasificación de Especies del Ministerio del Medio Ambiente y con fuentes como CONAF o el Museo Nacional de Historia Natural.
- **Mapa:** usa los mosaicos públicos de OpenStreetMap, aceptables para pruebas y uso ligero. Si el juego crece, cambia `tileUrl` en `map.js` por un proveedor propio o de pago (ver la política de uso de tiles de OSM).
- **Hábitat:** se estima con la API Overpass de OpenStreetMap; si no responde, el juego usa el hábitat típico de la zona.
- **Seguridad:** el juego desactiva encuentros si detecta velocidad de vehículo. Mantén los avisos de no jugar conduciendo y de no molestar a la fauna real.
- Los gráficos son emojis; si quieres ilustraciones propias, cámbialos en `em` por imágenes y ajusta el dibujo en `game.js`.

## ¿Quieres un APK?

Esta PWA se puede empaquetar como app de Play Store con Bubblewrap (Trusted Web Activity) o Capacitor una vez que esté publicada en HTTPS.

Mapa © colaboradores de OpenStreetMap.
