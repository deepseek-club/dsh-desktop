import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, name, inject, _setOpen, installShortcut, defaultLauncherDir } from '../lib/index.js';

/**
 * A plugin context with everything apply() touches.
 * `inject` is opt-in: the default mock omits it on purpose so the auto-open and
 * shortcut tests never publish a launcher URL into the real user directory.
 */
function mockCtx(port = 3080, { inject: withInject = false } = {}) {
  const disposers = [];
  const ctx = {
    get: (svc) => (svc === 'webServer' ? { port } : undefined),
    on: (ev, fn) => { if (ev === 'dispose') disposers.push(fn); },
    logger: () => ({ info: () => {}, warn: () => {} }),
    _disposers: disposers,
  };
  if (withInject) {
    ctx.inject = (deps, cb) => { cb({ connection: { authenticatedUrl: (u) => `${u}/?token=test-token` } }); };
  }
  return ctx;
}

/** Config shared by the auto-open tests: no shortcut, no background self-check. */
const quiet = { delayMs: 0, shortcut: { enabled: false }, selfcheck: false };

test('exports the cordis plugin contract', () => {
  assert.equal(name, 'dsh-desktop');
  assert.deepEqual(inject, ['webRuntime']);
});

test('opens the derived loopback URL after the delay', async () => {
  let opened = null;
  _setOpen((u) => { opened = u; });
  const ctx = mockCtx(3080);
  apply(ctx, { enabled: true, ...quiet });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(opened, 'http://127.0.0.1:3080');
});

test('respects a custom url config', async () => {
  let opened = null;
  _setOpen((u) => { opened = u; });
  const ctx = mockCtx(3080);
  apply(ctx, { enabled: true, url: 'https://example.com/gui', ...quiet });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(opened, 'https://example.com/gui');
});

test('does nothing when disabled', async () => {
  let opened = null;
  _setOpen((u) => { opened = u; });
  const ctx = mockCtx(3080);
  apply(ctx, { enabled: false, ...quiet });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(opened, null);
});

test('clears the timer on dispose', async () => {
  let opened = null;
  _setOpen((u) => { opened = u; });
  const ctx = mockCtx(3080);
  apply(ctx, { enabled: true, ...quiet, delayMs: 50 });
  for (const d of ctx._disposers) d();
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(opened, null);
});

/* -------- robustness -------- */

test('apply survives a context without inject or on', () => {
  const bare = { get: () => ({ port: 3080 }) };
  assert.doesNotThrow(() => apply(bare, { enabled: false, ...quiet }));
});

/* -------- launcher URL -------- */

test('publishes the authenticated launcher URL beside launcher.bat', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-launcher-url-'));
  try {
    const ctx = mockCtx(3080, { inject: true });
    apply(ctx, { enabled: false, selfcheck: false, shortcut: { enabled: false, launcherDir: dir } });
    const written = readFileSync(join(dir, 'web-url.txt'), 'utf8');
    assert.equal(written, 'http://127.0.0.1:3080/?token=test-token');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* -------- shortcut feature -------- */

test('installShortcut copies bat + ico and runs the PowerShell lnk command', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-launcher-test-'));
  try {
    let psCmd = null;
    const shell = (args) => { psCmd = args.join(' '); return 0; };
    const info = installShortcut({
      launcherDir: join(dir, 'out'),
      shortcutName: 'TestLauncher',
      icon: 'mascot',
      description: 'test desc',
      shell,
    });
    assert.ok(existsSync(join(dir, 'out', 'launcher.bat')));
    assert.ok(existsSync(join(dir, 'out', 'mascot.ico')));
    assert.ok(existsSync(join(dir, 'out', 'update.js')));
    assert.ok(existsSync(join(dir, 'out', 'plugin-root.txt')));
    assert.ok(info.ok);
    assert.match(psCmd, /WScript\.Shell/);
    assert.match(psCmd, /CreateShortcut\('.*TestLauncher\.lnk'\)/);
    assert.match(psCmd, /TargetPath = '.*launcher\.bat'/);
    assert.match(psCmd, /IconLocation = '.*mascot\.ico,0'/);
    assert.match(psCmd, /Description = 'test desc'/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('installShortcut reports failure when the shell runner fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-launcher-test-'));
  try {
    const info = installShortcut({
      launcherDir: join(dir, 'out'),
      shortcutName: 'TestLauncher',
      icon: 'mascot',
      description: 'x',
      shell: () => 1,
    });
    assert.equal(info.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('defaultLauncherDir is inside the user home', () => {
  const d = defaultLauncherDir();
  assert.ok(d.includes('.dsh'));
  assert.ok(d.includes('launchers'));
});
