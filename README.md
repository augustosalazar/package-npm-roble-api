# 📦 roble-client

Cliente JavaScript/TypeScript para la plataforma Roble API.
https://roble.openlab.uninorte.edu.co/

Este paquete provee una capa ligera para autenticación y operaciones CRUD sobre las bases de datos expuestas por Roble, manteniendo una interfaz simple.

**Funciona en cualquier entorno JavaScript**: Node.js, navegador, React, React Native, Expo, Vue, Svelte o JavaScript sin framework. No depende de React ni de React Native — su única dependencia es [axios](https://axios-http.com/), que funciona en todos esos entornos. Se distribuye con builds ESM y CommonJS, y con tipos de TypeScript incluidos.

Es el equivalente en TypeScript del paquete Flutter [`roble`](https://github.com/augustosalazar/roble_api_database): **ambos exponen exactamente los mismos métodos**, con las mismas excepciones y el mismo comportamiento de refresco de token.

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

---

## 🔐 Manejo de tokens

Tras un `login()` exitoso el cliente guarda el `accessToken` y el `refreshToken`, y los adjunta como `Authorization: Bearer …` en las peticiones siguientes.

```ts
db.accessToken;  // string | null
db.refreshToken; // string | null

// Restaurar una sesión persistida
db.setTokens({ accessToken, refreshToken });

// Descartar la sesión en memoria
db.clearTokens();

// Reaccionar a cada cambio del access token
db.onTokenUpdate = (token) => persistir(token);
```

**Refresco automático:** si una petición de datos responde `401` y hay un `refreshToken` disponible, el cliente renueva el `accessToken` y reintenta la petición **una sola vez**. Esto ocurre de forma interna: no existe un método público para refrescar a mano. Si el refresco falla, lanza `RobleApiAuthException`.

### Mantener la sesión entre reinicios

Sin `storage`, los tokens viven **solo en memoria**: al cerrar la app hay que volver a iniciar sesión. Pásale dónde guardarlos y el cliente se encarga del resto.

```ts
const db = createRobleClient({
  baseUrl, contractId,
  storage: AsyncStorage, // React Native
});

// Al arrancar, antes de pintar pantallas protegidas:
if (await db.restoreSession()) {
  // sesión activa; el access token se renueva solo si hace falta
}
```

El cliente guarda la sesión en cada login y refresco, y la borra al cerrar sesión. En el navegador usa `localStorage` automáticamente si no indicas nada.

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
| `register({email, password, name, extra})` | `POST /signup-direct` | Registra un usuario sin verificación por correo. |
| `registerWithVerification({email, password, name, extra})` | `POST /signup` | Registra y envía un código de 6 dígitos por correo. |
| `verifyEmail({email, code})` | `POST /verify-email` | Confirma el correo con el código recibido. |
| `resendCode({email})` | `POST /resend-code` | Reenvía el código de verificación. |
| `login({email, password})` | `POST /login` + `GET /me` | Inicia sesión, almacena los tokens y devuelve el perfil. |
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

### Tablas

| Método | Endpoint | Descripción |
| --- | --- | --- |
| `createTable(tableName, columns)` | `POST /create-table` | Crea una tabla. Cada columna es `{name, type, nullable?, default?}`. ⚠️ Endpoint no documentado por la API. |
| `createTableFromTemplate({tableName, templateTableName})` | `POST /create-table-from-template` | Clona la estructura de columnas de una tabla existente. Único mecanismo documentado para crear tablas. |
| `getTableData(tableName)` | `GET /table-data` | Datos de la tabla en el esquema `public`. ⚠️ Endpoint no documentado por la API. |

### CRUD

| Método | Endpoint | Descripción |
| --- | --- | --- |
| `create(tableName, data)` | `POST /insert-one` | Inserta un registro y devuelve la fila creada, con su `_id`. |
| `createMany(tableName, records)` | `POST /insert` | Inserta varios registros. Devuelve `RobleInsertResult` con `inserted` y `skipped`. |
| `read(tableName, filters?)` | `GET /read` | Lee registros; cada filtro viaja como query param. Solo igualdad. |
| `publicRead(tableName, filters?)` | `GET /public-read` | Lee una tabla pública **sin autenticación**. Un `403` indica que la tabla no está marcada como pública. |
| `update(tableName, id, data)` | `PUT /update` | Actualiza por `_id`; las claves `_id` e `id` se descartan del cuerpo. |
| `delete(tableName, id)` | `DELETE /delete` | Elimina por `_id`. |
| `executeQuery(id, params?)` | `POST /execute-query` | Ejecuta una consulta guardada en la consola. Vía para joins, orden y paginación. |

> ⚠️ **`createMany` puede tener éxito parcial.** `/insert` responde `200` aunque rechace registros. Revisa siempre `skipped`:
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
| `getAll(tableName)` | `read(tableName)` |
| `getById(tableName, id)` | `read(…, {_id: id})`, devuelve el registro o `null` |
| `getWhere(tableName, column, value)` | `read(…, {[column]: value})` |

---

## ⚡ Realtime

El servicio Realtime es un árbol JSON por proyecto, con una API al estilo de Firebase Realtime Database. El primer segmento de la ruta es la colección.

```ts
const mensajes = db.realtime.ref('messages/general');

const id = await mensajes.push({ texto: 'Hola', autor: 'ana' });
await mensajes.child(id).update({ status: 'read' });

const todos = await mensajes.get();
const soloClaves = await mensajes.get({ shallow: true });

await mensajes.child(id).remove();
```

| Método | HTTP | Descripción |
| --- | --- | --- |
| `db.realtime.ref(path?)` | — | Referencia a una ruta. Sin argumentos, la raíz del proyecto. |
| `db.realtime.collections()` | `GET /realtime/{db}` | Nombres de las colecciones. |
| `db.realtime.health()` | `GET /realtime/health` | Estado de PostgreSQL, event bus y CDC. Sin autenticación. |
| `ref.get({shallow})` | `GET` | Valor JSON en la ruta. Con `shallow`, solo las claves inmediatas. |
| `ref.set(value)` | `PUT` | Sobrescribe. Crea la colección si no existe. |
| `ref.update(fields)` | `PATCH` | Fusiona campos con el objeto existente. |
| `ref.push(value)` | `POST` | Agrega un hijo con ID autogenerado. Devuelve el ID. |
| `ref.remove()` | `DELETE` | Elimina la ruta. Si es solo la colección, la elimina completa. |

Las referencias son inmutables y navegables: `ref.child('a/b')`, `ref.parent`, `ref.key`, `ref.path`.

Con `shallow: true` las hojas conservan su valor y los hijos objeto/array se marcan con `$$kind`:

```json
{ "general": { "$$kind": "object" } }
```

### Suscripciones en tiempo real

Escuchar cambios abre un WebSocket contra el host de realtime. Cada escucha devuelve su función de cancelación.

```ts
// Valor del nodo: emite al suscribirse y tras cada cambio.
const off = db.realtime.ref('messages/general').onValue((valor) => {
  render(valor);
});

// Más adelante:
off();
```

Para el evento crudo, sin releer nada:

```ts
const off = db.realtime.ref('messages/general').onEvent((e) => {
  console.log(e.operation, e.pathString, e.oldValue, e.newValue);
});
```

| Miembro | Descripción |
| --- | --- |
| `ref.onValue(cb, {onError})` | Valor actual del nodo al suscribirse y tras cada cambio. |
| `ref.onEvent(cb, {onError})` | Evento crudo: `operation`, `path`, `pathString`, `oldValue`, `newValue`, `raw`. |
| `db.realtime.status` | `'disconnected' | 'connecting' | 'connected' | 'error'`. |
| `db.realtime.onStatusChange` | Callback en cada cambio de estado. |
| `db.realtime.close()` | Cierra el socket y cancela todas las escuchas. |

Una escucha recibe los cambios de su ruta **y de sus descendientes**. El socket se abre solo cuando hay al menos una escucha, se comparte entre todas, se resuscribe al reconectar y se cierra cuando no queda ninguna.

**`onValue` relee el nodo por REST tras cada evento.** El `newValue` del servidor es parcial y no distingue `PATCH` (fusiona) de `PUT` (sobrescribe), así que reconstruirlo en el cliente daría resultados incorrectos tras un `set()`. Si solo necesitas el evento, `onEvent` no hace ninguna petición extra.

> ⚠️ **`set()` solo acepta objetos y arrays.** A diferencia de Firebase, el servidor rechaza un escalar como cuerpo: `set(0)`, `set(false)` y `set('texto')` devuelven `400`. Para guardar un valor suelto, envuélvelo: `ref.set({ valor: 0 })`.

## ❌ Manejo de errores

Todas las llamadas lanzan una excepción que hereda de `RobleApiException`:

| Excepción | Cuándo se lanza | Mensaje |
| --- | --- | --- |
| `RobleApiNetworkException` | Sin red o DNS no resuelto | `Sin conexión a internet` |
| `RobleApiTimeoutException` | La petición supera `timeoutMs` | `Tiempo de espera agotado` |
| `RobleApiFormatException` | La respuesta no se puede parsear | `Respuesta con formato inválido` |
| `RobleApiHttpException` | El servidor responde fuera de 2xx | El `message` del servidor. Expone además `statusCode`. |
| `RobleApiAuthException` | No hay refresh token, el refresco falla o no hay sesión al cerrar | `Token expirado y no se pudo refrescar: …` |
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
