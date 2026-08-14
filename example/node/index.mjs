// Ejemplo de roble-client en Node.js puro (ESM). No importa React ni React Native.
//
//   npm start
//
// Sin credenciales hace una comprobación offline. Con credenciales ejecuta el
// ciclo CRUD completo y una demo de Realtime con suscripción en vivo.
import {
  createRobleClient,
  RobleApiAuthException,
  RobleApiException,
  RobleApiHttpException,
  RobleApiNetworkException,
  RobleApiTimeoutException,
} from 'roble-client';

const {
  ROBLE_BASE_URL = 'https://roble-api.test-openlab.uninorte.edu.co',
  ROBLE_REALTIME_URL = 'https://roble-realtime.test-openlab.uninorte.edu.co',
  ROBLE_CONTRACT_ID,
  ROBLE_EMAIL,
  ROBLE_PASSWORD,
  ROBLE_TABLE = 'usuarios_test',
  ROBLE_COLLECTION = 'demo',
} = process.env;

const db = createRobleClient({
  baseUrl: ROBLE_BASE_URL,
  contractId: ROBLE_CONTRACT_ID ?? 'mi_contrato',
  // El WebSocket de Realtime solo funciona contra el host de realtime.
  realtimeBaseUrl: ROBLE_REALTIME_URL,
});

// El cliente avisa cada vez que cambia el access token.
db.onTokenUpdate = (token) =>
  console.log(`  [token] ${token ? `${token.slice(0, 20)}...` : 'null'}`);

function offlineCheck() {
  console.log('Sin credenciales: comprobación offline.\n');
  console.log('  cliente creado  :', db.constructor.name);
  console.log('  accessToken     :', db.accessToken);
  console.log('  refreshToken    :', db.refreshToken);

  const err = new RobleApiHttpException(401, 'No autorizado');
  console.log('  excepciones     :', `${err.name} (${err.statusCode})`);
  console.log('  hereda de Error :', err instanceof Error);

  console.log('\nPara ejecutar el ciclo completo, define las variables:');
  console.log('  ROBLE_CONTRACT_ID, ROBLE_EMAIL, ROBLE_PASSWORD');
  console.log(
    '  (opcionales: ROBLE_BASE_URL, ROBLE_REALTIME_URL, ROBLE_TABLE, ROBLE_COLLECTION)'
  );
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function realtimeDemo() {
  console.log('\n=== Realtime ===\n');

  const health = await db.realtime.health();
  console.log('Estado del servicio :', health.status);
  console.log('Colecciones         :', await db.realtime.collections());

  const ref = db.realtime.ref(`${ROBLE_COLLECTION}/sala`);
  console.log(`Escuchando          : ${ref.path}\n`);

  db.realtime.onStatusChange = (s) => console.log(`  [conexión] ${s}`);

  // Evento crudo: no hace ninguna petición extra.
  const offEvent = ref.onEvent((e) => {
    console.log(`  [evento] ${e.operation} ${e.pathString} -> ${JSON.stringify(e.newValue)}`);
  });

  // Valor del nodo: emite al suscribirse y tras cada cambio.
  const offValue = ref.onValue((valor) => {
    const n = valor && typeof valor === 'object' ? Object.keys(valor).length : 0;
    console.log(`  [valor ] ${n} elemento(s): ${JSON.stringify(valor)}`);
  });

  await wait(2500);

  console.log('\n-> push');
  const id = await ref.push({ texto: 'hola', autor: 'node' });
  await wait(2500);

  console.log('-> update (fusiona)');
  await ref.child(id).update({ leido: true });
  await wait(2500);

  console.log('-> remove');
  await ref.child(id).remove();
  await wait(2500);

  console.log('\nCancelando escuchas…');
  offEvent();
  offValue();

  await ref.remove();
  db.realtime.close();
  console.log('Listo. Socket cerrado.');
}

async function fullFlow() {
  console.log(`Contrato : ${ROBLE_CONTRACT_ID}`);
  console.log(`Tabla    : ${ROBLE_TABLE}\n`);

  console.log('Iniciando sesión...');
  const user = await db.login({ email: ROBLE_EMAIL, password: ROBLE_PASSWORD });
  console.log(`  sesión iniciada como ${user.name} (${user.userId})`);
  console.log(`  extra: ${JSON.stringify(user.extra)}\n`);

  // El CRUD necesita que la tabla exista; si no, seguimos con Realtime.
  try {
    await crudDemo();
  } catch (e) {
    console.log(`\n(CRUD omitido: ${e.message})`);
    console.log('Crea la tabla o define ROBLE_TABLE para probar esta parte.');
  }

  await realtimeDemo();

  console.log('\nCerrando sesión...');
  await db.logout();
  console.log('  sesión cerrada');
}

async function crudDemo() {
  console.log('=== CRUD ===\n');
  console.log('Creando registro...');
  const creado = await db.create(ROBLE_TABLE, { nombre: 'Node', rol: 'demo' });
  console.log('  creado:', JSON.stringify(creado), '\n');

  console.log('Leyendo registros...');
  const filas = await db.read(ROBLE_TABLE);
  console.log(`  ${filas.length} registros\n`);

  console.log('Actualizando registro...');
  await db.update(ROBLE_TABLE, creado._id, { rol: 'actualizado' });
  console.log('  actualizado\n');

  console.log('Eliminando registro...');
  await db.delete(ROBLE_TABLE, creado._id);
  console.log('  eliminado');
}

async function main() {
  if (!ROBLE_CONTRACT_ID || !ROBLE_EMAIL || !ROBLE_PASSWORD) {
    offlineCheck();
    return;
  }
  await fullFlow();
}

// Cada tipo de fallo se distingue por su clase, igual que en el paquete Flutter.
main().catch((e) => {
  if (e instanceof RobleApiHttpException) {
    console.error(`\nEl servidor respondió ${e.statusCode}: ${e.message}`);
  } else if (e instanceof RobleApiAuthException) {
    console.error(`\nProblema de sesión: ${e.message}`);
  } else if (e instanceof RobleApiTimeoutException) {
    console.error(`\nTiempo de espera agotado: ${e.message}`);
  } else if (e instanceof RobleApiNetworkException) {
    console.error(`\nSin conexión: ${e.message}`);
  } else if (e instanceof RobleApiException) {
    console.error(`\nError de roble-client: ${e.message}`);
  } else {
    console.error('\nError inesperado:', e);
  }
  process.exitCode = 1;
});
