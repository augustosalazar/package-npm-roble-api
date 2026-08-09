# Ejemplos de roble-client

Dos ejemplos **independientes**. Cada uno tiene su propio `package.json` y su
propia instalación: no comparten dependencias ni forman parte de un workspace
de Yarn. Ambos consumen `roble-client` publicado en npm, igual que lo haría
cualquier proyecto tuyo.

| Carpeta | Entorno | Para qué sirve |
| --- | --- | --- |
| [`expo/`](expo/) | React Native (Expo) | App móvil/web con botones para probar auth y CRUD. |
| [`node/`](node/) | Node.js puro | Scripts ESM y CommonJS. Demuestra que el cliente no depende de React. |

Cada carpeta tiene su propio README con las instrucciones.

## Probar cambios locales de la librería

Como los ejemplos usan la versión publicada, un cambio en `src/` de la raíz no
se refleja automáticamente. Para probar tu copia local, compílala e instálala
por ruta dentro del ejemplo que quieras:

```bash
yarn prepare
```

```bash
cd example/node && npm install ../..
```

Para volver a la versión de npm: `npm install roble-client@latest`.
