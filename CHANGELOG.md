# Changelog

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
