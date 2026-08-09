import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import {
  createRobleClient,
  RobleApiException,
  RobleApiHttpException,
} from 'roble-client';

export default function App() {
  const [log, setLog] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [lastEmail, setLastEmail] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // === CONFIGURAR CLIENTE ===
  const db = useMemo(
    () =>
      createRobleClient({
        baseUrl: 'https://roble-api.openlab.uninorte.edu.co',
        contractId: 'robleapidatabase_e13b5d56c6',
      }),
    []
  );

  // El cliente avisa cada vez que cambia el access token.
  useEffect(() => {
    db.onTokenUpdate = (token) => setAccessToken(token);
  }, [db]);

  const appendLog = (text: string) => setLog((prev) => prev + text + '\n');

  // === FUNCIONES ===

  const createUser = async () => {
    try {
      setLoading(true);
      const email = `test_user_${Date.now()}@mail.com`;
      appendLog(`Creando usuario: ${email}`);

      const res = await db.register({
        name: 'Usuario Prueba',
        email,
        password: 'Password123!',
      });
      setLastEmail(email);
      appendLog(`Usuario creado: ${res.email ?? email}`);
    } catch (e: any) {
      appendLog(`Error creando usuario: ${e?.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loginUser = async () => {
    if (!lastEmail) {
      appendLog('Primero crea un usuario antes de iniciar sesión.');
      return;
    }

    try {
      setLoading(true);
      appendLog(`Iniciando sesión con ${lastEmail}...`);
      const res = await db.login({
        email: lastEmail,
        password: 'Password123!',
      });
      appendLog(
        `Sesión iniciada. Token: ${String(res.accessToken).substring(0, 25)}...`
      );
    } catch (e) {
      // Las excepciones tipadas permiten distinguir el tipo de fallo.
      if (e instanceof RobleApiHttpException) {
        appendLog(`El servidor respondió ${e.statusCode}: ${e.message}`);
      } else if (e instanceof RobleApiException) {
        appendLog(`Error al iniciar sesión: ${e.message}`);
      } else {
        appendLog(`Error inesperado: ${String(e)}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const logoutUser = async () => {
    if (!accessToken) {
      appendLog('No hay sesión activa para cerrar.');
      return;
    }

    try {
      setLoading(true);
      appendLog('Cerrando sesión...');
      await db.logout(); // sin argumentos; limpia los tokens
      appendLog('Sesión cerrada correctamente.');
    } catch (e: any) {
      appendLog(`Error cerrando sesión: ${e?.message}`);
    } finally {
      setLoading(false);
    }
  };

  const createTestTable = async () => {
    if (!accessToken) {
      appendLog('Debes iniciar sesión antes de crear tablas.');
      return;
    }

    try {
      setLoading(true);
      appendLog('Creando tabla "usuarios_test"...');
      await db.createTable('usuarios_test', [
        { name: 'nombre', type: 'text' },
        { name: 'rol', type: 'text' },
      ]);
      appendLog('Tabla creada correctamente.');
    } catch (e: any) {
      appendLog(`Error creando tabla: ${e?.message}`);
    } finally {
      setLoading(false);
    }
  };

  const insertIntoTestTable = async () => {
    if (!accessToken) {
      appendLog('Debes iniciar sesión antes de agregar datos.');
      return;
    }

    try {
      setLoading(true);
      appendLog('Insertando registro en "usuarios_test"...');
      const created = await db.create('usuarios_test', {
        nombre: 'Carlos',
        rol: 'tester',
      });
      appendLog(`Registro agregado: ${JSON.stringify(created)}`);
    } catch (e: any) {
      appendLog(`Error insertando registro: ${e?.message}`);
    } finally {
      setLoading(false);
    }
  };

  const testCrud = async () => {
    if (!accessToken) {
      appendLog('Debes iniciar sesión antes de probar CRUD.');
      return;
    }

    try {
      setLoading(true);
      appendLog('Creando registro...');
      const created = await db.create('usuarios_test', {
        nombre: 'Juan',
        rol: 'admin',
      });
      appendLog(`Registro creado: ${JSON.stringify(created)}`);

      appendLog('Leyendo registros...');
      const data = await db.read('usuarios_test');
      appendLog(`Se obtuvieron ${data.length} registros.`);

      appendLog('Actualizando registro...');
      const updated = await db.update('usuarios_test', created._id, {
        rol: 'editor',
      });
      appendLog(`Registro actualizado: ${JSON.stringify(updated)}`);

      appendLog('Eliminando registro...');
      const deleted = await db.delete('usuarios_test', created._id);
      appendLog(`Registro eliminado: ${JSON.stringify(deleted)}`);

      appendLog('CRUD completo.');
    } catch (e: any) {
      appendLog(`Error en CRUD: ${e?.message}`);
    } finally {
      setLoading(false);
    }
  };

  // === UI ===
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Roble API Tester</Text>

      {loading && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#007bff" />
        </View>
      )}

      <View style={styles.buttonGrid}>
        <Button label="Crear usuario" onPress={createUser} />
        <Button label="Iniciar sesión" onPress={loginUser} />
        <Button label="Cerrar sesión" onPress={logoutUser} />
        <Button label="Crear tabla de prueba" onPress={createTestTable} />
        <Button label="Agregar dato a tabla" onPress={insertIntoTestTable} />
        <Button label="Probar CRUD" onPress={testCrud} />
      </View>

      <Text style={styles.logTitle}>Log de operaciones:</Text>
      <ScrollView
        style={styles.logContainer}
        contentContainerStyle={{ padding: 8 }}
      >
        <Text style={styles.logText}>{log}</Text>
      </ScrollView>
    </View>
  );
}

function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.button} onPress={onPress}>
      <Text style={styles.buttonText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 12 },
  buttonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  button: {
    backgroundColor: '#007bff',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
  },
  buttonText: { color: 'white', fontSize: 14 },
  logTitle: { fontWeight: 'bold', marginBottom: 4 },
  logContainer: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    backgroundColor: '#f8f8f8',
  },
  logText: { fontSize: 13, color: '#333' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#ffffffaa',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
});
