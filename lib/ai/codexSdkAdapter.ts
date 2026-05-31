import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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

function getCodexCommandCandidates(): string[] {
  const candidates: string[] = [];
  const add = (candidate: string | undefined) => {
    const value = candidate?.trim();
    if (value && !candidates.includes(value)) {
      candidates.push(value);
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

  add('codex');
  return candidates;
}

function shouldUseShell(command: string): boolean {
  return process.platform === 'win32' && !command.toLowerCase().endsWith('.exe');
}

function runProcess(
  command: string,
  args: string[],
  { timeoutMs }: RunProcessOptions,
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      shell: shouldUseShell(command),
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

async function getCodexLoginStatus(command: string): Promise<CodexCliAuthStatus> {
  const result = await runProcess(command, ['login', 'status'], {
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

async function isUsableCodexCommand(command: string): Promise<boolean> {
  const result = await runProcess(command, ['--version'], {
    timeoutMs: LOGIN_STATUS_TIMEOUT_MS,
  });
  return result.exitCode === 0 && /codex/i.test(`${result.stdout}\n${result.stderr}`);
}

async function findUsableCodexCommand(): Promise<string | null> {
  for (const command of getCodexCommandCandidates()) {
    if (await isUsableCodexCommand(command)) {
      return command;
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

  const command = await findUsableCodexCommand();
  if (!command) {
    return {
      ok: false,
      error: 'Codex CLI is not available.',
      message: 'Install the Codex SDK/CLI before signing in with your OpenAI account.',
    };
  }

  return new Promise((resolve) => {
    let settled = false;
    let output = '';

    const child = spawn(command, ['login', '--device-auth'], {
      cwd: process.cwd(),
      env: process.env,
      shell: shouldUseShell(command),
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
