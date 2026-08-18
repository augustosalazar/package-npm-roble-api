# 📦 roble-client

Cliente JavaScript/TypeScript para la plataforma Roble API.
https://roble.openlab.uninorte.edu.co/

Este paquete provee una capa ligera para autenticación y operaciones CRUD sobre las bases de datos expuestas por Roble, manteniendo una interfaz simple.

**Funciona en cualquier entorno JavaScript**: Node.js, navegador, React, React Native, Expo, Vue, Svelte o JavaScript sin framework. No depende de React ni de React Native — su única dependencia es [axios](https://axios-http.com/), que funciona en todos esos entornos. Se distribuye con builds ESM y CommonJS, y con tipos de TypeScript incluidos.

Es el equivalente en TypeScript del paquete Flutter [`roble`](https://github.com/augustosalazar/roble_api_database): **ambos exponen los mismos métodos**, con las mismas excepciones y el mismo comportamiento de refresco de token.

La única diferencia es el almacenamiento de la sesión: Flutter usa el almacén seguro del sistema por defecto, mientras que aquí solo hay uno automático en el navegador (`localStorage`). En Node y React Native hay que pasar un `storage`.

https://github.com/augustosalazar/roble-api-database-ReNa

## 🚀 Instalación

```bash
npm install roble-client
```

Importa el paquete donde lo necesites:

```ts
import {
  createRobleClient,
  RobleApiException,
  RobleApiHttpException,
} from 'roble-client';
```

En CommonJS (Node.js sin ESM):

```js
const { createRobleClient } = require('roble-client');
```

---

## 🧭 Quick start

```ts
const db = createRobleClient({
  baseUrl: 'https://roble-api.openlab.uninorte.edu.co',
  contractId: 'tu_contrato',
});

// Registrar usuario
await db.register({
  email: 'usuario@email.com',
  password: 'Password123!',
  name: 'Nombre Usuario',
});

// Iniciar sesión: guarda los tokens y devuelve el perfil
const user = await db.login({
  email: 'usuario@email.com',
  password: 'Password123!',
});
console.log(user.name, user.userId, user.extra);

// CREATE
const nuevo = await db.create('usuarios', { nombre: 'Ana García', edad: 28 });

// READ
const usuarios = await db.read('usuarios');

// UPDATE
await db.update('usuarios', nuevo._id, { edad: 29 });

// DELETE
await db.delete('usuarios', nuevo._id);

// Cerrar sesión (limpia los tokens)
await db.logout();
```

> Nota: todos los métodos son asíncronos y lanzan alguna subclase de `RobleApiException`. Usa `try/catch` alrededor de tus llamadas.

---

## ⚙️ Configuración

```ts
const db = createRobleClient({
  baseUrl: 'https://roble.test-openlab.uninorte.edu.co',
  contractId: 'token_contract_xyz',
  timeoutMs: 30_000, // opcional, default 30 s
});
```

| Campo | Descripción |
| --- | --- |
| `baseUrl` | Host del backend. Una barra final se ignora. |
| `contractId` | Identificador del contrato. Compone `/auth/{contractId}` y `/database/{contractId}`. |
| `timeoutMs` | Opcional. Timeout por petición, 30 000 ms por defecto. |

Eso es toda la configuración. `Content-Type: application/json` y
`Authorization: Bearer …` los gestiona el cliente por su cuenta.

`createRobleClient` **valida sus argumentos y lanza `Error`** si `baseUrl` no es una URL o si el `contractId` está vacío o sigue siendo un valor de ejemplo. Antes eso se manifestaba como un `500` incomprensible en la primera petición.

Además, un `500` en autenticación es lo que devuelve Roble cuando el contrato no existe, así que a ese mensaje se le añade una pista:

```
Error inesperado al autenticar — revisa que el contractId sea correcto (mi_contrato_mal)
```

---

## 🔐 Sesión

Los tokens **no se exponen**. El cliente los guarda, los adjunta a cada petición, los renueva ante un `401` y los borra al cerrar sesión. Lo único que se consulta desde fuera es:

```ts
db.isLoggedIn; // boolean
```

**Refresco automático:** si una petición responde `401` y hay refresh token, el cliente renueva el access token y reintenta **una sola vez**. Es interno: no hay método público para refrescar a mano. Si el refresco falla, lanza `RobleApiAuthException`.

### Mantener la sesión entre reinicios

Sin `storage`, los tokens viven **solo en memoria**: al cerrar la app hay que volver a iniciar sesión. Pásale dónde guardarlos y el cliente se encarga del resto.

```ts
const db = createRobleClient({
  baseUrl, contractId,
  storage: AsyncStorage, // React Native
});

// Al arrancar, antes de pintar pantallas protegidas:
if (await db.restoreSession()) {
  irAlInicio();
} else {
  irAlLogin();
}
```

El cliente guarda la sesión en cada login y refresco, y la borra al cerrar sesión. En el navegador usa `localStorage` automáticamente si no indicas nada.

`restoreSession()` no se limita a leer los tokens guardados: **renueva el access token contra el servidor**, así que un `true` significa que la sesión sirve de verdad. Si el refresh token ya caducó o fue revocado, limpia la sesión y devuelve `false`.

Los fallos de red no borran la sesión: se propaga la excepción para que puedas distinguir "sesión caducada" de "sin conexión".

```ts
try {
  (await db.restoreSession()) ? irAlInicio() : irAlLogin();
} catch (e) {
  if (e instanceof RobleApiNetworkException) mostrarPantallaSinConexion();
}
```

Con `restoreSession({ verify: false })` solo se cargan los tokens del almacenamiento, sin llamar al servidor: arranca más rápido, pero la sesión puede estar caducada.

| Entorno | Qué pasar |
| --- | --- |
| Navegador | nada: usa `localStorage` |
| React Native / Expo | `AsyncStorage`, o `expo-secure-store` |
| Node / CLI | un envoltorio sobre un fichero JSON |
| Tests | un `Map` en memoria |

Solo hacen falta tres métodos, así que casi cualquier almacén encaja tal cual:

```ts
interface RobleStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}
```

> 🔐 En móvil usa un almacén seguro (Keychain/Keystore). El refresh token es la credencial de larga duración: con él se obtienen access tokens nuevos sin la contraseña.

---

## 📚 Referencia de métodos

### Autenticación

| Método | Endpoint | Descripción |
| --- | --- | --- |
| `register({email, password, name, extra, autoLogin, persistSession})` | `POST /signup-direct` | Registra un usuario. Con `autoLogin: true` inicia sesión y devuelve el perfil. |
| `registerWithVerification({email, password, name, extra})` | `POST /signup` | Registra y envía un código de 6 dígitos por correo. |
| `verifyEmail({email, code})` | `POST /verify-email` | Confirma el correo con el código recibido. |
| `resendCode({email})` | `POST /resend-code` | Reenvía el código de verificación. |
| `login({email, password, persistSession})` | `POST /login` + `GET /me` | Inicia sesión y devuelve el perfil. Con `persistSession: false` la sesión vive solo en memoria. |
| `isLoggedIn` | — | `true` si hay sesión iniciada en este cliente. |
| `currentUser()` | `GET /me` | Perfil del usuario autenticado: `userId`, `email`, `name`, `extra` y fechas. |
| `forgotPassword({email})` | `POST /forgot-password` | Envía el correo de restablecimiento. |
| `resetPassword({token, newPassword})` | `POST /reset-password` | Restablece la contraseña con el token del correo. |
| `logout()` | `POST /logout` | Cierra la sesión y limpia los tokens. Lanza `RobleApiAuthException` si no hay sesión. |
| `deleteAccount()` | `DELETE /account` | Elimina la cuenta permanentemente y limpia la sesión. Irreversible. |

Ambos métodos de registro aceptan un `extra` opcional con campos adicionales que el backend guarda junto al usuario:

```ts
await db.register({
  email: 'ana@mail.com',
  password: 'MiClave!1',
  name: 'Ana García',
  extra: { rol: 'admin', programa: 'Ingeniería de Sistemas' },
});
```

### CRUD

| Método | Endpoint | Descripción |
| --- | --- | --- |
| `create(tableName, data)` | `POST /insert-one` | Inserta un registro y devuelve la fila creada, con su `_id`. |
| `createMany(tableName, records, {strict})` | `POST /insert` | Inserta varios registros. Devuelve `RobleInsertResult`. Con `strict: true` lanza `RoblePartialInsertException` si hay rechazos. |
| `read(tableName, filters?)` | `GET /read` | Lee registros; cada filtro viaja como query param. Solo igualdad. |
| `publicRead(tableName, filters?)` | `GET /public-read` | Lee una tabla pública **sin autenticación**. Un `403` indica que la tabla no está marcada como pública. |
| `update(tableName, id, data)` | `PUT /update` | Actualiza por `_id`; las claves `_id` e `id` se descartan del cuerpo. |
| `delete(tableName, id)` | `DELETE /delete` | Elimina por `_id`. |
| `executeQuery(id, params?)` | `POST /execute-query` | Ejecuta una consulta guardada en la consola. Vía para joins, orden y paginación. |

> ⚠️ **`createMany` puede tener éxito parcial.** `/insert` responde `200` aunque rechace registros. Usa `strict: true` para que un rechazo sea un error, o revisa `skipped` a mano:

```ts
try {
  await db.createMany('usuarios', registros, { strict: true });
} catch (e) {
  if (e instanceof RoblePartialInsertException) {
    // e.result.inserted -> lo que SÍ se escribió (útil para deshacer)
    console.warn(e.message);
  }
}
```

>
> ```ts
> const res = await db.createMany('usuarios', registros);
> if (res.hasSkipped) {
>   res.skipped.forEach((s) =>
>     console.warn(`Fila ${s.index} rechazada: ${s.reason}`)
>   );
> }
> ```

### Conveniencia

| Método | Equivale a |
| --- | --- |
| `getById(tableName, id)` | `read(…, {_id: id})`, devuelve el registro o `null` |

---

## ❌ Manejo de errores

Todas las llamadas lanzan una excepción que hereda de `RobleApiException`:

| Excepción | Cuándo se lanza | Mensaje |
| --- | --- | --- |
| `RobleApiNetworkException` | Sin red o DNS no resuelto | `Sin conexión a internet` |
| `RobleApiTimeoutException` | La petición supera `timeoutMs` | `Tiempo de espera agotado` |
| `RobleApiFormatException` | La respuesta no se puede parsear | `Respuesta con formato inválido` |
| `RobleApiHttpException` | El servidor responde fuera de 2xx | El `message` del servidor. Expone además `statusCode`. |
| `RobleApiAuthException` | No hay refresh token, el refresco falla o no hay sesión al cerrar | `Token expirado y no se pudo refrescar: …` |
| `RoblePartialInsertException` | `createMany(…, {strict: true})` con filas rechazadas | `El servidor rechazó 1 de 3 registros: fila 2 (…)`. Expone `result`. |
| `RobleApiException` | Cualquier otro error inesperado | `Error inesperado: …` |

```ts
try {
  const usuarios = await db.read('usuarios');
} catch (e) {
  if (e instanceof RobleApiHttpException) {
    console.log(`El servidor respondió ${e.statusCode}: ${e.message}`);
  } else if (e instanceof RobleApiAuthException) {
    // redirigir al login…
  } else if (e instanceof RobleApiException) {
    console.log(e.message);
  }
}
```

---

## 📱 Ejemplos

En [`example/`](example/) hay dos ejemplos **independientes**, cada uno con su propio `package.json`, su propia instalación y su propio README:

| Carpeta | Entorno | Instalar y ejecutar |
| --- | --- | --- |
| [`example/expo/`](example/expo/) | React Native (Expo) | `cd example/expo && npm install && npm start` |
| [`example/node/`](example/node/) | Node.js puro (ESM y CommonJS) | `cd example/node && npm install && npm start` |

Ambos consumen `roble-client` desde npm, igual que cualquier proyecto tuyo. El ejemplo de Node demuestra que el cliente no necesita React: sin credenciales hace una comprobación offline, y con `ROBLE_CONTRACT_ID`, `ROBLE_EMAIL` y `ROBLE_PASSWORD` ejecuta el ciclo CRUD completo. Ver [`example/README.md`](example/README.md) para probar cambios locales de la librería.

---

## 🛠️ Contribuciones

Las contribuciones son bienvenidas. Si encuentras un bug o quieres proponer una mejora, abre un issue en el repositorio.
