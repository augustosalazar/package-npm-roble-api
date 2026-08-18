// src/index.ts
import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from 'axios';

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

/**
 * El servidor aceptó la petición pero rechazó parte de los registros.
 *
 * Solo la lanza `createMany(..., { strict: true })`. Conserva el resultado
 * completo para poder saber **qué sí se escribió**, algo necesario si hay que
 * deshacer la operación.
 */
export class RoblePartialInsertException extends RobleApiException {
  /** Filas insertadas y rechazadas, tal cual las devolvió el servidor. */
  readonly result: RobleInsertResult;

  constructor(result: RobleInsertResult) {
    const total = result.inserted.length + result.skipped.length;
    const detalle = result.skipped
      .map((s) => `fila ${s.index} (${s.reason})`)
      .join('; ');
    super(
      `El servidor rechazó ${result.skipped.length} de ${total} registros: ${detalle}`
    );
    this.name = 'RoblePartialInsertException';
    this.result = result;
  }
}

// ============================
//  Configuración
// ============================
export type RobleApiHeaders = Record<string, string>;

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

/**
 * Almacenamiento donde persistir la sesión entre reinicios.
 *
 * `localStorage` del navegador ya cumple esta interfaz. En otros entornos se
 * envuelve lo que ya use el proyecto, en tres líneas:
 *
 * ```ts
 * // React Native / Expo
 * { getItem: AsyncStorage.getItem, setItem: AsyncStorage.setItem,
 *   removeItem: AsyncStorage.removeItem }
 * ```
 *
 * En móvil conviene un almacén seguro (Keychain/Keystore, p. ej.
 * `expo-secure-store`): el refresh token es la credencial de larga duración.
 */
export interface RobleStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

/** Perfil del usuario autenticado, devuelto por `GET /me`. */
export interface RobleUser {
  /** Id del registro de perfil. */
  id: string;
  /** Id del usuario. Es con lo que se comparan los campos tipo `autorId`. */
  userId: string;
  email: string;
  name: string;
  /** Campos adicionales enviados al registrarse. `null` si no se usaron. */
  extra: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
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
   * Dónde persistir la sesión (opcional).
   *
   * En el navegador se usa `localStorage` automáticamente si no se indica
   * nada. En Node, React Native o Flutter hay que pasarlo. Sin almacenamiento
   * la sesión vive solo en memoria y se pierde al reiniciar.
   *
   * Tras configurarlo, llama a `await db.restoreSession()` al arrancar.
   */
  storage?: RobleStorage;

  /** Timeout en ms (default 30000) */
  timeoutMs?: number;
}

/**
 * Falla al construir, y no con un 500 críptico en la primera petición.
 *
 * @throws Error si `baseUrl` no es una URL o si `contractId` está vacío o
 * sigue siendo un valor de ejemplo.
 */
function validateConfig(config: RobleApiConfig): void {
  if (!config.baseUrl?.startsWith('http')) {
    throw new Error(
      `baseUrl inválida: "${config.baseUrl}". Debe empezar por http:// o https://`
    );
  }

  const id = config.contractId?.trim() ?? '';
  if (!id) {
    throw new Error(
      'contractId no puede estar vacío. Es el identificador del proyecto en ' +
        'la consola de Roble, algo como "miproyecto_ab12cd34ef"'
    );
  }
  if (id === 'tu_contrato' || id === 'mi_contrato' || id.includes(' ')) {
    throw new Error(
      `contractId "${config.contractId}" no parece un contrato real. ` +
        'Cópialo de la consola de Roble'
    );
  }
}

/** `localStorage` cuando existe; si no, nada. */
function defaultStorage(): RobleStorage | undefined {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) {
      return localStorage as RobleStorage;
    }
  } catch {
    // Algunos navegadores lanzan al leer localStorage con cookies bloqueadas.
  }
  return undefined;
}

// ============================
//  Cliente principal
// ============================
export class RobleApiClient {
  static DEFAULT_TIMEOUT_MS = 30_000;

  /** Identificador del contrato usado en todas las rutas. */
  readonly contractId: string;
  private readonly http: AxiosInstance;

  // Campos privados de JavaScript: inaccesibles también desde JS, no solo
  // desde TypeScript.
  #accessToken: string | null = null;
  #refreshToken: string | null = null;

  /**
   * Si la sesión debe sobrevivir al cierre de la app. Lo fija `login` con su
   * parámetro `persistSession` y afecta también a los refrescos posteriores.
   */
  #persistTokens = true;

  readonly #storage?: RobleStorage;
  readonly #storageKey: string;

  constructor(config: RobleApiConfig) {
    validateConfig(config);

    this.contractId = config.contractId;
    this.#storage = config.storage ?? defaultStorage();
    this.#storageKey = `roble.session.${config.contractId}`;

    this.http = axios.create({
      baseURL: config.baseUrl.replace(/\/+$/, ''), // sin / final
      timeout: config.timeoutMs ?? RobleApiClient.DEFAULT_TIMEOUT_MS,
    });

    // Anexa Authorization automáticamente si hay token, salvo que la
    // petición lo desactive con `skipAuth` (endpoints públicos).
    this.http.interceptors.request.use((cfg) => {
      cfg.headers = cfg.headers ?? {};
      if (!(cfg as any).skipAuth && this.#accessToken) {
        (cfg.headers as any).Authorization = `Bearer ${this.#accessToken}`;
      }
      return cfg;
    });
  }

  // ============================
  //  Sesión
  // ============================

  /**
   * `true` si hay una sesión iniciada en este cliente.
   *
   * No dice si el servidor la sigue aceptando: para eso está
   * `restoreSession()`.
   */
  get isLoggedIn(): boolean {
    return this.#accessToken !== null && this.#accessToken !== '';
  }

  #updateAccessToken(token: string | null) {
    this.#accessToken = token;
    // Único punto por el que pasan login, refresco, logout y restauración.
    void this.#persistSession();
  }

  /** Descarta la sesión en memoria y en el almacenamiento. */
  #clearTokens() {
    this.#refreshToken = null;
    this.#updateAccessToken(null);
  }

  /**
   * Restaura la sesión y comprueba que siga siendo válida.
   *
   * Llámalo al arrancar la app, antes de pintar pantallas protegidas:
   *
   * ```ts
   * if (await db.restoreSession()) {
   *   irAlInicio();
   * } else {
   *   irAlLogin();
   * }
   * ```
   *
   * Carga los tokens del `storage` (si no hay ya una sesión en memoria) y
   * renueva el access token con el refresh token. Devuelve `true` solo si el
   * servidor acepta la renovación, así que un `true` significa que la sesión
   * sirve de verdad, no solo que había tokens guardados.
   *
   * Si el refresh token ya no vale, limpia la sesión y devuelve `false`.
   *
   * Los fallos de red **no** borran la sesión: se propaga la excepción
   * (`RobleApiNetworkException`, `RobleApiTimeoutException`) para que la app
   * pueda distinguir "sesión caducada" de "sin conexión" y reintentar.
   *
   * Con `verify: false` solo carga los tokens del almacenamiento, sin llamar
   * al servidor: más rápido, pero la sesión puede estar caducada.
   */
  async restoreSession({
    verify = true,
  }: { verify?: boolean } = {}): Promise<boolean> {
    // 1. Si no hay sesión en memoria, se intenta cargar del almacenamiento.
    if (!this.#refreshToken) await this.#loadStoredSession();
    if (!this.#refreshToken) return false;

    // Si la sesión venía del almacén, se sigue persistiendo.
    this.#persistTokens = true;

    if (!verify) return true;

    // 2. Renovar es la única forma de saber si el refresh token sigue vivo.
    try {
      await this.#refreshAccessToken();
      return true;
    } catch (e) {
      if (
        e instanceof RobleApiNetworkException ||
        e instanceof RobleApiTimeoutException
      ) {
        throw e;
      }
      // Token revocado o caducado: la sesión ya no sirve.
      this.#clearTokens();
      return false;
    }
  }

  /** Borra la sesión guardada sin tocar la que hay en memoria. */
  async #forgetStoredSession(): Promise<void> {
    try {
      await this.#storage?.removeItem(this.#storageKey);
    } catch {
      // Almacenamiento no disponible: no hay nada que borrar.
    }
  }

  /** Carga los tokens guardados en `storage`, si los hay. */
  async #loadStoredSession(): Promise<void> {
    if (!this.#storage) return;

    try {
      const raw = await this.#storage.getItem(this.#storageKey);
      if (!raw) return;

      const { accessToken, refreshToken } = JSON.parse(raw);
      if (!accessToken || !refreshToken) return;

      this.#refreshToken = refreshToken;
      this.#updateAccessToken(accessToken);
    } catch {
      // Sesión corrupta o almacenamiento no disponible: se empieza de cero.
    }
  }

  /** Guarda o borra la sesión. Nunca hace fallar la petición en curso. */
  async #persistSession(): Promise<void> {
    if (!this.#storage) return;

    try {
      if (this.#accessToken && this.#refreshToken) {
        // Con `persistSession: false` la sesión vive solo en memoria.
        if (!this.#persistTokens) return;
        await this.#storage.setItem(
          this.#storageKey,
          JSON.stringify({
            accessToken: this.#accessToken,
            refreshToken: this.#refreshToken,
          })
        );
      } else {
        await this.#storage.removeItem(this.#storageKey);
      }
    } catch {
      // Almacenamiento lleno o sin permisos: la sesión sigue en memoria.
    }
  }

  // ============================
  //  Helpers internos
  // ============================
  private buildPath(kind: 'auth' | 'database', endpoint: string) {
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
    kind: 'auth' | 'database',
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    endpoint: string,
    {
      body,
      query,
      isAuthRequest = false, // true solo para login/refresh/signup/logout
      skipAuth = false, // true para endpoints públicos
    }: {
      body?: any;
      query?: Record<string, any>;
      isAuthRequest?: boolean;
      skipAuth?: boolean;
    } = {}
  ): Promise<T> {
    const cfg: AxiosRequestConfig = {
      url: this.buildPath(kind, endpoint),
      method,
      headers: { 'Content-Type': 'application/json' },
      params: query,
      // Comparar contra undefined, no truthiness: 0, false y "" son válidos.
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
      this.#refreshToken
    ) {
      try {
        await this.#refreshAccessToken();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new RobleApiAuthException(
          `Token expirado y no se pudo refrescar: ${msg}`
        );
      }

      res = await this.send(cfg);
      if (res.status >= 200 && res.status < 300) return res.data as T;
    }

    let mensaje = this.errorMessage(res);

    // Un 500 en autenticación es lo que devuelve Roble cuando el contrato no
    // existe; sin esta pista el mensaje no ayuda nada a diagnosticarlo.
    if (isAuthRequest && res.status === 500) {
      mensaje += ` — revisa que el contractId sea correcto (${this.contractId})`;
    }

    throw new RobleApiHttpException(res.status, mensaje);
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
    autoLogin?: boolean;
    persistSession?: boolean;
  }): Promise<Record<string, any>> {
    const res = await this._makeRequest<Record<string, any>>(
      'auth',
      'POST',
      'signup-direct',
      {
        body: {
          email: params.email,
          password: params.password,
          name: params.name,
          ...(params.extra ? { extra: params.extra } : {}),
        },
        isAuthRequest: true,
      }
    );

    if (params.autoLogin) {
      return this.login({
        email: params.email,
        password: params.password,
        persistSession: params.persistSession ?? true,
      });
    }

    return res;
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

  /**
   * Inicia sesión y devuelve el perfil del usuario.
   *
   * Los tokens se guardan internamente; si los necesitas están en
   * `accessToken` y `refreshToken`.
   *
   * Tras autenticar, pide el perfil a `/me`. Si esa segunda llamada falla, la
   * sesión **sigue activa**: el error se propaga, pero `accessToken` ya tiene
   * valor, así que puedes distinguir un fallo de credenciales de uno de perfil
   * y reintentar con `currentUser()`.
   *
   * ```ts
   * try {
   *   const user = await db.login({ email, password });
   * } catch (e) {
   *   if (db.accessToken) {
   *     // credenciales correctas, solo falló el perfil
   *     const user = await db.currentUser();
   *   } else {
   *     // credenciales inválidas o problema de red
   *   }
   * }
   * ```
   */
  async login(params: {
    email: string;
    password: string;
    persistSession?: boolean;
  }): Promise<RobleUser> {
    const persistSession = params.persistSession ?? true;

    const data = await this._makeRequest<any>('auth', 'POST', 'login', {
      body: { email: params.email, password: params.password },
      isAuthRequest: true,
    });

    this.#persistTokens = persistSession;
    // Si esta vez no se quiere recordar la sesión, se borra la anterior.
    if (!persistSession) await this.#forgetStoredSession();

    if (data?.accessToken) {
      this.#refreshToken = data.refreshToken ?? null;
      this.#updateAccessToken(data.accessToken);
    }

    return this.currentUser();
  }

  /** Cierra la sesión en el servidor y descarta los tokens locales. */
  async logout(): Promise<void> {
    if (!this.#accessToken) {
      throw new RobleApiAuthException(
        'No hay token activo para cerrar sesión.'
      );
    }

    // Sin body: el token viaja en el header Authorization.
    await this._makeRequest('auth', 'POST', 'logout', { isAuthRequest: true });

    this.#clearTokens();
  }

  /**
   * Devuelve el perfil del usuario autenticado: `userId`, `email`, `name`,
   * el `extra` que se envió al registrarse y las fechas del registro.
   *
   * Lanza `RobleApiHttpException` con `401` si no hay sesión válida.
   */
  async currentUser(): Promise<RobleUser> {
    return this._makeRequest<RobleUser>('auth', 'GET', 'me', {
      isAuthRequest: true,
    });
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
    if (!this.#accessToken) {
      throw new RobleApiAuthException(
        'No hay sesión activa para eliminar la cuenta.'
      );
    }

    await this._makeRequest('auth', 'DELETE', 'account', {
      isAuthRequest: true,
    });

    this.#clearTokens();
  }

  /**
   * Refresca el access token con el refresh token almacenado.
   *
   * Es interno a propósito: se invoca automáticamente cuando una petición
   * de datos responde `401`. No forma parte de la API pública.
   */
  async #refreshAccessToken(): Promise<void> {
    if (!this.#refreshToken) {
      throw new RobleApiAuthException('No hay refresh token disponible.');
    }

    const data = await this._makeRequest<any>('auth', 'POST', 'refresh-token', {
      body: { refreshToken: this.#refreshToken },
      isAuthRequest: true,
    });

    if (!data?.accessToken) {
      throw new RobleApiAuthException(
        'Respuesta inválida al refrescar el token.'
      );
    }

    // Hoy el servidor solo devuelve accessToken, pero si algún día rota el
    // refresh token no hay que perderlo.
    if (data.refreshToken) this.#refreshToken = data.refreshToken;

    this.#updateAccessToken(data.accessToken);
  }

  // ============================
  //  TABLAS / CRUD
  // ============================

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
    records: Array<Record<string, any>>,
    options: { strict?: boolean } = {}
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

    const result: RobleInsertResult = {
      inserted,
      skipped,
      hasSkipped: skipped.length > 0,
    };

    // Con `strict` el rechazo parcial deja de ser algo que haya que recordar
    // mirar: se convierte en un error.
    if (options.strict && result.hasSkipped) {
      throw new RoblePartialInsertException(result);
    }

    return result;
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

  /**
   * Devuelve el registro con ese `_id`, o `null` si no existe.
   *
   * ```ts
   * const usuario = await db.getById('usuarios', 'customid1234');
   * if (!usuario) mostrarNoEncontrado();
   * ```
   */
  async getById(
    tableName: string,
    id: string | number
  ): Promise<Record<string, any> | null> {
    const rows = await this.read(tableName, { _id: id });
    return rows.length ? rows[0]! : null;
  }
}

// ============================
//  Factoría simple (opcional)
// ============================
export function createRobleClient(config: RobleApiConfig) {
  return new RobleApiClient(config);
}
