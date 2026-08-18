// Ejemplo de roble-client en Node.js puro (ESM). No importa React ni React Native.
//
//   npm start
//
// Sin credenciales hace una comprobación offline. Con credenciales ejecuta el
// ciclo completo: registro, login, CRUD e inserción múltiple.
import {
  createRobleClient,
  RobleApiAuthException,
  RobleApiException,
  RobleApiHttpException,
  RobleApiNetworkException,
  RobleApiTimeoutException,
  RoblePartialInsertException,
} from 'roble-client';

const {
  ROBLE_BASE_URL = 'https://roble-api.test-openlab.uninorte.edu.co',
  ROBLE_CONTRACT_ID,
  ROBLE_EMAIL,
  ROBLE_PASSWORD,
  ROBLE_TABLE = 'usuarios_test',
} = process.env;

function offlineCheck() {
  console.log('Sin credenciales: comprobación offline.\n');

  const err = new RobleApiHttpException(401, 'No autorizado');
  console.log('  excepciones     :', `${err.name} (${err.statusCode})`);
  console.log('  hereda de Error :', err instanceof Error);

  // La configuración se valida al construir el cliente.
  try {
    createRobleClient({ baseUrl: ROBLE_BASE_URL, contractId: 'tu_contrato' });
  } catch (e) {
    console.log('  contrato sin configurar ->', e.message);
  }

  console.log('\nPara ejecutar el ciclo completo, define las variables:');
  console.log('  ROBLE_CONTRACT_ID, ROBLE_EMAIL, ROBLE_PASSWORD');
  console.log('  (opcionales: ROBLE_BASE_URL, ROBLE_TABLE)');
}

async function fullFlow() {
  const db = createRobleClient({
    baseUrl: ROBLE_BASE_URL,
    contractId: ROBLE_CONTRACT_ID,
    // En Node no hay almacén por defecto: sin `storage` la sesión vive en RAM.
  });

  console.log(`Contrato : ${ROBLE_CONTRACT_ID}`);
  console.log(`Tabla    : ${ROBLE_TABLE}\n`);

  console.log('Iniciando sesión...');
  const user = await db.login({ email: ROBLE_EMAIL, password: ROBLE_PASSWORD });
  console.log(`  dentro como ${user.name} (${user.userId})`);
  console.log(`  extra: ${JSON.stringify(user.extra)}`);
  console.log(`  isLoggedIn: ${db.isLoggedIn}\n`);

  try {
    await crudDemo(db);
    await insertDemo(db);
  } catch (e) {
    console.log(`\n(datos omitidos: ${e.message})`);
    console.log(`Crea la tabla "${ROBLE_TABLE}" o define ROBLE_TABLE.`);
  }

  console.log('\nCerrando sesión...');
  await db.logout();
  console.log(`  isLoggedIn: ${db.isLoggedIn}`);
}

async function crudDemo(db) {
  console.log('=== CRUD ===\n');

  const creado = await db.create(ROBLE_TABLE, { nombre: 'Ana', rol: 'admin' });
  console.log('  creado   :', creado._id);

  const todos = await db.read(ROBLE_TABLE);
  console.log('  leídos   :', todos.length, 'registros');

  await db.update(ROBLE_TABLE, creado._id, { rol: 'editor' });
  const uno = await db.getById(ROBLE_TABLE, creado._id);
  console.log('  getById  :', uno?.rol);

  await db.delete(ROBLE_TABLE, creado._id);
  console.log('  eliminado');
}

async function insertDemo(db) {
  console.log('\n=== Inserción múltiple ===\n');

  // strict convierte el rechazo parcial en un error, en vez de algo que hay
  // que acordarse de comprobar.
  try {
    await db.createMany(
      ROBLE_TABLE,
      [{ nombre: 'Uno' }, { columna_inexistente: 1 }],
      { strict: true }
    );
  } catch (e) {
    if (e instanceof RoblePartialInsertException) {
      console.log('  rechazo parcial:', e.message);
      console.log('  sí se escribió :', e.result.inserted.length, 'fila(s)');
      for (const fila of e.result.inserted) {
        await db.delete(ROBLE_TABLE, fila._id);
      }
      console.log('  (limpiadas)');
    } else {
      throw e;
    }
  }
}

const main =
  ROBLE_CONTRACT_ID && ROBLE_EMAIL && ROBLE_PASSWORD
    ? fullFlow
    : async () => offlineCheck();

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
