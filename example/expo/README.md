# Ejemplo con Expo (React Native)

App de prueba que consume `roble-client` desde npm. Tiene un botón por
operación y un log en pantalla con el resultado de cada llamada.

Es un proyecto Expo independiente: no forma parte de ningún workspace y no
comparte `node_modules` con la librería.

## Instalación

```bash
npm install
```

## Uso

```bash
npm start
```

Expo abrirá el panel donde puedes elegir plataforma. También hay atajos:

```bash
npm run android
```

```bash
npm run ios
```

```bash
npm run web
```

## Configuración

El cliente se crea en [`src/App.tsx`](src/App.tsx). Cambia `contractId` por el
identificador de tu contrato antes de probar:

```ts
const db = createRobleClient({
  baseUrl: 'https://roble-api.openlab.uninorte.edu.co',
  contractId: 'tu_contrato',
});
```

## Qué demuestra

| Botón | Métodos |
| --- | --- |
| Crear usuario | `register({name, email, password})` |
| Iniciar sesión | `login({email, password})` |
| Cerrar sesión | `logout()` |
| Crear tabla de prueba | `createTable(tableName, columns)` |
| Agregar dato a tabla | `create(tableName, data)` |
| Probar CRUD | `create` → `read` → `update` → `delete` |
| Escuchar realtime | `ref('demo/sala').onValue(...)` y su cancelación |
| Agregar a realtime | `ref('demo/sala').push(...)` |

El encabezado del log muestra el estado de la conexión WebSocket
(`disconnected`, `connecting`, `connected`, `error`) vía
`db.realtime.onStatusChange`.

Además muestra dos detalles del cliente:

- **`onTokenUpdate`**: el estado del token en la UI lo actualiza el propio
  cliente, no el código de la pantalla. Se registra una sola vez en un
  `useEffect`.
- **Excepciones tipadas**: el `catch` del login distingue
  `RobleApiHttpException` (con `statusCode`) del resto, en lugar de leer
  `e.message` a ciegas.

## Comprobar tipos

```bash
npm run typecheck
```
