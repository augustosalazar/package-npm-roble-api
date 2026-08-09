# Changelog

## 2.0.0

### Añadido

- `register()` y `registerWithVerification()` aceptan un `extra` opcional
  (`Record<string, any>`) con campos adicionales que el backend guarda junto
  al usuario. Se envía en el campo `extra` del cuerpo, y se omite si no se
  pasa.

### Cambios incompatibles

- La configuración se reduce a `{baseUrl, contractId, timeoutMs?}`. Se
  eliminan `projectId`, `authHeaders`, `dataHeaders` y `pathBuilder`: ninguno
  era necesario para hablar con ROBLE, que solo requiere `Content-Type` y
  `Authorization`, y ambos los pone el cliente. `contractId` se usa ahora para
  las dos rutas, `/auth` y `/database`.

## 1.1.0

> No publicada: sus cambios salieron en 2.0.0.

Cobertura completa de la API documentada de ROBLE: de 8 a 19 endpoints.

### Añadido

- Autenticación: `registerWithVerification()` (`/signup`), `verifyEmail()`,
  `resendCode()`, `currentUser()` (`/verify-token`, el único endpoint que
  devuelve la identidad del usuario), `forgotPassword()`, `resetPassword()` y
  `deleteAccount()`.
- Datos: `createMany()` (`/insert`), `executeQuery()` (`/execute-query`, la vía
  para joins, orden y paginación), `createTableFromTemplate()` y
  `publicRead()` (`/public-read`, sin autenticación).
- Tipos `RobleInsertResult`, `RobleSkippedRecord`, `RobleQueryResult` y
  `RobleUser`.

### Corregido

- **`create()` podía informar éxito sobre una fila rechazada.** Enviaba el
  registro a `/insert`, que responde `200` con `{inserted: [], skipped: [...]}`
  cuando el servidor lo rechaza; al no haber nada en `inserted`, el método
  devolvía ese objeto como si fuera la fila creada, sin `_id` y sin error.
  Ahora usa `/insert-one`, que devuelve la fila directamente y falla con un
  error HTTP si la rechaza.
- Para insertar varios registros, `createMany()` expone `skipped` en lugar de
  descartarlo. Revisa `hasSkipped` después de cada llamada.

## 1.0.0

Primera versión publicada como `roble-client`. Sustituye a
`react-native-roble-api-database-rena`, y expone exactamente los mismos
métodos que el paquete Flutter `roble`.

### Añadido

- El paquete deja de ser específico de React Native: ya no declara `react` ni
  `react-native` como peer dependencies y se publica con builds ESM y
  CommonJS, por lo que funciona en Node.js, navegador, React, React Native y
  JavaScript sin framework.

- Jerarquía de excepciones: `RobleApiNetworkException`,
  `RobleApiTimeoutException`, `RobleApiFormatException`,
  `RobleApiHttpException` (con `statusCode`) y `RobleApiAuthException`, todas
  derivadas de `RobleApiException`.
- Los fallos de transporte de axios se traducen a excepciones del paquete: un
  timeout produce `RobleApiTimeoutException` y una petición sin respuesta
  produce `RobleApiNetworkException`. Antes escapaban como `AxiosError` crudo.
- Getters `accessToken` y `refreshToken`.
- `projectId` en la configuración: permite que el contrato de autenticación y
  el proyecto de datos usen identificadores distintos.

### Cambiado

- `register` y `login` reciben un objeto (`{email, password, name}` y
  `{email, password}`) en lugar de parámetros posicionales.
- La configuración pasa de `{baseURL, codeUrl}` a
  `{baseUrl, contractId, projectId?}`.
- `getAccessToken()` y `getRefreshToken()` se reemplazan por los getters
  `accessToken` y `refreshToken`.
- `pathBuilder` recibe el identificador ya resuelto según el tipo de ruta.

### Eliminado

- `refreshTokenManual()`. El refresco del token es interno y automático ante
  un `401`.
