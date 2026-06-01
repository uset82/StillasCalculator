import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';

const DEVICE_AUTH_EXPIRES_MS = 15 * 60_000;
const DEVICE_AUTH_RATE_LIMIT_MESSAGE =
  'ChatGPT sign-in is temporarily rate-limited after too many device-code attempts. Wait a few minutes, then start sign-in once and use the code already shown in the app.';

export interface CodexAccountState {
  authenticated: boolean;
  email: string | null;
  planType: string | null;
  authMode: string | null;
}

export interface CodexDeviceLogin {
  loginId: string;
  verificationUri: string;
  userCode: string;
  expiresAt: number;
}

export interface CodexLoginNotificationState {
  authenticated: boolean;
  pending: boolean;
  error: string | null;
  deviceCodeRequired: boolean;
  planType: string | null;
}

export interface CodexAppServerClientOptions {
  codexHome: string;
  cwd: string;
  command?: string;
  onNotification?: (message: unknown) => void;
}

interface JsonRpcResponse {
  id?: unknown;
  result?: unknown;
  error?: { message?: unknown } | unknown;
  method?: unknown;
  params?: unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function errorMessage(value: unknown, fallback: string): string {
  const record = asRecord(value);
  if (!record) return fallback;
  return stringOrNull(record.message) ?? fallback;
}

export function isDeviceCodeSettingsError(error: string): boolean {
  return /device\s+code|device-code|security settings|workspace permissions|not enabled|authorization/i.test(
    error,
  );
}

export function isDeviceAuthRateLimitError(error: string): boolean {
  return /429|too many requests|rate[-\s]*limit/i.test(error);
}

function normalizeLoginError(error: string): string {
  return isDeviceAuthRateLimitError(error)
    ? DEVICE_AUTH_RATE_LIMIT_MESSAGE
    : error;
}

export function parseAccountReadResult(payload: unknown): CodexAccountState {
  const record = asRecord(payload);
  const account = asRecord(record?.account);
  const authMode = stringOrNull(account?.type);
  const authenticated = authMode === 'chatgpt' || authMode === 'chatgptAuthTokens';
  return {
    authenticated,
    email: authenticated ? stringOrNull(account?.email) : null,
    planType: authenticated ? stringOrNull(account?.planType) : null,
    authMode,
  };
}

export function parseDeviceLoginStartResult(
  payload: unknown,
  now = Date.now(),
): CodexDeviceLogin {
  const record = asRecord(payload);
  if (record?.type !== 'chatgptDeviceCode') {
    throw new Error('Codex app-server did not start a ChatGPT device-code login.');
  }
  const loginId = stringOrNull(record.loginId);
  const verificationUri =
    stringOrNull(record.verificationUrl) ?? stringOrNull(record.verificationUri);
  const userCode = stringOrNull(record.userCode);
  if (!loginId || !verificationUri || !userCode) {
    throw new Error('Codex app-server did not return a complete device-code login.');
  }
  return {
    loginId,
    verificationUri,
    userCode,
    expiresAt: now + DEVICE_AUTH_EXPIRES_MS,
  };
}

export function applyAccountNotification(
  current: CodexLoginNotificationState,
  message: unknown,
): CodexLoginNotificationState {
  const record = asRecord(message);
  const method = stringOrNull(record?.method);
  const params = asRecord(record?.params);
  if (method === 'account/login/completed') {
    const success = params?.success === true;
    const rawError =
      stringOrNull(params?.error) ?? 'ChatGPT sign-in did not complete.';
    const error = success
      ? null
      : normalizeLoginError(rawError);
    return {
      ...current,
      pending: false,
      error,
      deviceCodeRequired: !success && isDeviceCodeSettingsError(rawError),
    };
  }
  if (method === 'account/updated') {
    const authMode = stringOrNull(params?.authMode);
    const authenticated = authMode === 'chatgpt' || authMode === 'chatgptAuthTokens';
    return {
      ...current,
      authenticated,
      pending: authenticated ? false : current.pending,
      error: authenticated ? null : current.error,
      planType: authenticated ? stringOrNull(params?.planType) : null,
    };
  }
  return current;
}

function codexCommand(command?: string): string {
  return command?.trim() || process.env.STILLAS_CODEX_CLI_PATH?.trim() || 'codex';
}

function shouldUseShell(command: string): boolean {
  return process.platform === 'win32' && !command.toLowerCase().endsWith('.exe');
}

function processEnv(codexHome: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CODEX_HOME: codexHome,
  };
}

export class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private reader: ReadlineInterface | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private initialized = false;
  private lastStderr = '';

  constructor(private readonly options: CodexAppServerClientOptions) {}

  get stderr(): string {
    return this.lastStderr.trim();
  }

  async accountRead(): Promise<CodexAccountState> {
    const result = await this.request('account/read', { refreshToken: false });
    return parseAccountReadResult(result);
  }

  async startDeviceLogin(now = Date.now()): Promise<CodexDeviceLogin> {
    const result = await this.request('account/login/start', {
      type: 'chatgptDeviceCode',
    });
    return parseDeviceLoginStartResult(result, now);
  }

  async close(): Promise<void> {
    for (const pending of this.pending.values()) {
      pending.reject(new Error('Codex app-server was closed.'));
    }
    this.pending.clear();
    this.reader?.close();
    this.reader = null;
    const child = this.child;
    this.child = null;
    this.initialized = false;
    if (child && !child.killed) {
      await this.killChildProcess(child);
    }
  }

  private killChildProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (process.platform !== 'win32' || child.pid === undefined) {
      child.kill();
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.on('error', () => {
        child.kill();
        resolve();
      });
      killer.on('close', () => resolve());
    });
  }

  private async ensureStarted(): Promise<void> {
    if (this.child && !this.child.killed && this.initialized) return;

    await mkdir(this.options.codexHome, { recursive: true });
    const command = codexCommand(this.options.command);
    const child = spawn(command, ['app-server', '--listen', 'stdio://'], {
      cwd: this.options.cwd,
      env: processEnv(this.options.codexHome),
      shell: shouldUseShell(command),
      windowsHide: true,
    });
    this.child = child;
    this.reader = createInterface({ input: child.stdout });
    this.reader.on('line', (line) => this.handleLine(line));
    child.stderr.on('data', (chunk: Buffer) => {
      this.lastStderr = `${this.lastStderr}${chunk.toString('utf8')}`.slice(-4000);
    });
    child.on('error', (error) => this.rejectAll(error));
    child.on('close', (code) => {
      this.initialized = false;
      this.child = null;
      this.rejectAll(
        new Error(`Codex app-server exited (${code ?? 'unknown'}). ${this.stderr}`),
      );
    });

    await this.send('initialize', {
      clientInfo: {
        name: 'stillas_calculator_backend',
        title: 'StillasCalculator Codex Backend',
        version: '0.1.0',
      },
    });
    this.notify('initialized', {});
    this.initialized = true;
  }

  private async request(method: string, params?: unknown): Promise<unknown> {
    await this.ensureStarted();
    return this.send(method, params);
  }

  private send(method: string, params?: unknown): Promise<unknown> {
    const child = this.child;
    if (!child || child.killed) {
      return Promise.reject(new Error('Codex app-server is not running.'));
    }
    const id = this.nextId++;
    const message = params === undefined ? { method, id } : { method, id, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  private notify(method: string, params?: unknown): void {
    const child = this.child;
    if (!child || child.killed) return;
    const message = params === undefined ? { method } : { method, params };
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    let message: JsonRpcResponse;
    try {
      message = JSON.parse(line) as JsonRpcResponse;
    } catch {
      return;
    }
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(errorMessage(message.error, 'Codex request failed.')));
      } else {
        pending.resolve(message.result);
      }
    } else if (typeof message.method === 'string') {
      this.options.onNotification?.(message);
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
