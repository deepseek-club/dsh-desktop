/**
 * dsh-web-launcher v0.3.4 — one-click launcher plugin for the DeepSeek
 * Harness Web GUI.
 *
 * Two features:
 *  1. Auto-open: injects the `webRuntime` service (provided after the web
 *     server binds) and opens the default browser at the web URL.
 *  2. Desktop shortcut (Windows): materializes `launcher.bat` + the bundled
 *     mascot icon into a stable launcher dir and creates/updates a Desktop
 *     shortcut pointing at it — so every install gets the pretty one-click
 *     launcher with zero manual steps. On later boots it re-copies the files,
 *     so the shortcut icon auto-updates with the package.
 *
 * Config (row config from the patch):
 *   enabled:      boolean, default true          — master switch
 *   delayMs:      number,  default 500           — open delay after service ready
 *   url:          string,  default derived from the bound webServer port
 *   shortcut:     object  — desktop shortcut feature
 *     enabled:      boolean, default true (Windows only; ignored elsewhere)
 *     launcherDir:  string,  default <USERPROFILE>/.dsh/launchers
 *     shortcutName: string,  default DSH Desktop
 *     icon:         string,  default mascot (the bundled icon; an unknown name
 *                   or missing file falls back to mascot with a warning)
 *     description:  string,  default DSH Desktop — 一键启动 DeepSeek Harness
 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, isAbsolute, join } from 'node:path';

const PKG_ROOT = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.USERPROFILE || process.env.HOME || '.';

export const name = 'dsh-desktop';
export const inject = ['webRuntime'];

/* ------------------------------------------------------------------ */
/* 1. auto-open browser                                                */
/* ------------------------------------------------------------------ */

/** @type {(url: string) => void} open a URL with the platform's default browser */
export function open(url) {
  const { platform } = process;
  const argv =
    platform === 'win32' ? ['cmd', '/c', 'start', '', url]
    : platform === 'darwin' ? ['open', url]
    : ['xdg-open', url];
  try {
    const child = spawn(argv[0], argv.slice(1), { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {
    /* never fail the host because the browser could not be opened */
  }
}

/** Test hook: swap the open implementation (internal). */
let openImpl = open;
export function _setOpen(fn) { openImpl = fn; }

/* ------------------------------------------------------------------ */
/* 2. desktop shortcut (Windows)                                       */
/* ------------------------------------------------------------------ */

/** Stable directory for the materialized launcher files. */
export function defaultLauncherDir() {
  return join(HOME, '.dsh', 'launchers');
}

/** Resolve the real Desktop path (registry first, common paths as fallback). */
export function resolveDesktopDir() {
  try {
    const r = spawnSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders', '/v', 'Desktop'], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0) {
      const m = String(r.stdout).match(/Desktop\s+REG_(?:EXPAND_)?SZ\s+([^\r\n]+)/);
      if (m) {
        const p = m[1].trim().replace(/%USERPROFILE%/gi, HOME);
        if (p) return p;
      }
    }
  } catch { /* fall through */ }
  for (const cand of [join(HOME, 'Desktop'), join(HOME, 'OneDrive', 'Desktop'), join(HOME, 'OneDrive', '桌面')]) {
    if (existsSync(cand)) return cand;
  }
  return join(HOME, 'Desktop');
}

/**
 * Resolve the icon file for the shortcut. The package ships exactly one icon
 * (`mascot.ico`); any configured name that does not resolve — a removed
 * alternate icon, a typo, or a missing absolute path — gracefully falls back
 * to `mascot.ico` so a bad config can never break the shortcut install.
 * @param {string} [icon] - 'mascot' (default) or an absolute path to a .ico file.
 * @returns {{src: string, requested: string, fallback: boolean}} the resolved
 * icon source, the raw requested value, and whether a fallback was used.
 */
export function resolveIconSrc(icon) {
  const fallbackSrc = join(PKG_ROOT, '..', 'mascot.ico');
  const raw = typeof icon === 'string' ? icon.trim() : '';
  if (raw !== '') {
    const direct = isAbsolute(raw) ? raw : join(PKG_ROOT, '..', `${raw}.ico`);
    if (existsSync(direct)) return { src: direct, requested: raw, fallback: false };
  }
  return { src: fallbackSrc, requested: raw, fallback: raw !== '' && raw !== 'mascot' };
}

/**
 * Materialize launcher.bat + the chosen icon into launcherDir and create or
 * update the Desktop shortcut. Re-copying every activation is what makes the
 * icon auto-update on package updates.
 * @param {object} o
 * @param {string} o.launcherDir - target dir for bat/ico
 * @param {string} o.shortcutName - .lnk file name (without extension)
 * @param {string} o.icon - 'mascot' (default) or an absolute .ico path
 * @param {string} o.description - shortcut tooltip
 * @param {(args: string[]) => number} [o.shell] - command runner returning exit code (test hook)
 * @returns {{lnkPath: string, batDst: string, icoDst: string, ok: boolean, iconFallback: boolean}}
 */
export function installShortcut({ launcherDir, shortcutName, icon, description, shell }) {
  const run = shell ?? ((args) => {
    const r = spawnSync('powershell', args, { stdio: 'ignore', windowsHide: true });
    return r.status ?? 1;
  });

  mkdirSync(launcherDir, { recursive: true });
  const batDst = join(launcherDir, 'launcher.bat');
  const { src: icoSrc, fallback: iconFallback } = resolveIconSrc(icon);
  const icoDst = join(launcherDir, basename(icoSrc));
  copyFileSync(join(PKG_ROOT, '..', 'launcher.bat'), batDst);
  copyFileSync(icoSrc, icoDst);

  const desktop = resolveDesktopDir();
  const lnkPath = join(desktop, `${shortcutName}.lnk`);
  const esc = (s) => String(s).replace(/'/g, "''");
  const ps = [
    `$ws = New-Object -ComObject WScript.Shell`,
    `$s = $ws.CreateShortcut('${esc(lnkPath)}')`,
    `$s.TargetPath = '${esc(batDst)}'`,
    `$s.IconLocation = '${esc(icoDst)},0'`,
    `$s.Description = '${esc(description)}'`,
    `$s.WorkingDirectory = '${esc(launcherDir)}'`,
    `$s.Save()`,
  ].join('; ');
  const ok = run(['-NoProfile', '-Command', ps]) === 0;
  return { lnkPath, batDst, icoDst, ok, iconFallback, requested: icon ?? 'mascot' };
}

/* ------------------------------------------------------------------ */
/* plugin entrypoint                                                   */
/* ------------------------------------------------------------------ */

export function apply(ctx, config = {}) {
  const { enabled = true, delayMs = 500, url } = config;
  const shortcutCfg = config.shortcut ?? {};

  // 1) auto-open browser
  if (enabled) {
    const port = ctx.get('webServer')?.port;
    const target = url ?? (port === void 0 ? undefined : `http://127.0.0.1:${String(port)}`);
    if (target !== void 0) {
      const timer = setTimeout(() => {
        openImpl(target);
        ctx.logger?.('web-launcher').info?.(`opened browser: ${target}`);
      }, delayMs);
      ctx.on('dispose', () => clearTimeout(timer));
    }
  }

  // 2) desktop shortcut (Windows only)
  if (shortcutCfg.enabled !== false && process.platform === 'win32') {
    try {
      const info = installShortcut({
        launcherDir: shortcutCfg.launcherDir ?? defaultLauncherDir(),
        shortcutName: shortcutCfg.shortcutName ?? 'DSH Desktop',
        icon: shortcutCfg.icon ?? 'mascot',
        description: shortcutCfg.description ?? 'DSH Desktop — 一键启动 DeepSeek Harness',
      });
      if (info.iconFallback) {
        ctx.logger?.('web-launcher').warn?.(`configured shortcut icon "${info.requested}" not found — fell back to mascot.ico`);
      }
      ctx.logger?.('web-launcher').info?.(info.ok
        ? `desktop shortcut ready: ${info.lnkPath}`
        : `desktop shortcut creation failed: ${info.lnkPath}`);
    } catch (e) {
      ctx.logger?.('web-launcher').warn?.(`shortcut install failed: ${e?.message ?? e}`);
    }
  }
}

export default { apply, inject, name, open };
