// src/index.ts
import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from 'axios';
import { io, type Socket } from 'socket.io-client';

// ============================
//  Errores
// ============================

/** Excepción base para todos los errores del cliente Roble API. */
export class RobleApiException extends Error {
  /** Código de error opcional (por ejemplo: 'timeout', 'invalid_token'). */
  readonly code?: unknown;

  constructor(message: string, code?: unknown) {
    super(message);
    this.name = 'RobleApiException';
    this.code = code;
    // Necesario para que `instanceof` funcione al compilar a ES5.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Error de red (sin conexión, DNS no resuelto). */
export class RobleApiNetworkException extends RobleApiException {
  constructor(message: string, code?: unknown) {
    super(message, code);
    this.name = 'RobleApiNetworkException';
  }
}

/** El servidor devolvió un código HTTP fuera de 2xx. */
export class RobleApiHttpException extends RobleApiException {
  readonly statusCode: number;

  constructor(statusCode: number, message: string, code?: unknown) {
    super(message, code);
    this.name = 'RobleApiHttpException';
    this.statusCode = statusCode;
  }
}

/** La respuesta tiene un formato inválido o no se puede parsear. */
export class RobleApiFormatException extends RobleApiException {
  constructor(message: string, code?: unknown) {
    super(message, code);
    this.name = 'RobleApiFormatException';
  }
}

/** El tiempo de espera expiró. */
export class RobleApiTimeoutException extends RobleApiException {
  constructor(message: string, code?: unknown) {
    super(message, code);
    this.name = 'RobleApiTimeoutException';
  }
}

/** Credenciales inválidas, token expirado o refresco fallido. */
export class RobleApiAuthException extends RobleApiException {
  constructor(message: string, code?: unknown) {
    super(message, code);
    this.name = 'RobleApiAuthException';
  }
}

// ============================
//  Configuración
// ============================
export type RobleApiHeaders = Record<string, string>;

export interface RobleApiColumn {
  name: string;
  type: string;
  nullable?: boolean;
  default?: any;
}

/** Registro que el servidor rechazó durante un `POST /insert`. */
export interface RobleSkippedRecord {
  /** Posición del registro en la lista enviada. */
  index: number;
  /** Motivo indicado por el servidor. */
  reason: string;
}

/**
 * Resultado de insertar varios registros con `createMany`.
 *
 * El endpoint `/insert` responde `200` aunque haya rechazado registros, así
 * que siempre conviene revisar `skipped` antes de dar la escritura por buena.
 */
export interface RobleInsertResult {
  /** Registros efectivamente insertados, con su `_id` generado. */
  inserted: Array<Record<string, any>>;
  /** Registros rechazados, con su posición y motivo. */
  skipped: RobleSkippedRecord[];
  /** `true` si el servidor rechazó al menos un registro. */
  hasSkipped: boolean;
}

/** Resultado de `POST /execute-query`. */
export interface RobleQueryResult {
  success: boolean;
  command: string | null;
  rowCount: number;
  rows: any[];
  fields: Array<{ name: string; dataTypeID?: number }>;
}

/** Operación que originó un evento Realtime. */
export type RobleRealtimeOperation = 'INSERT' | 'UPDATE' | 'DELETE';

/**
 * Cambio recibido por el WebSocket de Realtime.
 *
 * Ojo con la asimetría del servidor: en `INSERT`, `path` apunta al **padre** y
 * el id del nuevo hijo es la clave dentro de `newValue`. En `UPDATE` y
 * `DELETE`, `path` apunta al nodo afectado.
 */
export interface RobleRealtimeEvent {
  /** Identificador único del evento. */
  eventId: string;
  /** Id de la suscripción que lo originó. */
  subscriptionId: string;
  /** Colección (primer segmento de la ruta). */
  table: string;
  /** Ruta como lista de segmentos, p. ej. `['messages','general']`. */
  path: string[];
  /** Ruta como string, p. ej. `'messages/general'`. */
  pathString: string;
  operation: RobleRealtimeOperation;
  /** Valor anterior. `null` en `INSERT`. */
  oldValue: any;
  /**
   * Valor nuevo. `null` en `DELETE`. En `UPDATE` es **parcial**: solo los
   * campos enviados, tanto en `PATCH` como en `PUT`.
   */
  newValue: any;
  commitTimestamp: string;
  /** Payload crudo tal cual lo envió el servidor. */
  raw: Record<string, any>;
}

/** Estado de la conexión WebSocket de Realtime. */
export type RobleRealtimeStatus =
  'disconnected' | 'connecting' | 'connected' | 'error';

/** Cancela una suscripción. Llamar varias veces es seguro. */
export type RobleUnsubscribe = () => void;

/** Usuario autenticado, devuelto por `GET /verify-token`. */
export interface RobleUser {
  sub: string;
  email: string;
  dbName?: string;
  sessionId?: string;
  [key: string]: any;
}

export interface RobleApiConfig {
  /** Host del backend, p. ej: https://roble.test-openlab.uninorte.edu.co */
  baseUrl: string;

  /**
   * Identificador del contrato. Compone `/auth/{contractId}` y
   * `/database/{contractId}`.
   */
  contractId: string;

  /**
   * Host del servicio Realtime, si está desplegado aparte (opcional).
   *
   * En despliegues de Roble el realtime suele vivir en su propio host, p. ej.
   * `https://roble-realtime.test-openlab.uninorte.edu.co`. Si se omite se usa
   * [baseUrl]. El WebSocket solo funciona contra el host de realtime.
   */
  realtimeBaseUrl?: string;

  /** Timeout en ms (default 30000) */
  timeoutMs?: number;
}

// ============================
//  Cliente principal
// ============================
export class RobleApiClient {
  static DEFAULT_TIMEOUT_MS = 30_000;

  /** Identificador del contrato usado en todas las rutas. */
  readonly contractId: string;
  private readonly http: AxiosInstance;
  /** Host del servicio Realtime (sin barra final). */
  readonly realtimeBaseUrl: string;

  private accessTokenValue: string | null = null;
  private refreshTokenValue: string | null = null;

  /**
   * Callback opcional invocado cada vez que cambia el access token:
   * login, refresco automático o logout. Útil para persistir la sesión.
   */
  onTokenUpdate?: (token: string | null) => void;

  constructor(config: RobleApiConfig) {
    this.contractId = config.contractId;
    this.realtimeBaseUrl = (config.realtimeBaseUrl ?? config.baseUrl).replace(
      /\/+$/,
      ''
    );

    this.http = axios.create({
      baseURL: config.baseUrl.replace(/\/+$/, ''), // sin / final
      timeout: config.timeoutMs ?? RobleApiClient.DEFAULT_TIMEOUT_MS,
    });

    // Anexa Authorization automáticamente si hay token, salvo que la
    // petición lo desactive con `skipAuth` (endpoints públicos).
    this.http.interceptors.request.use((cfg) => {
      cfg.headers = cfg.headers ?? {};
      if (!(cfg as any).skipAuth && this.accessTokenValue) {
        (cfg.headers as any).Authorization = `Bearer ${this.accessTokenValue}`;
      }
      return cfg;
    });
  }

  // ============================
  //  Tokens
  // ============================

  /** Access token actual, o `null` si no hay sesión activa. */
  get accessToken(): string | null {
    return this.accessTokenValue;
  }

  /** Refresh token actual, o `null` si no hay sesión activa. */
  get refreshToken(): string | null {
    return this.refreshTokenValue;
  }

  /** Restaura una sesión previamente persistida. */
  setTokens(tokens: { accessToken: string; refreshToken: string }) {
    this.refreshTokenValue = tokens.refreshToken;
    this.updateAccessToken(tokens.accessToken);
  }

  /** Descarta la sesión en memoria. */
  clearTokens() {
    this.refreshTokenValue = null;
    this.updateAccessToken(null);
  }

  private updateAccessToken(token: string | null) {
    this.accessTokenValue = token;
    this.onTokenUpdate?.(token);
  }

  // ============================
  //  Helpers internos
  // ============================
  private buildPath(kind: 'auth' | 'database' | 'realtime', endpoint: string) {
    // El servicio realtime admite rutas vacías (la raíz del proyecto).
    if (kind === 'realtime') {
      return endpoint
        ? `/realtime/${this.contractId}/${endpoint}`
        : `/realtime/${this.contractId}`;
    }
    return kind === 'auth'
      ? `/auth/${this.contractId}/${endpoint}`
      : `/database/${this.contractId}/${endpoint}`;
  }

  /** Traduce cualquier fallo de transporte a una excepción del paquete. */
  private toRobleError(e: unknown): RobleApiException {
    if (e instanceof RobleApiException) return e;

    if (axios.isAxiosError(e)) {
      if (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT') {
        return new RobleApiTimeoutException('Tiempo de espera agotado', e.code);
      }
      if (!e.response) {
        return new RobleApiNetworkException('Sin conexión a internet', e.code);
      }
    }

    const msg = e instanceof Error ? e.message : String(e);
    return new RobleApiException(`Error inesperado: ${msg}`);
  }

  /** Extrae el mensaje de error de una respuesta no exitosa. */
  private errorMessage(res: AxiosResponse): string {
    const data = res.data;

    if (data === null || data === undefined || data === '') {
      return 'El servidor respondió sin cuerpo';
    }

    if (typeof data === 'object') {
      const message = (data as any).message ?? (data as any).error;
      return message ? String(message) : JSON.stringify(data);
    }

    return String(data);
  }

  private async send(cfg: AxiosRequestConfig): Promise<AxiosResponse> {
    try {
      return await this.http.request(cfg);
    } catch (e) {
      throw this.toRobleError(e);
    }
  }

  private async _makeRequest<T = any>(
    kind: 'auth' | 'database' | 'realtime',
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    endpoint: string,
    {
      body,
      query,
      isAuthRequest = false, // true solo para login/refresh/signup/logout
      skipAuth = false, // true para endpoints públicos
      baseUrlOverride,
    }: {
      body?: any;
      query?: Record<string, any>;
      isAuthRequest?: boolean;
      skipAuth?: boolean;
      baseUrlOverride?: string;
    } = {}
  ): Promise<T> {
    const cfg: AxiosRequestConfig = {
      url: this.buildPath(kind, endpoint),
      ...(baseUrlOverride ? { baseURL: baseUrlOverride } : {}),
      method,
      headers: { 'Content-Type': 'application/json' },
      params: query,
      // Comparar contra undefined, no truthiness: realtime escribe valores
      // válidos como 0, false o "".
      data: body !== undefined ? JSON.stringify(body) : undefined,
      validateStatus: () => true, // manejamos el status manualmente
      ...({ skipAuth } as any),
    };

    let res = await this.send(cfg);

    // Éxito 2xx
    if (res.status >= 200 && res.status < 300) return res.data as T;

    // 401 en endpoints de DATA: refrescamos y reintentamos una sola vez.
    if (
      res.status === 401 &&
      !isAuthRequest &&
      !skipAuth &&
      this.refreshTokenValue
    ) {
      try {
        await this.refreshAccessToken();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new RobleApiAuthException(
          `Token expirado y no se pudo refrescar: ${msg}`
        );
      }

      res = await this.send(cfg);
      if (res.status >= 200 && res.status < 300) return res.data as T;
    }

    throw new RobleApiHttpException(res.status, this.errorMessage(res));
  }

  // ============================
  //  AUTH
  // ============================

  /**
   * Registra un usuario sin verificación por correo.
   *
   * `extra` son campos adicionales opcionales que el backend guarda junto al
   * usuario; se envían tal cual en el campo `extra` del cuerpo.
   */
  async register(params: {
    email: string;
    password: string;
    name: string;
    extra?: Record<string, any>;
  }): Promise<Record<string, any>> {
    return this._makeRequest('auth', 'POST', 'signup-direct', {
      body: {
        email: params.email,
        password: params.password,
        name: params.name,
        ...(params.extra ? { extra: params.extra } : {}),
      },
      isAuthRequest: true,
    });
  }

  /**
   * Registra un usuario y envía un código de verificación por correo.
   *
   * El registro no queda activo hasta llamar a `verifyEmail` con el código.
   *
   * `extra` son campos adicionales opcionales que el backend guarda junto al
   * usuario; se envían tal cual en el campo `extra` del cuerpo.
   */
  async registerWithVerification(params: {
    email: string;
    password: string;
    name: string;
    extra?: Record<string, any>;
  }): Promise<Record<string, any>> {
    return this._makeRequest('auth', 'POST', 'signup', {
      body: {
        email: params.email,
        password: params.password,
        name: params.name,
        ...(params.extra ? { extra: params.extra } : {}),
      },
      isAuthRequest: true,
    });
  }

  /** Confirma el correo con el código de 6 dígitos recibido. */
  async verifyEmail(params: {
    email: string;
    code: string;
  }): Promise<Record<string, any>> {
    return this._makeRequest('auth', 'POST', 'verify-email', {
      body: { email: params.email, code: params.code },
      isAuthRequest: true,
    });
  }

  /** Reenvía el código de verificación. */
  async resendCode(params: { email: string }): Promise<Record<string, any>> {
    return this._makeRequest('auth', 'POST', 'resend-code', {
      body: { email: params.email },
      isAuthRequest: true,
    });
  }

  /** Inicia sesión y almacena los tokens internamente. */
  async login(params: {
    email: string;
    password: string;
  }): Promise<Record<string, any>> {
    const data = await this._makeRequest<any>('auth', 'POST', 'login', {
      body: { email: params.email, password: params.password },
      isAuthRequest: true,
    });

    if (data?.accessToken) {
      this.refreshTokenValue = data.refreshToken ?? null;
      this.updateAccessToken(data.accessToken);
    }

    return data;
  }

  /** Cierra la sesión en el servidor y descarta los tokens locales. */
  async logout(): Promise<void> {
    if (!this.accessTokenValue) {
      throw new RobleApiAuthException(
        'No hay token activo para cerrar sesión.'
      );
    }

    // Sin body: el token viaja en el header Authorization.
    await this._makeRequest('auth', 'POST', 'logout', { isAuthRequest: true });

    this.clearTokens();
  }

  /**
   * Devuelve los datos del usuario autenticado (`sub`, `email`, `dbName`,
   * `sessionId`). Es el único endpoint que expone la identidad del usuario.
   *
   * Lanza `RobleApiHttpException` con `401` si el token no es válido.
   */
  async currentUser(): Promise<RobleUser> {
    const res = await this._makeRequest<any>('auth', 'GET', 'verify-token', {
      isAuthRequest: true,
    });

    if (res?.user) return res.user as RobleUser;
    throw new RobleApiFormatException(
      'Respuesta inesperada al verificar el token.'
    );
  }

  /** Envía un correo con el enlace de restablecimiento de contraseña. */
  async forgotPassword(params: {
    email: string;
  }): Promise<Record<string, any>> {
    return this._makeRequest('auth', 'POST', 'forgot-password', {
      body: { email: params.email },
      isAuthRequest: true,
    });
  }

  /** Restablece la contraseña con el token recibido por correo. */
  async resetPassword(params: {
    token: string;
    newPassword: string;
  }): Promise<Record<string, any>> {
    return this._makeRequest('auth', 'POST', 'reset-password', {
      body: { token: params.token, newPassword: params.newPassword },
      isAuthRequest: true,
    });
  }

  /**
   * Elimina permanentemente la cuenta autenticada y limpia la sesión local.
   *
   * La operación no se puede deshacer: pide confirmación al usuario antes
   * de llamarla.
   */
  async deleteAccount(): Promise<void> {
    if (!this.accessTokenValue) {
      throw new RobleApiAuthException(
        'No hay sesión activa para eliminar la cuenta.'
      );
    }

    await this._makeRequest('auth', 'DELETE', 'account', {
      isAuthRequest: true,
    });

    this.clearTokens();
  }

  /**
   * Refresca el access token con el refresh token almacenado.
   *
   * Es interno a propósito: se invoca automáticamente cuando una petición
   * de datos responde `401`. No forma parte de la API pública.
   */
  private async refreshAccessToken(): Promise<void> {
    if (!this.refreshTokenValue) {
      throw new RobleApiAuthException('No hay refresh token disponible.');
    }

    const data = await this._makeRequest<any>('auth', 'POST', 'refresh-token', {
      body: { refreshToken: this.refreshTokenValue },
      isAuthRequest: true,
    });

    if (!data?.accessToken) {
      throw new RobleApiAuthException(
        'Respuesta inválida al refrescar el token.'
      );
    }

    this.updateAccessToken(data.accessToken);
  }

  // ============================
  //  TABLAS / CRUD
  // ============================

  async createTable(
    tableName: string,
    columns: RobleApiColumn[]
  ): Promise<void> {
    await this._makeRequest('database', 'POST', 'create-table', {
      body: {
        tableName,
        description: `Tabla ${tableName} creada desde cliente móvil`,
        columns,
      },
    });
  }

  async getTableData(tableName: string): Promise<any> {
    return this._makeRequest('database', 'GET', 'table-data', {
      query: { schema: 'public', table: tableName },
    });
  }

  /**
   * Clona la estructura de columnas de una tabla existente.
   *
   * Es el único mecanismo de creación de tablas documentado por la API, y
   * requiere que `templateTableName` ya exista. No copia los datos.
   */
  async createTableFromTemplate(params: {
    tableName: string;
    templateTableName: string;
  }): Promise<Record<string, any>> {
    return this._makeRequest('database', 'POST', 'create-table-from-template', {
      body: {
        tableName: params.tableName,
        templateTableName: params.templateTableName,
      },
    });
  }

  /**
   * Inserta un registro y devuelve la fila creada, con su `_id`.
   *
   * Usa `/insert-one`, que devuelve el registro directamente. Si el servidor
   * rechaza la fila, responde con un error HTTP en lugar de un `200` vacío.
   */
  async create(
    tableName: string,
    data: Record<string, any>
  ): Promise<Record<string, any>> {
    const res = await this._makeRequest<any>('database', 'POST', 'insert-one', {
      body: { tableName, record: data },
    });

    if (res && typeof res === 'object') return res;
    throw new RobleApiFormatException('No se pudo insertar el registro');
  }

  /**
   * Inserta varios registros.
   *
   * El servidor responde `200` aunque rechace parte de los registros, así que
   * el resultado expone `skipped`. Revísalo siempre:
   *
   * ```ts
   * const res = await db.createMany('usuarios', registros);
   * if (res.hasSkipped) {
   *   res.skipped.forEach((s) =>
   *     console.warn(`Fila ${s.index} rechazada: ${s.reason}`)
   *   );
   * }
   * ```
   */
  async createMany(
    tableName: string,
    records: Array<Record<string, any>>
  ): Promise<RobleInsertResult> {
    const res = await this._makeRequest<any>('database', 'POST', 'insert', {
      body: { tableName, records },
    });

    if (!res || typeof res !== 'object') {
      throw new RobleApiFormatException(
        'Respuesta inesperada al insertar registros'
      );
    }

    const inserted: Array<Record<string, any>> = Array.isArray(res.inserted)
      ? res.inserted
      : [];
    const skipped: RobleSkippedRecord[] = Array.isArray(res.skipped)
      ? res.skipped.map((s: any) => ({
          index: Number(s?.index ?? -1),
          reason: String(s?.reason ?? 'sin motivo'),
        }))
      : [];

    return { inserted, skipped, hasSkipped: skipped.length > 0 };
  }

  async read(
    tableName: string,
    filters?: Record<string, any>
  ): Promise<Array<Record<string, any>>> {
    const query: Record<string, string> = { tableName };
    if (filters) {
      Object.entries(filters).forEach(([k, v]) => {
        query[k] = String(v);
      });
    }

    const res = await this._makeRequest<any>('database', 'GET', 'read', {
      query,
    });

    if (Array.isArray(res)) return res as Array<Record<string, any>>;
    if (res?.data) return res.data as Array<Record<string, any>>;
    return [];
  }

  async update(
    tableName: string,
    id: string | number,
    data: Record<string, any>
  ): Promise<Record<string, any>> {
    const updates = { ...(data ?? {}) };
    delete updates._id;
    delete updates.id;

    return this._makeRequest('database', 'PUT', 'update', {
      body: {
        tableName,
        idColumn: '_id',
        idValue: id,
        updates,
      },
    });
  }

  async delete(
    tableName: string,
    id: string | number
  ): Promise<Record<string, any>> {
    return this._makeRequest('database', 'DELETE', 'delete', {
      body: {
        tableName,
        idColumn: '_id',
        idValue: id,
      },
    });
  }

  /**
   * Lee una tabla marcada como pública, sin autenticación.
   *
   * Un `403` significa que la tabla no está configurada como pública en la
   * consola de Roble, no que el token sea inválido.
   */
  async publicRead(
    tableName: string,
    filters?: Record<string, any>
  ): Promise<Array<Record<string, any>>> {
    const query: Record<string, string> = { tableName };
    if (filters) {
      Object.entries(filters).forEach(([k, v]) => {
        query[k] = String(v);
      });
    }

    const res = await this._makeRequest<any>('database', 'GET', 'public-read', {
      query,
      skipAuth: true,
    });

    if (Array.isArray(res)) return res as Array<Record<string, any>>;
    if (Array.isArray(res?.data)) return res.data;
    return [];
  }

  /**
   * Ejecuta una consulta guardada previamente en la consola de Roble.
   *
   * Es la vía para joins, agregados, ordenamiento y paginación: `read` solo
   * admite filtros de igualdad. `id` es el UUID de la consulta guardada.
   */
  async executeQuery(id: string, params?: any[]): Promise<RobleQueryResult> {
    const res = await this._makeRequest<any>(
      'database',
      'POST',
      'execute-query',
      { body: params ? { id, params } : { id } }
    );

    if (!res || typeof res !== 'object') {
      throw new RobleApiFormatException(
        'Respuesta inesperada al ejecutar la consulta'
      );
    }

    return {
      success: res.success === true,
      command: res.command ?? null,
      rowCount: Number(res.rowCount ?? 0),
      rows: Array.isArray(res.rows) ? res.rows : [],
      fields: Array.isArray(res.fields) ? res.fields : [],
    };
  }

  // ============================
  //  Realtime
  // ============================

  private realtimeValue?: RobleRealtime;

  /** Acceso al servicio Realtime: árbol JSON al estilo Firebase. */
  get realtime(): RobleRealtime {
    return (this.realtimeValue ??= new RobleRealtime(this));
  }

  /** @internal Usado por RobleRealtime. `/realtime/health` no lleva proyecto. */
  async _realtimeHealth(): Promise<Record<string, any>> {
    const res = await this.send({
      url: '/realtime/health',
      baseURL: this.realtimeBaseUrl,
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      validateStatus: () => true,
      ...({ skipAuth: true } as any),
    });

    if (res.status >= 200 && res.status < 300) return res.data;
    throw new RobleApiHttpException(res.status, this.errorMessage(res));
  }

  /** @internal Usado por RobleRealtime. */
  async _realtimeRequest<T = any>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    options: {
      body?: any;
      query?: Record<string, any>;
      skipAuth?: boolean;
    } = {}
  ): Promise<T> {
    return this._makeRequest<T>('realtime', method, path, {
      ...options,
      baseUrlOverride: this.realtimeBaseUrl,
    });
  }

  // ============================
  //  Conveniencia (helpers)
  // ============================
  async getAll(tableName: string) {
    return this.read(tableName);
  }

  async getById(tableName: string, id: string | number) {
    const rows = await this.read(tableName, { _id: id });
    return rows.length ? rows[0] : null;
  }

  async getWhere(tableName: string, column: string, value: any) {
    return this.read(tableName, { [column]: value });
  }
}

// ============================
//  Realtime
// ============================

function normalizePath(path: string): string {
  return path
    .split('/')
    .filter((s) => s.length > 0)
    .join('/');
}

/**
 * Punto de entrada al servicio Realtime de Roble: un árbol JSON por proyecto,
 * con una API al estilo de Firebase Realtime Database.
 *
 * ```ts
 * const mensajes = db.realtime.ref('messages/general');
 * const id = await mensajes.push({ texto: 'Hola' });
 * await mensajes.child(id).update({ status: 'read' });
 * const datos = await mensajes.get();
 * ```
 */
/** Una escucha registrada sobre una ruta. */
interface RealtimeListener {
  segments: string[];
  collection: string;
  ref: RobleRealtimeRef;
  onEvent?: (event: RobleRealtimeEvent) => void;
  onValue?: (value: any) => void;
  onError?: (error: unknown) => void;
}

/** ¿Una ruta es prefijo de la otra? Cubre ancestros y descendientes. */
function pathsOverlap(a: string[], b: string[]): boolean {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
}

export class RobleRealtime {
  private socket: Socket | null = null;
  private readonly listeners = new Set<RealtimeListener>();
  /** colección -> subscriptionId devuelto por el servidor. */
  private readonly subscriptions = new Map<string, string>();
  private statusValue: RobleRealtimeStatus = 'disconnected';

  /** Se invoca en cada cambio de estado de la conexión. */
  onStatusChange?: (status: RobleRealtimeStatus) => void;

  constructor(private readonly client: RobleApiClient) {}

  /** Estado actual de la conexión WebSocket. */
  get status(): RobleRealtimeStatus {
    return this.statusValue;
  }

  /**
   * Referencia a una ruta del árbol. El primer segmento es la colección.
   * Sin argumentos apunta a la raíz del proyecto.
   */
  ref(path: string = ''): RobleRealtimeRef {
    return new RobleRealtimeRef(this.client, normalizePath(path), this);
  }

  /**
   * Cierra el WebSocket y cancela todas las escuchas.
   *
   * El socket se vuelve a abrir solo si se registra una escucha nueva.
   */
  close(): void {
    this.listeners.clear();
    this.subscriptions.clear();
    this.socket?.close();
    this.socket = null;
    this.setStatus('disconnected');
  }

  // ---- internos ----

  private setStatus(status: RobleRealtimeStatus) {
    if (this.statusValue === status) return;
    this.statusValue = status;
    this.onStatusChange?.(status);
  }

  private query() {
    return {
      token: this.client.accessToken ?? '',
      dbName: this.client.contractId,
    };
  }

  private ensureSocket(): Socket {
    if (this.socket) return this.socket;

    if (!this.client.accessToken) {
      throw new RobleApiAuthException(
        'No hay sesión activa para abrir el WebSocket de Realtime.'
      );
    }

    const wsUrl =
      this.client.realtimeBaseUrl.replace(/^http/, 'ws') + '/stream';
    this.setStatus('connecting');

    const socket = io(wsUrl, {
      transports: ['websocket'],
      query: this.query(),
    });

    socket.on('connect', () => {
      this.setStatus('connected');
      // Al reconectar hay que rehacer todas las suscripciones.
      this.subscriptions.clear();
      for (const collection of this.activeCollections()) {
        this.subscribeCollection(collection);
      }
    });

    socket.on('disconnect', () => {
      this.subscriptions.clear();
      this.setStatus('disconnected');
    });

    socket.on('connect_error', () => this.setStatus('error'));

    socket.on('data_change', (payload: any) => {
      for (const raw of Array.isArray(payload) ? payload : [payload]) {
        this.dispatch(raw);
      }
    });

    // El token puede haber cambiado desde la última conexión.
    socket.io.on('reconnect_attempt', () => {
      socket.io.opts.query = this.query();
    });

    this.socket = socket;
    return socket;
  }

  private activeCollections(): Set<string> {
    const set = new Set<string>();
    for (const l of this.listeners) if (l.collection) set.add(l.collection);
    return set;
  }

  private subscribeCollection(collection: string) {
    const socket = this.socket;
    if (!socket?.connected || this.subscriptions.has(collection)) return;

    socket.emit(
      'subscribe',
      {
        type: 'subscribe',
        requestId: `${collection}-${Date.now()}`,
        table: collection,
        events: ['INSERT', 'UPDATE', 'DELETE'],
      },
      (ack: any) => {
        if (ack?.subscriptionId) {
          this.subscriptions.set(collection, ack.subscriptionId);
        }
      }
    );
  }

  private unsubscribeCollection(collection: string) {
    const subscriptionId = this.subscriptions.get(collection);
    if (!subscriptionId) return;
    this.subscriptions.delete(collection);
    this.socket?.emit('unsubscribe', { type: 'unsubscribe', subscriptionId });
  }

  private dispatch(raw: any) {
    if (!raw || typeof raw !== 'object') return;

    const path: string[] = Array.isArray(raw.path) ? raw.path.map(String) : [];
    const event: RobleRealtimeEvent = {
      eventId: String(raw.eventId ?? ''),
      subscriptionId: String(raw.subscriptionId ?? ''),
      table: String(raw.table ?? path[0] ?? ''),
      path,
      pathString: path.join('/'),
      operation: raw.operation,
      oldValue: raw.old ?? null,
      newValue: raw.new ?? null,
      commitTimestamp: String(raw.commitTimestamp ?? ''),
      raw,
    };

    for (const l of this.listeners) {
      if (l.collection !== event.table) continue;
      if (!pathsOverlap(l.segments, path)) continue;

      if (l.onEvent) {
        try {
          l.onEvent(event);
        } catch (e) {
          l.onError?.(e);
        }
      }

      if (l.onValue) void this.emitValue(l);
    }
  }

  private async emitValue(l: RealtimeListener) {
    // `new` es parcial y no distingue PATCH de PUT, así que releemos el nodo.
    try {
      l.onValue?.(await l.ref.get());
    } catch (e) {
      l.onError?.(e);
    }
  }

  /** @internal Registra una escucha y devuelve su cancelación. */
  _addListener(listener: RealtimeListener): RobleUnsubscribe {
    this.listeners.add(listener);
    this.ensureSocket();
    this.subscribeCollection(listener.collection);

    if (listener.onValue) void this.emitValue(listener);

    let cancelled = false;
    return () => {
      if (cancelled) return;
      cancelled = true;
      this.listeners.delete(listener);

      // Si ya nadie escucha esa colección, se cancela en el servidor.
      const stillUsed = [...this.listeners].some(
        (l) => l.collection === listener.collection
      );
      if (!stillUsed) this.unsubscribeCollection(listener.collection);
    };
  }

  /** Nombres de las colecciones del proyecto. */
  async collections(): Promise<string[]> {
    const res = await this.client._realtimeRequest<any>('GET', '');
    return Array.isArray(res) ? res.map(String) : [];
  }

  /**
   * Estado del servicio Realtime (PostgreSQL, event bus y CDC).
   * No requiere autenticación y no depende del proyecto.
   */
  async health(): Promise<Record<string, any>> {
    return this.client._realtimeHealth();
  }
}

/**
 * Referencia a una ruta concreta del árbol Realtime.
 * Es inmutable: `child()` devuelve una referencia nueva.
 */
export class RobleRealtimeRef {
  constructor(
    private readonly client: RobleApiClient,
    /** Ruta normalizada, sin barras iniciales ni finales. Vacía en la raíz. */
    readonly path: string,
    private readonly realtime?: RobleRealtime
  ) {}

  private get segments(): string[] {
    return this.path ? this.path.split('/') : [];
  }

  private requireRealtime(): RobleRealtime {
    if (!this.realtime) {
      throw new RobleApiException(
        'Esta referencia no está asociada al servicio Realtime.'
      );
    }
    if (!this.path) {
      throw new RobleApiException(
        'No se puede escuchar la raíz del proyecto: indica al menos la colección.'
      );
    }
    return this.realtime;
  }

  /**
   * Escucha los cambios en esta ruta y en sus descendientes.
   *
   * Entrega el evento crudo del servidor, sin releer nada. Devuelve la función
   * para cancelar la escucha.
   *
   * ```ts
   * const off = db.realtime.ref('messages/general').onEvent((e) => {
   *   console.log(e.operation, e.pathString, e.newValue);
   * });
   * off();
   * ```
   */
  onEvent(
    listener: (event: RobleRealtimeEvent) => void,
    options: { onError?: (error: unknown) => void } = {}
  ): RobleUnsubscribe {
    const rt = this.requireRealtime();
    return rt._addListener({
      segments: this.segments,
      collection: this.segments[0]!,
      ref: this,
      onEvent: listener,
      onError: options.onError,
    });
  }

  /**
   * Escucha el valor de esta ruta, al estilo `onValue` de Firebase.
   *
   * Emite el valor actual al suscribirse y vuelve a emitirlo tras cada cambio.
   * Relee el nodo por REST en cada evento porque el `new` del servidor es
   * parcial y no distingue `PATCH` de `PUT`.
   */
  onValue(
    listener: (value: any) => void,
    options: { onError?: (error: unknown) => void } = {}
  ): RobleUnsubscribe {
    const rt = this.requireRealtime();
    return rt._addListener({
      segments: this.segments,
      collection: this.segments[0]!,
      ref: this,
      onValue: listener,
      onError: options.onError,
    });
  }

  /** Nombre del último segmento, o `null` en la raíz. */
  get key(): string | null {
    if (!this.path) return null;
    const segments = this.path.split('/');
    return segments[segments.length - 1] ?? null;
  }

  /** Referencia al hijo indicado. Admite rutas con varios segmentos. */
  child(childPath: string): RobleRealtimeRef {
    const sub = normalizePath(childPath);
    if (!sub) return this;
    return new RobleRealtimeRef(
      this.client,
      this.path ? `${this.path}/${sub}` : sub,
      this.realtime
    );
  }

  /** Referencia al padre, o `null` si ya es la raíz. */
  get parent(): RobleRealtimeRef | null {
    if (!this.path) return null;
    const segments = this.path.split('/');
    segments.pop();
    return new RobleRealtimeRef(this.client, segments.join('/'), this.realtime);
  }

  /**
   * Lee el valor JSON en esta ruta.
   *
   * Con `shallow` en `true` devuelve solo las claves inmediatas: las hojas
   * conservan su valor y los hijos objeto/array se marcan con `$$kind`.
   */
  async get(options: { shallow?: boolean } = {}): Promise<any> {
    return this.client._realtimeRequest('GET', this.path, {
      query: options.shallow ? { shallow: 'true' } : undefined,
    });
  }

  /** Sobrescribe el valor en esta ruta. Crea la colección si no existe. */
  async set(value: any): Promise<any> {
    return this.client._realtimeRequest('PUT', this.path, { body: value });
  }

  /** Fusiona los campos indicados con el objeto existente en esta ruta. */
  async update(fields: Record<string, any>): Promise<Record<string, any>> {
    return this.client._realtimeRequest('PATCH', this.path, { body: fields });
  }

  /**
   * Agrega un hijo con ID autogenerado, como `push()` de Firebase.
   * Devuelve el ID generado.
   */
  async push(value: any): Promise<string> {
    const res = await this.client._realtimeRequest<any>('POST', this.path, {
      body: value,
    });

    if (res?.name) return String(res.name);
    throw new RobleApiFormatException(
      'El servidor no devolvió el ID generado.'
    );
  }

  /**
   * Elimina el valor en esta ruta. Si la ruta es solo la colección, la
   * elimina completa.
   */
  async remove(): Promise<void> {
    await this.client._realtimeRequest('DELETE', this.path);
  }

  toString(): string {
    return `RobleRealtimeRef(/${this.path})`;
  }
}

// ============================
//  Factoría simple (opcional)
// ============================
export function createRobleClient(config: RobleApiConfig) {
  return new RobleApiClient(config);
}
