# Dolarito · servidor

Servidor (Node.js) que **consulta cada 30 minutos** el tipo de cambio del dólar en los bancos de Bolivia, el
oficial del BCB y las plataformas digitales (P2P de USDT y billeteras). Calcula los mejores precios y
promedios, guarda un historial diario y lo expone en una **API REST** y una **página web**.

Es la fuente de datos principal de la [app móvil de Dolarito](../MonitosMovil). La app también funciona
sin este servidor (consulta desde el teléfono), pero con él gasta menos datos y batería, tiene historial
completo e incluye Wallbit.

> Los datos son referenciales. Confirma la cotización con tu banco antes de operar.

---

## Contenido

1. [Requisitos](#requisitos)
2. [Puesta en marcha](#puesta-en-marcha)
3. [Configuración](#configuración)
4. [Usarlo desde la app móvil](#usarlo-desde-la-app-móvil)
5. [API](#api)
6. [Fuentes](#fuentes)
7. [Estructura](#estructura)
8. [Pruebas](#pruebas)
9. [Agregar o corregir una entidad](#agregar-o-corregir-una-entidad)
10. [Activar Wallbit](#activar-wallbit)
11. [Estimación de Meru](#estimación-de-meru)
12. [Seguridad](#seguridad)

---

## Requisitos

- **Node.js 20 o superior** (usa `fetch`, `node --test` y `process.loadEnvFile`).
- **Chromium de Playwright**: lo instala `npm run setup`. Algunas páginas de bancos cargan la cotización con
  JavaScript y necesitan un navegador.

## Puesta en marcha

```bash
npm run setup     # instala dependencias y Chromium para Playwright
npm start         # http://localhost:3000
```

Al arrancar, si los datos guardados tienen más de 30 minutos, el servidor consulta de inmediato. Luego repite
cada 30 minutos, contando desde la última consulta (también las manuales).

| Comando          | Qué hace                                                       |
| ---------------- | -------------------------------------------------------------- |
| `npm start`      | Inicia el servidor                                             |
| `npm run dev`    | Servidor con recarga automática al editar el código            |
| `npm run scrape` | Hace una consulta única y muestra una tabla en la terminal     |
| `npm test`       | Pruebas de los extractores con textos reales de los bancos     |

## Configuración

Copia `.env.example` como `.env` y completa lo que necesites. **`.env` está en `.gitignore`**: no se sube al
repositorio.

| Variable                          | Por defecto | Descripción                                          |
| --------------------------------- | ----------- | ---------------------------------------------------- |
| `WALLBIT_API_KEY`                 | —           | Clave personal de Wallbit (ver [Activar Wallbit](#activar-wallbit)) |
| `PORT`                            | `3000`      | Puerto HTTP                                          |
| `REFRESH_INTERVAL_MINUTES`        | `30`        | Frecuencia de la actualización automática            |
| `MANUAL_REFRESH_COOLDOWN_SECONDS` | `60`        | Espera mínima entre actualizaciones manuales         |
| `SCRAPE_CONCURRENCY`              | `4`         | Sitios consultados en paralelo                       |
| `SOURCE_TIMEOUT_MS`               | `45000`     | Tiempo máximo por sitio                              |
| `HISTORY_DAYS`                    | `90`        | Días de historial que se conservan                   |
| `DATA_DIR`                        | `./data`    | Carpeta de `rates.json` e `history.json`             |

Cualquier cambio en `.env` se aplica al **reiniciar** el servidor.

## Usarlo desde la app móvil

El servidor escucha en todas las interfaces de red, así que un teléfono en la misma Wi‑Fi puede usarlo:

1. Inicia el servidor con `npm start`.
2. La primera vez, si Windows lo pregunta, permite que **Node.js** use **redes privadas**.
3. Averigua la IP de la computadora con `ipconfig` (línea “Dirección IPv4” del adaptador Wi‑Fi).
4. En la app: **Ajustes → Servidor de datos**, escribe `IP:3000` (por ejemplo `192.168.0.10:3000`), toca
   **Probar** y **Guardar**.

En el emulador de Android la dirección es `10.0.2.2:3000` (la app ya la usa por defecto).

## API

| Método | Ruta                   | Descripción                                                                 |
| ------ | ---------------------- | --------------------------------------------------------------------------- |
| GET    | `/api/rates`           | Cotizaciones, oficial BCB, indicadores y estado de la actualización         |
| GET    | `/api/history?days=30` | Serie diaria en hora de Bolivia (máximo 365 días)                           |
| POST   | `/api/refresh`         | Inicia una actualización en segundo plano (`202`), o `429` si es muy pronto (con `retryAfter`) |
| GET    | `/api/health`          | Estado del servicio y última corrida                                        |

Cada cotización incluye `status`:

| Estado        | Significado                                                       |
| ------------- | ----------------------------------------------------------------- |
| `ok`          | Confirmada en la última consulta                                  |
| `stale`       | El sitio falló; se muestra el último valor conocido               |
| `unavailable` | Nunca se pudo obtener                                             |
| `unsupported` | La entidad no publica su cotización                               |
| `estimated`   | Valor calculado, no publicado (Meru)                              |

Mientras corre una actualización, `refresh.progress` indica `done`, `total` y `startedAt`. La app usa esos
datos, junto con la duración de la corrida anterior, para mostrar “n de m · faltan ~X s”.

Para los navegadores, CORS solo está habilitado en las lecturas (`GET`). Las apps nativas no tienen esa
restricción.

## Fuentes

| Entidad | Cómo se obtiene |
| --- | --- |
| BMSC, Banco Económico, Takenos | API JSON pública de la entidad |
| BNB | Texto de la franja “Tipos de Cambio” de su portal (HTML simple, sin Chromium) |
| BCP, BISA, Unión, Ganadero, FIE, BancoSol, Prodem, Fortaleza, BCB | Texto visible de su sitio web (Chromium sin interfaz) |
| Binance, Bybit, OKX y Bitget P2P (USDT) | APIs públicas de sus mercados P2P; mediana de los 5 mejores anuncios de compra y de venta |
| El Dorado (USDT) | API pública de cotización (modo invitado); precio efectivo con comisiones para 100 USDT por QR |
| Airtm | Endpoint JSON de su convertidor público (vía Chromium, porque rechaza clientes HTTP de Node) |
| Wallbit | API oficial `GET /api/public/v1/rates` con tu clave (ver [Activar Wallbit](#activar-wallbit)) |
| Meru (estimado) | No publica su tasa: se estima con la mediana P2P en vivo × el margen observado en su app |
| PE$O | No publica su cotización en la web (solo en su app); se muestra sin valor |

Si falla el BCB, el oficial se toma del valor que reporta la mayoría de los bancos. Los indicadores (mejor
compra y venta, promedios, brecha) usan solo cotizaciones confirmadas en las últimas 48 h y nunca las
estimadas.

Los logos de las entidades están en `public/img/logos/<id>.png` (128×128); si falta alguno, la interfaz
muestra la sigla. El logo de Dolarito (cabecera, favicon e ícono para iPhone) está en `public/img/brand/` y se
genera desde la app móvil (ver “Logo e ícono” en su README).

## Estructura

```
src/
  server.js              Arranque de Express, programador y cierre ordenado
  config.js              Configuración centralizada (lee .env)
  routes/api.js          Endpoints REST
  cli/scrape.js          Consulta única desde la terminal
  services/
    rateService.js       Estado, corridas (una a la vez), historial y respuesta de la API
    scheduler.js         Actualización automática (se reinicia tras cada corrida)
    summary.js           Indicadores: mejor compra y venta, promedios, brecha
  scrapers/
    sources.js           Catálogo de entidades: cómo se obtiene cada cotización
    context.js           HTTP, JSON y Chromium compartido
    parse.js             Extracción y validación de números
    index.js             Ejecución en paralelo con límite y tiempos de espera
  storage/jsonStore.js   Lectura tolerante a fallos y escritura atómica
  utils/logger.js        Registros con hora
public/                  Página web (index.html, css, js) y logos
data/                    rates.json e history.json (generados, no se versionan)
test/parse.test.js       Pruebas con node:test
```

## Pruebas

```bash
npm test
```

Las pruebas (18) usan **fragmentos reales** de las páginas de los bancos. Si una entidad cambia su sitio, la
prueba correspondiente falla antes de que el dato llegue mal a la app.

## Agregar o corregir una entidad

Edita `src/scrapers/sources.js`. Cada entrada define `fetch(tools)` y devuelve `{ buy, sell, official? }` en
bolivianos por dólar (`buy` = lo que el banco te paga; `sell` = lo que te cobra).

| Herramienta | Cuándo usarla |
| --- | --- |
| `getJson(url)` / `postJson(url, body)` | La entidad tiene una API JSON (lo más rápido y estable) |
| `getText(url)` | El dato ya viene en el HTML (como el BNB): extrae con `normalizeText` + `rateAfter` |
| `getPageText(url, { waitFor })` | La página carga el dato con JavaScript (usa Chromium) |
| `getBrowserJson(url)` | Una API que rechaza clientes HTTP de Node (como Airtm) |

Extrae con `rateAfter(texto, 'Etiqueta')` y acota con `section()` cuando la etiqueta aparece varias veces.

**Después de cada cambio:**

1. Agrega el texto real del sitio a `test/parse.test.js` y corre `npm test`.
2. **Replica el cambio en la app móvil de Dolarito:** `lib/features/rates/data/device/scraping/sources.dart`, que
   usa la misma lógica en el modo autónomo, y su prueba en `test/features/device_mode_test.dart`.
3. Si es una entidad nueva, agrega su logo en `public/img/logos/<id>.png` y, en la app móvil, en
   `assets/logos/<id>.png`.

## Activar Wallbit

Wallbit solo entrega su cotización por su API oficial, que requiere una clave personal:

1. En Wallbit, ve a **Settings → API Keys** y crea una clave con permiso **Read** (solo lectura; nunca
   actives **Trade**).
2. Copia `.env.example` como `.env` y pega la clave en `WALLBIT_API_KEY=`.
3. Reinicia el servidor.

La clave solo se envía a `api.wallbit.io`, nunca se muestra en la web ni en los registros y **no se copia a la
app móvil**. Se hacen 2 consultas por actualización, muy por debajo del límite de la API (60 por minuto).

## Estimación de Meru

Meru no publica su cotización, así que se **estima**: la mediana P2P en vivo (Binance, Bybit, OKX y Bitget) se
multiplica por el margen relativo que tenía Meru frente a ese mismo P2P cuando se observó su app. Se muestra con
**≈** y estado **Estimado**, y no participa en “mejor opción” ni en los promedios.

Calibración actual (`MERU_CALIBRATION` en `src/scrapers/sources.js`), 17 oct 2026:

| | P2P en ese momento | Meru (app) | Margen |
| --- | --- | --- | --- |
| Comprar USD | 11,8535 | 12,19 | +2,84 % |
| Vender USD | 11,82 | 11,78 | −0,34 % |

**Para recalibrar:**
1. Anota la compra y la venta que muestra la app de Meru.
2. En el mismo minuto, corre `npm run scrape`.
3. Copia la mediana P2P de ese momento en `reference` y lo que viste en Meru en `observed`.
4. Actualiza también `meruObserved` y `meruReference` en la app móvil de Dolarito:
   `lib/features/rates/data/device/scraping/sources.dart`.

Conviene hacerlo si la estimación se aleja de lo que muestra la app de Meru, que puede cambiar su margen sin
aviso.

## Seguridad

- **Claves:** solo en `.env`, que no se versiona. Ninguna clave está escrita en el código.
- **Cabeceras:** se envían `X-Content-Type-Options: nosniff` y `Referrer-Policy`, y no se expone
  `X-Powered-By`.
- **Abuso:** la actualización manual tiene un tiempo de espera mínimo (`429` con `retryAfter`) y nunca corren
  dos actualizaciones a la vez.
- **Producción:** publícalo detrás de **HTTPS** antes de usarlo fuera de tu red local.
