// Ejemplo de roble-client en Node.js puro (ESM). No importa React ni React Native.
//
//   node example/node-demo/index.mjs
//
// Sin credenciales hace una comprobación offline. Con credenciales ejecuta el
// ciclo completo: login -> create -> read -> update -> delete -> logout.
import {
  createRobleClient,
  RobleApiAuthException,
  RobleApiException,
  RobleApiHttpException,
  RobleApiNetworkException,
  RobleApiTimeoutException,
} from 'roble-client';

const {
  ROBLE_BASE_URL = 'https://roble-api.openlab.uninorte.edu.co',
  ROBLE_CONTRACT_ID,
  ROBLE_PROJECT_ID,
  ROBLE_EMAIL,
  ROBLE_PASSWORD,
  ROBLE_TABLE = 'usuarios_test',
} = process.env;

const db = createRobleClient({
  baseUrl: ROBLE_BASE_URL,
  contractId: ROBLE_CONTRACT_ID ?? 'mi_contrato',
  projectId: ROBLE_PROJECT_ID,
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
  console.log('  (opcionales: ROBLE_BASE_URL, ROBLE_PROJECT_ID, ROBLE_TABLE)');
}

async function fullFlow() {
  console.log(`Contrato : ${ROBLE_CONTRACT_ID}`);
  console.log(`Tabla    : ${ROBLE_TABLE}\n`);

  console.log('Iniciando sesión...');
  await db.login({ email: ROBLE_EMAIL, password: ROBLE_PASSWORD });
  console.log('  sesión iniciada\n');

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
  console.log('  eliminado\n');

  console.log('Cerrando sesión...');
  await db.logout();
  console.log('  sesión cerrada');
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
