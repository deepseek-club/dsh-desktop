/**
 * dsh-desktop update check.
 *
 * Compares this plugin and the running Harness against their upstream sources,
 * tells the user when something newer exists, and — only if the user says yes —
 * installs it. Detection is local-first and read-only; nothing here may ever
 * block or break the launcher, so every failure path is caught and reported.
 *
 * Sources of truth:
 *   - plugin  -> github.com/deepseek-club/dsh-desktop (package.json on main)
 *   - harness -> registry.npmjs.org/@deepseek-ai/dsh (latest, plus next when
 *                the installed Harness is itself a prerelease)
 *
 * Usage:
 *   node update.js check             report only; exit 0 when an update exists
 *   node update.js ask               report, then prompt Y/N (used by launcher.bat)
 *   node update.js apply plugin      install the plugin update
 *   node update.js apply harness     install the Harness update
 *   add --force to skip the throttle, --timeout <seconds> for the prompt
 *
 * @module @deepseek-club/dsh-desktop/update
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HOME = process.env.USERPROFILE || process.env.HOME || '.';
const REPO = 'deepseek-club/dsh-desktop';
const NPM_PACKAGE = '@deepseek-ai/dsh';
const STATE_NAME = 'dsh-desktop-update.json';
const NETWORK_TIMEOUT_MS = 12_000;
const THROTTLE_HOURS = 6;
/** Files the user is expected to customise; an update must never clobber them. */
const PRESERVED = new Set(['launcher.bat', 'mascot.ico']);
/** Files an update replaces. */
const UPDATED = ['lib', 'cordis.patch.yml', 'package.json', 'README.md', 'LICENSE', '.gitignore', 'tests'];

/** Stable directory for the materialized launcher files. */
export function defaultLauncherDir() {
  return join(HOME, '.dsh', 'launchers');
}

/**
 * Locate the installed plugin directory.
 *
 * update.js runs either from `<plugin>/lib` (development) or from the launcher
 * directory (installed copy), where the plugin records its root.
 * @param {string} [launcherDir] - directory holding launcher.bat.
 * @returns {string|undefined} the plugin root, when it can be determined.
 */
export function pluginDir(launcherDir = defaultLauncherDir()) {
  const here = dirname(fileURLToPath(import.meta.url));
  if (basename(here) === 'lib') return dirname(here);
  try {
    const recorded = readFileSync(join(here, 'plugin-root.txt'), 'utf8').trim();
    if (recorded !== '' && existsSync(recorded)) return recorded;
  } catch { /* fall through */ }
  try {
    const recorded = readFileSync(join(launcherDir, 'plugin-root.txt'), 'utf8').trim();
    if (recorded !== '' && existsSync(recorded)) return recorded;
  } catch { /* fall through */ }
  return undefined;
}

/** Read a package.json version, or undefined. */
function versionOf(file) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'))?.version;
    return typeof value === 'string' ? value : undefined;
  } catch { return undefined; }
}

/**
 * Compare two dotted versions, prereleases sorting below their release.
 * @returns {number} negative when a < b, 0 when equal, positive when a > b.
 */
export function compareVersions(a, b) {
  const split = (v) => {
    const [core, pre = ''] = String(v).split('-');
    return { parts: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const left = split(a);
  const right = split(b);
  for (let i = 0; i < Math.max(left.parts.length, right.parts.length); i += 1) {
    const diff = (left.parts[i] ?? 0) - (right.parts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (left.pre === right.pre) return 0;
  if (left.pre === '') return 1;
  if (right.pre === '') return -1;
  return left.pre < right.pre ? -1 : 1;
}

/** Fetch JSON with a hard timeout; throws on a non-OK response. */
async function getJson(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'dsh-desktop-update-check' },
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Read the Harness package that is installed globally. */
function installedHarness() {
  const candidates = [];
  const entry = process.argv[1];
  if (typeof entry === 'string' && /[\\/]lib[\\/]bin\.js$/u.test(entry)) candidates.push(join(dirname(entry), '..'));
  const npmRoot = process.env.APPDATA === undefined ? undefined : join(process.env.APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh');
  if (npmRoot !== undefined) candidates.push(npmRoot);
  for (const root of candidates) {
    const version = versionOf(join(root, 'package.json'));
    if (version !== undefined) return { root, version };
  }
  return {};
}

/**
 * Check both upstreams. Never throws: an unreachable source is reported as such.
 * @returns {Promise<{plugin: object, harness: object, updates: string[]}>}
 */
export async function checkAll() {
  const dir = pluginDir();
  const plugin = { local: dir === undefined ? undefined : versionOf(join(dir, 'package.json')) };
  try {
    const meta = await getJson(`https://api.github.com/repos/${REPO}/contents/package.json?ref=main`);
    const remote = JSON.parse(Buffer.from(meta.content, 'base64').toString('utf8'));
    plugin.remote = remote.version;
    plugin.source = `github.com/${REPO}`;
  } catch (e) {
    plugin.error = e?.message ?? String(e);
  }
  plugin.hasUpdate = typeof plugin.local === 'string' && typeof plugin.remote === 'string'
    && compareVersions(plugin.remote, plugin.local) > 0;

  const harness = installedHarness();
  try {
    const registry = await getJson(`https://registry.npmjs.org/${NPM_PACKAGE.replace('/', '%2F')}`);
    const tags = registry['dist-tags'] ?? {};
    let remote = tags.latest;
    // A Harness already on a prerelease follows that channel rather than stable.
    if (typeof harness.version === 'string' && harness.version.includes('-') && typeof tags.next === 'string') {
      remote = typeof remote === 'string' && compareVersions(tags.next, remote) > 0 ? tags.next : remote;
    }
    harness.remote = remote;
    harness.source = `npm ${NPM_PACKAGE}`;
  } catch (e) {
    harness.error = e?.message ?? String(e);
  }
  harness.hasUpdate = typeof harness.version === 'string' && typeof harness.remote === 'string'
    && compareVersions(harness.remote, harness.version) > 0;

  const updates = [];
  if (plugin.hasUpdate) updates.push('plugin');
  if (harness.hasUpdate) updates.push('harness');
  return { plugin, harness, updates };
}

/** Throttle state so a double-click does not hit the network every time. */
function readState() {
  try { return JSON.parse(readFileSync(join(defaultLauncherDir(), STATE_NAME), 'utf8')); } catch { return {}; }
}

function writeState(state) {
  try {
    mkdirSync(defaultLauncherDir(), { recursive: true });
    writeFileSync(join(defaultLauncherDir(), STATE_NAME), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  } catch { /* state is a convenience, not a requirement */ }
}

/** True when the Web server is serving on the given port. */
function serverRunning(port = 3080) {
  // netstat + findstr keeps this dependency-free on Windows.
  try {
    const out = execFileSync('cmd', ['/c', `netstat -ano | findstr /c:":${port} " | findstr /c:"LISTENING"`], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim() !== '';
  } catch { return false; }
}

/** Download the repository archive and extract it to a temporary directory. */
async function downloadRepo(tmpDir) {
  const url = `https://codeload.github.com/${REPO}/zip/refs/heads/main`;
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`GitHub archive returned HTTP ${res.status}`);
  const zip = join(tmpDir, 'plugin.zip');
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${tmpDir}' -Force`],
  { stdio: 'ignore', windowsHide: true });
  const root = join(tmpDir, `dsh-desktop-main`);
  if (!existsSync(root)) throw new Error('the downloaded archive had no dsh-desktop-main directory');
  return root;
}

/**
 * Install the plugin update.
 *
 * Code files are replaced; launcher.bat and the icon are the user's own and are
 * kept. Everything is backed up first so the swap is reversible.
 */
export async function applyPluginUpdate() {
  const dir = pluginDir();
  if (dir === undefined) throw new Error('could not locate the installed plugin directory');
  const tmpDir = join(HOME, '.dsh', 'update-tmp');
  rmSync(tmpDir, { recursive: true, force: true });
  const source = await downloadRepo(tmpDir);

  const backup = join(HOME, '.dsh', 'launchers', `backup-${new Date().toISOString().replace(/[:.]/gu, '-')}`);
  mkdirSync(backup, { recursive: true });
  const replaced = [];
  const preserved = [];
  for (const name of UPDATED) {
    const from = join(source, name);
    if (!existsSync(from)) continue;
    const to = join(dir, name);
    if (existsSync(to)) cpSync(to, join(backup, name), { recursive: true });
    cpSync(from, to, { recursive: true, force: true });
    replaced.push(name);
  }
  for (const name of PRESERVED) if (existsSync(join(dir, name))) preserved.push(name);
  rmSync(tmpDir, { recursive: true, force: true });
  return { dir, backup, replaced, preserved, version: versionOf(join(dir, 'package.json')) };
}

/** Install the Harness update through npm. */
export function applyHarnessUpdate() {
  if (serverRunning()) throw new Error('the Harness is running; close the "DeepSeek Harness Server" window first');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const out = execFileSync(npm, ['install', '-g', `${NPM_PACKAGE}@latest`], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  return { output: String(out).trim(), version: installedHarness().version };
}

/** Print the check result in a shape a person reads in a console. */
export function describe(result) {
  const lines = [];
  const row = (label, item) => {
    const local = item.local ?? item.version ?? 'unknown';
    if (item.error !== undefined) return `${label}: check failed (${item.error})`;
    if (item.remote === undefined) return `${label}: local ${local} (no upstream version found)`;
    const flag = item.hasUpdate ? 'UPDATE AVAILABLE' : 'up to date';
    return `${label}: local ${local} -> upstream ${item.remote} (${flag})`;
  };
  lines.push(row('plugin ', result.plugin));
  lines.push(row('harness', result.harness));
  return lines;
}

/** Prompt Y/N with a timeout; anything but y/Y is a no. */
function askYesNo(question, seconds) {
  return new Promise((resolveAnswer) => {
    process.stdout.write(`${question} [y/N] `);
    const stdin = process.stdin;
    if (stdin.isTTY !== true) { process.stdout.write('\n'); resolveAnswer(false); return; }
    stdin.setRawMode?.(true);
    stdin.resume();
    const done = (answer) => {
      clearTimeout(timer);
      stdin.setRawMode?.(false);
      stdin.pause();
      process.stdout.write(`\n`);
      resolveAnswer(answer);
    };
    const timer = setTimeout(() => { process.stdout.write(`\n(no answer in ${seconds}s - keeping the current version)\n`); done(false); }, seconds * 1000);
    stdin.once('data', (chunk) => {
      const key = String(chunk).trim().toLowerCase();
      done(key === 'y' || key === 'yes');
    });
  });
}

/** Entry point used by launcher.bat. */
async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0] ?? 'check';
  const force = argv.includes('--force');
  const timeoutIndex = argv.indexOf('--timeout');
  const promptSeconds = timeoutIndex === -1 ? 20 : Number.parseInt(argv[timeoutIndex + 1] ?? '20', 10) || 20;

  if (command === 'apply') {
    const what = argv[1];
    if (what === 'plugin') {
      const info = await applyPluginUpdate();
      console.log(`plugin updated to ${info.version ?? 'a newer version'} (backup: ${info.backup})`);
      if (info.preserved.length > 0) console.log(`kept your own: ${info.preserved.join(', ')}`);
      return 0;
    }
    if (what === 'harness') {
      const info = applyHarnessUpdate();
      console.log(`Harness updated to ${info.version ?? 'a newer version'}`);
      return 0;
    }
    console.log('usage: update.js apply <plugin|harness>');
    return 2;
  }

  const state = readState();
  const lastCheck = Date.parse(state.checkedAt ?? '');
  const fresh = Number.isFinite(lastCheck) && (Date.now() - lastCheck) < THROTTLE_HOURS * 3_600_000;
  if (fresh && !force) {
    if (command === 'check') console.log('update check skipped (checked recently)');
    return 1;
  }

  let result;
  try {
    result = await checkAll();
  } catch (e) {
    console.log(`update check could not run: ${e?.message ?? e}`);
    return 2;
  }
  writeState({ checkedAt: new Date().toISOString(), plugin: result.plugin, harness: result.harness });

  for (const line of describe(result)) console.log(line);
  if (result.updates.length === 0) { console.log('no updates available'); return 1; }
  if (command === 'check') return 0;

  for (const what of result.updates) {
    const yes = await askYesNo(`Update the ${what} now?`, promptSeconds);
    if (!yes) { console.log(`keeping the current ${what}`); continue; }
    try {
      if (what === 'plugin') {
        const info = await applyPluginUpdate();
        console.log(`plugin updated to ${info.version ?? 'a newer version'}`);
        if (info.preserved.length > 0) console.log(`kept your own: ${info.preserved.join(', ')}`);
      } else {
        const info = applyHarnessUpdate();
        console.log(`Harness updated to ${info.version ?? 'a newer version'}`);
        console.log('close and reopen the launcher to use it');
      }
    } catch (e) {
      console.log(`could not update the ${what}: ${e?.message ?? e}`);
    }
  }
  return 0;
}

const invokedDirectly = typeof process.argv[1] === 'string' && /update\.js$/u.test(process.argv[1]);
if (invokedDirectly) {
  try {
    process.exitCode = await main();
  } catch (e) {
    console.log(`update check failed: ${e?.message ?? e}`);
    process.exitCode = 2;
  }
}
