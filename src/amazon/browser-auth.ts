import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { spawn, type ChildProcess } from 'child_process';
import { createServer } from 'net';
import { dirname, join } from 'path';
import { setTimeout as delay } from 'timers/promises';
import {
  getAmazonBrowserProfileDir,
  getAmazonOrdersCookieJarPath,
  getAmazonSignInUrl,
} from './client.js';

interface DevToolsTarget {
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

interface CDPCookie {
  name: string;
  value: string;
  domain: string;
}

interface CDPResult<T> {
  id?: number;
  result?: T;
  error?: { message?: string };
}

const MAC_BROWSER_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

const LINUX_BROWSER_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/brave-browser',
  '/snap/bin/chromium',
];

function browserCandidates(): string[] {
  if (process.platform === 'darwin') return MAC_BROWSER_CANDIDATES;
  if (process.platform === 'linux') return LINUX_BROWSER_CANDIDATES;
  return [];
}

export function findBrowserExecutable(): string {
  const envOverride = process.env.AMAZON_BROWSER;
  if (envOverride) {
    if (existsSync(envOverride)) return envOverride;
    throw new Error(`AMAZON_BROWSER is set but does not exist: ${envOverride}`);
  }

  const match = browserCandidates().find((c) => existsSync(c));
  if (match) return match;

  throw new Error(
    'No supported Chromium-based browser was found. Install Chrome/Chromium/Brave, or set AMAZON_BROWSER to the browser executable path.'
  );
}

async function allocatePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to allocate a local debugging port.'));
        return;
      }
      const { port } = address;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

async function fetchTargets(port: number): Promise<DevToolsTarget[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error(`DevTools endpoint returned ${response.status}`);
  return (await response.json()) as DevToolsTarget[];
}

async function waitForTargetWebSocketUrl(
  port: number,
  browserProcess: ChildProcess,
  timeoutMs: number
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    if (browserProcess.exitCode !== null) {
      throw new Error('Browser exited before the remote debugging endpoint became available.');
    }
    try {
      const targets = await fetchTargets(port);
      const target =
        targets.find((t) => t.type === 'page' && t.url.includes('amazon.com')) ??
        targets.find((t) => t.type === 'page');
      if (target?.webSocketDebuggerUrl) return target.webSocketDebuggerUrl;
    } catch (err) {
      lastError = err;
    }
    await delay(250);
  }

  throw new Error(
    `Timed out waiting for browser debugging endpoint: ${lastError instanceof Error ? lastError.message : 'unknown error'}`
  );
}

function messageDataToString(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data))
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  throw new Error('Received an unsupported WebSocket message payload type.');
}

class CDPSession {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  private constructor(private readonly socket: WebSocket) {
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(messageDataToString(event.data)) as CDPResult<unknown>;
      if (typeof message.id !== 'number') return;

      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);

      if (message.error?.message) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    });

    const rejectAll = (reason: string) => {
      for (const { reject } of this.pending.values()) reject(new Error(reason));
      this.pending.clear();
    };
    this.socket.addEventListener('close', () => rejectAll('Browser debugging session closed.'));
    this.socket.addEventListener('error', () => rejectAll('Browser debugging session errored.'));
  }

  static async connect(url: string): Promise<CDPSession> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener(
        'error',
        () => reject(new Error('Failed to connect to browser debugging session.')),
        { once: true }
      );
    });
    return new CDPSession(socket);
  }

  async send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    return await new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.socket.close();
  }
}

async function waitForAuthenticatedCookies(
  session: CDPSession,
  browserProcess: ChildProcess,
  timeoutMs: number
): Promise<Record<string, string>> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (browserProcess.exitCode !== null)
      throw new Error('Browser was closed before an authenticated Amazon session was detected.');

    const { cookies } = await session.send<{ cookies: CDPCookie[] }>('Network.getAllCookies');
    const amazonCookies = cookies
      .filter((c) => c.domain.includes('amazon.com') && c.value)
      .sort((a, b) => a.domain.length - b.domain.length);

    if (amazonCookies.some((c) => c.name === 'x-main')) {
      return Object.fromEntries(amazonCookies.map((c) => [c.name, c.value]));
    }
    await delay(1000);
  }

  throw new Error(
    'Timed out waiting for an authenticated Amazon session. Complete sign-in in the browser window and leave it open until the terminal reports success.'
  );
}

async function stopBrowser(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null) return;
  proc.kill('SIGTERM');
  const deadline = Date.now() + 5000;
  while (proc.exitCode === null && Date.now() < deadline) await delay(100);
  if (proc.exitCode === null) proc.kill('SIGKILL');
}

// Opens a real browser, waits for the user to complete Amazon login, then
// saves the resulting cookies to the amazon-orders cookie jar so subsequent
// `amazon-sync` runs use a pre-authenticated session.
export async function bootstrapAmazonSessionInBrowser(): Promise<string> {
  const executablePath = findBrowserExecutable();
  const port = await allocatePort();
  const profileDir = getAmazonBrowserProfileDir();
  const cookieJarPath = getAmazonOrdersCookieJarPath();

  mkdirSync(profileDir, { recursive: true });
  mkdirSync(dirname(cookieJarPath), { recursive: true });

  const browserProcess = spawn(
    executablePath,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--new-window',
      '--no-first-run',
      '--no-default-browser-check',
      getAmazonSignInUrl(),
    ],
    { stdio: 'ignore' }
  );

  let session: CDPSession | null = null;
  try {
    const wsUrl = await waitForTargetWebSocketUrl(port, browserProcess, 30_000);
    session = await CDPSession.connect(wsUrl);
    await session.send('Network.enable');

    const cookieJar = await waitForAuthenticatedCookies(session, browserProcess, 10 * 60 * 1000);
    writeFileSync(cookieJarPath, JSON.stringify(cookieJar));
    return cookieJarPath;
  } finally {
    session?.close();
    await stopBrowser(browserProcess);
  }
}
