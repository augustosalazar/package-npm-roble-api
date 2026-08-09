# 📦 react-native-roble-api-database

Paquete para React Native que facilita la comunicación con la plataforma Roble API.
https://roble.openlab.uninorte.edu.co/

Este paquete provee una capa ligera para autenticación y operaciones CRUD sobre las bases de datos expuestas por Roble, manteniendo una interfaz simple y adecuada para aplicaciones móviles.

Es el equivalente en TypeScript del paquete Flutter [`roble_api_database`](https://github.com/Arias3/roble_api_database): **ambos exponen exactamente los mismos métodos**, con las mismas excepciones y el mismo comportamiento de refresco de token.

https://github.com/Arias3/roble-api-database-ReNa

## 🚀 Instalación

```bash
npm install react-native-roble-api-database-rena
```

Importa el paquete donde lo necesites:

```ts
import {
  createRobleClient,
  RobleApiException,
  RobleApiHttpException,
} from 'react-native-roble-api-database-rena';
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

// Iniciar sesión (guarda los tokens internamente)
await db.login({ email: 'usuario@email.com', password: 'Password123!' });

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
  projectId: 'token_project_xyz', // opcional
  authHeaders: { 'x-app': 'roble-mobile' }, // opcional
  dataHeaders: { 'x-app': 'roble-mobile' }, // opcional
  timeoutMs: 30_000, // opcional, default 30 s
});
```

| Campo | Descripción |
| --- | --- |
| `baseUrl` | Host del backend. Una barra final se ignora. |
| `contractId` | Identificador del contrato de autenticación → `/auth/{contractId}`. |
| `projectId` | Identificador del proyecto de datos → `/database/{projectId}`. Si se omite, se reutiliza `contractId`. |
| `authHeaders` / `dataHeaders` | Headers extra por grupo de endpoints. |
| `timeoutMs` | Timeout por petición, 30 000 ms por defecto. |
| `pathBuilder` | Escape hatch para componer rutas no estándar. Sin equivalente en el paquete Flutter. |

`Content-Type: application/json` se agrega automáticamente.

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

---

## 📚 Referencia de métodos

### Autenticación

| Método | Endpoint | Descripción |
| --- | --- | --- |
| `register({email, password, name})` | `POST /signup-direct` | Registra un usuario sin verificación por correo. |
| `login({email, password})` | `POST /login` | Inicia sesión y almacena los tokens. |
| `logout()` | `POST /logout` | Cierra la sesión y limpia los tokens. Lanza `RobleApiAuthException` si no hay sesión. |

### Tablas

| Método | Endpoint | Descripción |
| --- | --- | --- |
| `createTable(tableName, columns)` | `POST /create-table` | Crea una tabla. Cada columna es `{name, type, nullable?, default?}`. |
| `getTableData(tableName)` | `GET /table-data` | Datos de la tabla en el esquema `public`. |

### CRUD

| Método | Endpoint | Descripción |
| --- | --- | --- |
| `create(tableName, data)` | `POST /insert` | Inserta un registro y devuelve el insertado. |
| `read(tableName, filters?)` | `GET /read` | Lee registros; cada filtro viaja como query param. |
| `update(tableName, id, data)` | `PUT /update` | Actualiza por `_id`; las claves `_id` e `id` se descartan del cuerpo. |
| `delete(tableName, id)` | `DELETE /delete` | Elimina por `_id`. |

### Conveniencia

| Método | Equivale a |
| --- | --- |
| `getAll(tableName)` | `read(tableName)` |
| `getById(tableName, id)` | `read(…, {_id: id})`, devuelve el registro o `null` |
| `getWhere(tableName, column, value)` | `read(…, {[column]: value})` |

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

## 📱 Ejemplo completo

El directorio [`example/`](example/) contiene una app Expo que ejercita registro, login, logout, creación de tabla e inserción, y el ciclo CRUD completo.

```bash
yarn install
yarn example start
```

---

## 🛠️ Contribuciones

Las contribuciones son bienvenidas. Si encuentras un bug o quieres proponer una mejora, abre un issue en el repositorio.
