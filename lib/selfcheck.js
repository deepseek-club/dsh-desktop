/**
 * dsh-desktop compatibility self-check.
 *
 * The launcher plugin leans on a handful of Harness interfaces. A Harness
 * update can move one of them and break the desktop shortcut silently, so this
 * module probes them on every boot and writes a readable report next to
 * launcher.bat. It also remembers the Harness version it last saw, so a Harness
 * update is reported explicitly instead of being discovered through a 401 page.
 *
 * Nothing in here may throw: a failed probe is data, not an error, and this
 * module must never disturb the host Harness or the launcher.
 *
 * @module @deepseek-club/dsh-desktop/selfcheck
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.USERPROFILE || process.env.HOME || '.';
const REPORT_NAME = 'dsh-desktop-selfcheck.txt';
const STATE_NAME = 'dsh-desktop-selfcheck.json';

/** Stable directory for the materialized launcher files. */
export function defaultLauncherDir() {
  return join(HOME, '.dsh', 'launchers');
}

/**
 * Resolve the Harness package that is running this plugin.
 *
 * `dsh web` boots `<npm root>/@deepseek-ai/dsh/lib/bin.js`, so the package root
 * sits one level above the entry script's directory.
 * @returns {{name?: string, version?: string, root?: string}} what was found, or an empty object.
 */
export function runningHarness() {
  const entry = process.argv[1];
  if (typeof entry !== 'string' || entry === '') return {};
  try {
    const root = join(dirname(entry), '..');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    if (typeof pkg?.name === 'string' && typeof pkg?.version === 'string'
      && (pkg.name === 'dsh' || pkg.name.endsWith('/dsh'))) {
      return { name: pkg.name, version: pkg.version, root };
    }
  } catch { /* the entry may not sit inside a package root */ }
  return {};
}

/** Read one service without letting a hostile getter break the whole check. */
function service(ctx, key) {
  try { return ctx?.get?.(key); } catch { return undefined; }
}

/**
 * Probe every interface the launcher plugin depends on.
 * @param {object} [ctx] - plugin context, or undefined for a standalone run.
 * @param {object} [config] - row config carrying shortcut.launcherDir.
 * @returns {{dir: string, harness: object, checks: {id: string, state: string, detail: string}[]}}
 */
export function collect(ctx, config = {}) {
  const dir = config?.shortcut?.launcherDir ?? defaultLauncherDir();
  const harness = runningHarness();
  const standalone = ctx === undefined;
  const checks = [];
  const record = (id, state, detail) => { checks.push({ id, state, detail }); };

  record('harness', harness.version === undefined ? 'unknown' : 'ok',
    harness.version === undefined ? 'could not read the running Harness version'
      : `${harness.name} ${harness.version}`);

  const port = service(ctx, 'webServer')?.port;
  record('webServer.port',
    standalone ? 'n/a' : (typeof port === 'number' ? 'ok' : 'missing'),
    standalone ? 'standalone run: no running Harness context'
      : (typeof port === 'number' ? `127.0.0.1:${port}` : 'not a number; the plugin cannot build a browser URL'));

  const connection = service(ctx, 'connection');
  const authenticated = typeof connection?.authenticatedUrl === 'function';
  record('connection.authenticatedUrl',
    standalone ? 'n/a' : (authenticated ? 'ok' : 'absent'),
    standalone ? 'standalone run: no running Harness context'
      : (authenticated ? 'tokenised URL is published for the shortcut'
        : 'absent; the shortcut falls back to the bare origin (expected on a Harness without token auth)'));

  // The materialized launcher files only exist when the shortcut feature runs
  // on Windows; anywhere else their absence is expected, not a failure.
  const wantsShortcut = config?.shortcut?.enabled !== false && process.platform === 'win32';
  const fileState = (name) => (wantsShortcut ? (existsSync(join(dir, name)) ? 'ok' : 'missing') : 'n/a');
  const fileDetail = (name) => (wantsShortcut ? join(dir, name) : 'desktop shortcut feature is off here');
  record('launcher.bat', fileState('launcher.bat'), fileDetail('launcher.bat'));
  record('mascot.ico', fileState('mascot.ico'), fileDetail('mascot.ico'));

  return { dir, harness, checks };
}

/**
 * Decide the report status.
 *
 * A missing interface needs attention; a Harness version change is reported so
 * the shortcut can be re-verified; everything else is fine.
 * @param {string|undefined} previousVersion - Harness version seen on the last run.
 * @param {{harness: object, checks: object[]}} current - freshly collected probes.
 * @returns {{status: string, broken: object[]}}
 */
export function evaluate(previousVersion, current) {
  const broken = current.checks.filter((c) => c.state === 'missing');
  if (broken.length > 0) return { status: 'NEEDS-ATTENTION', broken };
  const changed = previousVersion !== undefined
    && current.harness.version !== undefined
    && previousVersion !== current.harness.version;
  return { status: changed ? 'HARNESS-UPDATED' : 'OK', broken };
}

/** Render the human-readable report the launcher and the user read. */
function formatReport(status, current, previousVersion) {
  const lines = ['dsh-desktop self-check'];
  lines.push(`CHECKED: ${new Date().toISOString()}`);
  lines.push(`STATUS: ${status}`);
  lines.push('');
  if (status === 'HARNESS-UPDATED') {
    lines.push(`The Harness changed since the last check: ${previousVersion} -> ${current.harness.version}`);
    lines.push('Re-verify that the desktop shortcut still opens the UI.');
    lines.push('');
  }
  if (status === 'NEEDS-ATTENTION') {
    lines.push('Interfaces the launcher needs are missing:');
    for (const c of current.checks.filter((c) => c.state === 'missing')) lines.push(`  - ${c.id}: ${c.detail}`);
    lines.push('');
  }
  lines.push('interface                     state    detail');
  for (const c of current.checks) lines.push(`${c.id.padEnd(29)} ${c.state.padEnd(8)} ${c.detail}`);
  return `${lines.join('\n')}\n`;
}

/**
 * Run the check, write the report and the state record, and log one summary line.
 * @param {object} [ctx] - plugin context, or undefined for a standalone run.
 * @param {object} [config] - row config.
 * @returns {string} the status that was written.
 */
export function runSelfCheck(ctx, config = {}) {
  try {
    const current = collect(ctx, config);
    const statePath = join(current.dir, STATE_NAME);
    let previousVersion;
    try {
      previousVersion = JSON.parse(readFileSync(statePath, 'utf8'))?.harnessVersion;
    } catch { previousVersion = undefined; }

    const { status } = evaluate(previousVersion, current);
    mkdirSync(current.dir, { recursive: true });
    writeFileSync(join(current.dir, REPORT_NAME), formatReport(status, current, previousVersion), 'utf8');
    writeFileSync(statePath, `${JSON.stringify({
      harnessVersion: current.harness.version,
      status,
      checkedAt: new Date().toISOString(),
    }, null, 2)}\n`, 'utf8');

    const summary = `self-check ${status}: harness ${current.harness.version ?? 'unknown'}`;
    const log = ctx?.logger?.('web-launcher');
    if (status === 'OK') log?.info?.(summary);
    else log?.warn?.(summary);
    return status;
  } catch (e) {
    try { ctx?.logger?.('web-launcher')?.warn?.(`self-check failed: ${e?.message ?? e}`); } catch { /* ignore */ }
    return 'ERROR';
  }
}

/* Standalone entry: `node lib/selfcheck.js` reports without a running Harness. */
if (typeof process.argv[1] === 'string' && /selfcheck\.js$/u.test(process.argv[1])) {
  const status = runSelfCheck(undefined, {});
  console.log(`dsh-desktop self-check: ${status}`);
  console.log(join(defaultLauncherDir(), REPORT_NAME));
}
