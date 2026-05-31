import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const LOGIN_STATUS_TIMEOUT_MS = 8_000;
const SIGN_IN_OUTPUT_TIMEOUT_MS = 10_000;
const DEVICE_AUTH_EXPIRES_MS = 15 * 60_000;

export type CodexCliLoginMethod = 'chatgpt' | 'api-key' | 'access-token' | 'unknown';

export interface CodexCliAuthStatus {
  loggedIn: boolean;
  method: CodexCliLoginMethod | null;
}

export type CodexSignInResult =
  | {
      ok: true;
      alreadyConnected: boolean;
      message: string;
      deviceAuth?: {
        verificationUri: string;
        userCode: string;
        expiresAt: number;
      };
    }
  | { ok: false; error: string; message: string };

interface RunProcessOptions {
  timeoutMs: number;
}

interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface ActiveDeviceSignIn {
  child: ChildProcess;
  result: Extract<CodexSignInResult, { ok: true }>;
  expiresAt: number;
}

let activeDeviceSignIn: ActiveDeviceSignIn | null = null;

interface CodexCommandCandidate {
  command: string;
  baseArgs: string[];
  key: string;
}

const requireFromHere = createRequire(import.meta.url);

function getPackagedCodexEntrypoint(): string | undefined {
  try {
    const packageJsonPath = requireFromHere.resolve('@openai/codex/package.json');
    return join(dirname(packageJsonPath), 'bin', 'codex.js');
  } catch {
    return undefined;
  }
}

function getCodexProcessEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };

  if (!env.CODEX_HOME && (env.NETLIFY || env.AWS_LAMBDA_FUNCTION_NAME)) {
    const codexHome = join(tmpdir(), 'stillas-codex-home');
    try {
      mkdirSync(codexHome, { recursive: true });
      env.CODEX_HOME = codexHome;
    } catch {
      // If /tmp is unexpectedly unavailable, let the CLI report the real error.
    }
  }

  return env;
}

function getCodexCommandCandidates(): CodexCommandCandidate[] {
  const candidates: CodexCommandCandidate[] = [];
  const add = (command: string | undefined, baseArgs: string[] = []) => {
    const value = command?.trim();
    const key = [value, ...baseArgs].join('\0');
    if (value && !candidates.some((candidate) => candidate.key === key)) {
      candidates.push({ command: value, baseArgs, key });
    }
  };

  add(process.env.STILLAS_CODEX_CLI_PATH);
  add(process.env.CODEX_CLI_PATH);

  const projectBin = join(process.cwd(), 'node_modules', '.bin');
  if (process.platform === 'win32') {
    add(join(projectBin, 'codex.cmd'));
    add(process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'codex.cmd') : undefined);

    const localBin = process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin')
      : undefined;
    if (localBin && existsSync(localBin)) {
      for (const entry of readdirSync(localBin, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          add(join(localBin, entry.name, 'codex.exe'));
        }
      }
    }

    add('codex.cmd');
  } else {
    add(join(projectBin, 'codex'));
  }

  const packagedEntrypoint = getPackagedCodexEntrypoint();
  if (packagedEntrypoint) {
    add(process.execPath, [packagedEntrypoint]);
  }

  add('codex');
  return candidates;
}

function shouldUseShell(command: string): boolean {
  return process.platform === 'win32' && !command.toLowerCase().endsWith('.exe');
}

function runProcess(
  candidate: CodexCommandCandidate,
  args: string[],
  { timeoutMs }: RunProcessOptions,
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(candidate.command, [...candidate.baseArgs, ...args], {
      cwd: process.cwd(),
      env: getCodexProcessEnv(),
      shell: shouldUseShell(candidate.command),
      windowsHide: true,
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    const timer = setTimeout(() => {
      child.kill();
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        exitCode: null,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: error.message,
      });
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });

    child.stdin.end();
  });
}

function parseLoginMethod(output: string): CodexCliLoginMethod {
  if (/chatgpt/i.test(output)) return 'chatgpt';
  if (/api\s*key/i.test(output)) return 'api-key';
  if (/access\s*token/i.test(output)) return 'access-token';
  return 'unknown';
}

function hasChatGptAuth(status: CodexCliAuthStatus): boolean {
  return status.loggedIn && status.method === 'chatgpt';
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, '');
}

function parseDeviceAuth(output: string):
  | { verificationUri: string; userCode: string; expiresAt: number }
  | null {
  const text = stripAnsi(output);
  const verificationUri = text.match(/https:\/\/auth\.openai\.com\/codex\/device/)?.[0];
  const userCode = text.match(/\b[A-Z0-9]{4}-[A-Z0-9]{5}\b/)?.[0];
  if (!verificationUri || !userCode) {
    return null;
  }
  return {
    verificationUri,
    userCode,
    expiresAt: Date.now() + DEVICE_AUTH_EXPIRES_MS,
  };
}

async function getCodexLoginStatus(
  candidate: CodexCommandCandidate,
): Promise<CodexCliAuthStatus> {
  const result = await runProcess(candidate, ['login', 'status'], {
    timeoutMs: LOGIN_STATUS_TIMEOUT_MS,
  });
  const output = `${result.stdout}\n${result.stderr}`;
  const loggedIn = result.exitCode === 0 && /Logged in/i.test(output);
  return {
    loggedIn,
    method: loggedIn ? parseLoginMethod(output) : null,
  };
}

async function findLoggedInCodex(): Promise<CodexCliAuthStatus> {
  for (const command of getCodexCommandCandidates()) {
    const status = await getCodexLoginStatus(command);
    if (status.loggedIn) {
      return status;
    }
  }
  return { loggedIn: false, method: null };
}

export async function getCodexCliAuthStatus(): Promise<CodexCliAuthStatus> {
  return findLoggedInCodex();
}

async function isUsableCodexCommand(
  candidate: CodexCommandCandidate,
): Promise<boolean> {
  const result = await runProcess(candidate, ['--version'], {
    timeoutMs: LOGIN_STATUS_TIMEOUT_MS,
  });
  return result.exitCode === 0 && /codex/i.test(`${result.stdout}\n${result.stderr}`);
}

async function findUsableCodexCommand(): Promise<CodexCommandCandidate | null> {
  for (const candidate of getCodexCommandCandidates()) {
    if (await isUsableCodexCommand(candidate)) {
      return candidate;
    }
  }
  return null;
}

export async function startCodexChatGptSignIn(): Promise<CodexSignInResult> {
  const status = await findLoggedInCodex();
  if (hasChatGptAuth(status)) {
    return {
      ok: true,
      alreadyConnected: true,
      message: 'Your OpenAI account is already connected through Codex.',
    };
  }

  if (
    activeDeviceSignIn &&
    activeDeviceSignIn.expiresAt > Date.now() &&
    !activeDeviceSignIn.child.killed
  ) {
    return activeDeviceSignIn.result;
  }

  const candidate = await findUsableCodexCommand();
  if (!candidate) {
    return {
      ok: false,
      error: 'Codex CLI is not available.',
      message: 'Install the Codex SDK/CLI before signing in with your OpenAI account.',
    };
  }

  return new Promise((resolve) => {
    let settled = false;
    let output = '';

    const child = spawn(candidate.command, [...candidate.baseArgs, 'login', '--device-auth'], {
      cwd: process.cwd(),
      env: getCodexProcessEnv(),
      shell: shouldUseShell(candidate.command),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const finish = (result: CodexSignInResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const maybeResolveWithCode = () => {
      const deviceAuth = parseDeviceAuth(output);
      if (!deviceAuth) return;
      const result: Extract<CodexSignInResult, { ok: true }> = {
        ok: true,
        alreadyConnected: false,
        message:
          'Open the OpenAI sign-in link and enter the one-time code shown in the app.',
        deviceAuth,
      };
      activeDeviceSignIn = {
        child,
        result,
        expiresAt: deviceAuth.expiresAt,
      };
      child.once('close', () => {
        if (activeDeviceSignIn?.child === child) {
          activeDeviceSignIn = null;
        }
      });
      finish(result);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish({
        ok: false,
        error: stripAnsi(output).trim() || 'Timed out waiting for Codex sign-in.',
        message: 'Could not start OpenAI account sign-in through Codex.',
      });
    }, SIGN_IN_OUTPUT_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      maybeResolveWithCode();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      maybeResolveWithCode();
    });
    child.on('error', (error) => {
      finish({
        ok: false,
        error: error.message,
        message: 'Could not start OpenAI account sign-in through Codex.',
      });
    });
    child.on('close', (exitCode) => {
      if (settled) return;
      finish({
        ok: false,
        error:
          stripAnsi(output).trim() ||
          `Codex sign-in exited before returning a device code (exit ${exitCode ?? 'unknown'}).`,
        message: 'Could not start OpenAI account sign-in through Codex.',
      });
    });
  });
}
