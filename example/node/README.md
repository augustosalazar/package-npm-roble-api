# Ejemplo en Node.js puro

Demuestra que `roble-client` funciona **sin React ni React Native**: es
TypeScript compilado sobre axios, así que corre en Node, en el navegador y en
cualquier framework.

Hay dos scripts, uno por sistema de módulos:

| Archivo | Módulos | Qué hace |
| --- | --- | --- |
| `index.mjs` | ESM (`import`) | Comprobación offline o ciclo CRUD completo. |
| `index.cjs` | CommonJS (`require`) | Verifica que `require()` funciona y que la jerarquía de excepciones se conserva. |

## Instalación

```bash
npm install
```

## Uso

Sin variables de entorno hace una comprobación offline: crea el cliente,
muestra el estado de los tokens y confirma que las excepciones heredan de
`Error`. No hace ninguna petición de red.

```bash
npm start
```

La variante CommonJS:

```bash
npm run start:cjs
```

## Ciclo completo contra tu contrato

Define las credenciales y el script ejecutará
login → create → read → update → delete → logout:

```bash
ROBLE_CONTRACT_ID=tu_contrato ROBLE_EMAIL=tu@correo.com ROBLE_PASSWORD=TuClave1! npm start
```

En PowerShell:

```powershell
$env:ROBLE_CONTRACT_ID="tu_contrato"; $env:ROBLE_EMAIL="tu@correo.com"; $env:ROBLE_PASSWORD="TuClave1!"; npm start
```

| Variable | Obligatoria | Por defecto |
| --- | --- | --- |
| `ROBLE_CONTRACT_ID` | sí | — |
| `ROBLE_EMAIL` | sí | — |
| `ROBLE_PASSWORD` | sí | — |
| `ROBLE_BASE_URL` | no | `https://roble-api.test-openlab.uninorte.edu.co` |
| `ROBLE_REALTIME_URL` | no | `https://roble-realtime.test-openlab.uninorte.edu.co` |
| `ROBLE_TABLE` | no | `usuarios_test` |
| `ROBLE_COLLECTION` | no | `demo` |

El script inserta un registro, lo lee, lo actualiza y lo elimina, así que no
deja datos atrás. Si la tabla de `ROBLE_TABLE` no existe, omite la parte de
CRUD y continúa con la de Realtime.

## Realtime

La segunda mitad del script demuestra el servicio Realtime contra
`{ROBLE_COLLECTION}/sala`:

- `health()` y `collections()`
- `onEvent` — el evento crudo (`INSERT`, `UPDATE`, `DELETE`) sin peticiones
  extra
- `onValue` — el valor del nodo, al suscribirse y tras cada cambio
- `push()`, `update()` y `remove()` para provocar los eventos
- cancelación de las escuchas y `db.realtime.close()`

El WebSocket solo funciona contra el host de realtime, por eso el cliente se
crea con `realtimeBaseUrl`.

## Manejo de errores

El bloque final de `index.mjs` muestra el patrón recomendado: distinguir el
fallo por el tipo de excepción (`RobleApiHttpException` con su `statusCode`,
`RobleApiAuthException`, `RobleApiTimeoutException`,
`RobleApiNetworkException`) y dejar `RobleApiException` como red de seguridad.
