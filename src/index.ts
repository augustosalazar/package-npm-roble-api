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

export interface RobleApiConfig {
  /** Host del backend, p. ej: https://roble.test-openlab.uninorte.edu.co */
  baseUrl: string;

  /** Identificador del contrato de autenticación (ruta `/auth/{contractId}`). */
  contractId: string;

  /**
   * Identificador del proyecto de datos (ruta `/database/{projectId}`).
   * Si se omite, se reutiliza [contractId].
   */
  projectId?: string;

  /** Headers para AUTH (opcional) */
  authHeaders?: RobleApiHeaders;

  /** Headers para DATA/DB (opcional) */
  dataHeaders?: RobleApiHeaders;

  /** Timeout en ms (default 30000) */
  timeoutMs?: number;

  /**
   * Escape hatch para componer la ruta final. Por defecto:
   *   auth: /auth/{contractId}/{endpoint}
   *   data: /database/{projectId}/{endpoint}
   */
  pathBuilder?: (
    kind: 'auth' | 'database',
    endpoint: string,
    id: string
  ) => string;
}

// ============================
//  Cliente principal
// ============================
export class RobleApiClient {
  static DEFAULT_TIMEOUT_MS = 30_000;

  private readonly contractId: string;
  private readonly projectId: string;
  private readonly authHeaders: RobleApiHeaders;
  private readonly dataHeaders: RobleApiHeaders;
  private readonly pathBuilder: NonNullable<RobleApiConfig['pathBuilder']>;
  private readonly http: AxiosInstance;

  private accessTokenValue: string | null = null;
  private refreshTokenValue: string | null = null;

  /**
   * Callback opcional invocado cada vez que cambia el access token:
   * login, refresco automático o logout. Útil para persistir la sesión.
   */
  onTokenUpdate?: (token: string | null) => void;

  constructor(config: RobleApiConfig) {
    this.contractId = config.contractId;
    this.projectId = config.projectId ?? config.contractId;
    this.authHeaders = config.authHeaders ?? {};
    this.dataHeaders = config.dataHeaders ?? {};
    this.pathBuilder =
      config.pathBuilder ??
      ((kind, endpoint, id) =>
        kind === 'auth'
          ? `/auth/${id}/${endpoint}`
          : `/database/${id}/${endpoint}`);

    this.http = axios.create({
      baseURL: config.baseUrl.replace(/\/+$/, ''), // sin / final
      timeout: config.timeoutMs ?? RobleApiClient.DEFAULT_TIMEOUT_MS,
    });

    // Anexa Authorization automáticamente si hay token.
    this.http.interceptors.request.use((cfg) => {
      cfg.headers = cfg.headers ?? {};
      if (this.accessTokenValue) {
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
  private mergeHeaders(
    base: RobleApiHeaders,
    extra?: RobleApiHeaders
  ): RobleApiHeaders {
    return {
      'Content-Type': 'application/json',
      ...base,
      ...(extra ?? {}),
    };
  }

  private buildPath(kind: 'auth' | 'database', endpoint: string) {
    return this.pathBuilder(
      kind,
      endpoint,
      kind === 'auth' ? this.contractId : this.projectId
    );
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
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    {
      body,
      query,
      extraHeaders,
      isAuthRequest = false, // true solo para login/refresh/signup/logout
    }: {
      body?: any;
      query?: Record<string, any>;
      extraHeaders?: RobleApiHeaders;
      isAuthRequest?: boolean;
    } = {}
  ): Promise<T> {
    const cfg: AxiosRequestConfig = {
      url: this.buildPath(kind, endpoint),
      method,
      headers: this.mergeHeaders(
        kind === 'auth' ? this.authHeaders : this.dataHeaders,
        extraHeaders
      ),
      params: query,
      data: body ? JSON.stringify(body) : undefined,
      validateStatus: () => true, // manejamos el status manualmente
    };

    let res = await this.send(cfg);

    // Éxito 2xx
    if (res.status >= 200 && res.status < 300) return res.data as T;

    // 401 en endpoints de DATA: refrescamos y reintentamos una sola vez.
    if (res.status === 401 && !isAuthRequest && this.refreshTokenValue) {
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

  /** Registra un usuario sin verificación por correo. */
  async register(params: {
    email: string;
    password: string;
    name: string;
  }): Promise<Record<string, any>> {
    return this._makeRequest('auth', 'POST', 'signup-direct', {
      body: {
        email: params.email,
        password: params.password,
        name: params.name,
      },
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

  /** Inserta un registro y devuelve el registro insertado. */
  async create(
    tableName: string,
    data: Record<string, any>
  ): Promise<Record<string, any>> {
    const res = await this._makeRequest<any>('database', 'POST', 'insert', {
      body: { tableName, records: [data] },
    });

    if (res?.inserted?.length) return { ...res.inserted[0] };
    if (res && typeof res === 'object') return res;
    throw new RobleApiException('No se pudo insertar el registro');
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
//  Factoría simple (opcional)
// ============================
export function createRobleClient(config: RobleApiConfig) {
  return new RobleApiClient(config);
}
