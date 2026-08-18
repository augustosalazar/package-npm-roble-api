// Prueba de que el paquete se puede consumir con require() desde CommonJS.
//
//   node example/node-demo/index.cjs
const {
  createRobleClient,
  RobleApiClient,
  RobleApiException,
  RobleApiHttpException,
} = require('roble-client');

const db = createRobleClient({
  baseUrl: 'https://roble-api.openlab.uninorte.edu.co',
  contractId: 'demo_contrato_1234',
});

console.log('require("roble-client") -> OK');
console.log('  resuelto desde     :', require.resolve('roble-client'));
console.log('  es RobleApiClient  :', db instanceof RobleApiClient);
console.log('  isLoggedIn         :', db.isLoggedIn);

// La jerarquía de excepciones se conserva al compilar a CommonJS.
const err = new RobleApiHttpException(404, 'No encontrado');
console.log('  statusCode         :', err.statusCode);
console.log('  hereda RobleApi... :', err instanceof RobleApiException);
console.log('  hereda de Error    :', err instanceof Error);
