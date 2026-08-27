import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, name, inject, _setOpen, installShortcut, defaultLauncherDir } from '../lib/index.js';

function mockCtx(port = 3080) {
  const disposers = [];
  return {
    get: (svc) => (svc === 'webServer' ? { port } : undefined),
    on: (ev, fn) => { if (ev === 'dispose') disposers.push(fn); },
    logger: () => ({ info: () => {}, warn: () => {} }),
    _disposers: disposers,
  };
}

test('exports the cordis plugin contract', () => {
  assert.equal(name, 'web-launcher');
  assert.deepEqual(inject, ['webRuntime']);
});

test('opens the derived loopback URL after the delay', async () => {
  let opened = null;
  _setOpen((u) => { opened = u; });
  const ctx = mockCtx(3080);
  apply(ctx, { enabled: true, delayMs: 0, shortcut: { enabled: false } });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(opened, 'http://127.0.0.1:3080');
});

test('respects a custom url config', async () => {
  let opened = null;
  _setOpen((u) => { opened = u; });
  const ctx = mockCtx(3080);
  apply(ctx, { enabled: true, delayMs: 0, url: 'https://example.com/gui', shortcut: { enabled: false } });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(opened, 'https://example.com/gui');
});

test('does nothing when disabled', async () => {
  let opened = null;
  _setOpen((u) => { opened = u; });
  const ctx = mockCtx(3080);
  apply(ctx, { enabled: false, delayMs: 0, shortcut: { enabled: false } });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(opened, null);
});

test('clears the timer on dispose', async () => {
  let opened = null;
  _setOpen((u) => { opened = u; });
  const ctx = mockCtx(3080);
  apply(ctx, { enabled: true, delayMs: 50, shortcut: { enabled: false } });
  for (const d of ctx._disposers) d();
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(opened, null);
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
      icon: 'whale-maid',
      description: 'test desc',
      shell,
    });
    assert.ok(existsSync(join(dir, 'out', 'launcher.bat')));
    assert.ok(existsSync(join(dir, 'out', 'whale-maid.ico')));
    assert.ok(info.ok);
    assert.match(psCmd, /WScript\.Shell/);
    assert.match(psCmd, /CreateShortcut\('.*TestLauncher\.lnk'\)/);
    assert.match(psCmd, /TargetPath = '.*launcher\.bat'/);
    assert.match(psCmd, /IconLocation = '.*whale-maid\.ico,0'/);
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
      icon: 'whale-maid',
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
