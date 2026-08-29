import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gateScript = path.join(repoRoot, 'scripts', 'dsh-release-gate.mjs');

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createFixture(root, overrides = {}) {
  const packageDir = path.join(root, overrides.directory ?? 'plugin');
  mkdirSync(packageDir, { recursive: true });

  const manifest = {
    name: 'fixture-dsh-plugin',
    version: '1.0.0',
    private: true,
    type: 'module',
    main: 'index.js',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    files: ['index.js', 'cordis.patch.yml'],
    ...overrides.manifest,
  };

  writeJson(path.join(packageDir, 'package.json'), manifest);
  writeFileSync(path.join(packageDir, 'index.js'), 'export default function fixture() {}\n');
  writeFileSync(path.join(packageDir, 'cordis.patch.yml'), "- insert:\n    - id: fixture-dsh-plugin\n      name: 'fixture-dsh-plugin'\n");
  return { packageDir, manifest };
}

function installFakePnpm(root) {
  const binDir = path.join(root, 'bin');
  mkdirSync(binDir, { recursive: true });
  const executable = path.join(binDir, 'pnpm');
  writeFileSync(
    executable,
    `#!/usr/bin/env node
const { appendFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const argv = process.argv.slice(2);
if (process.env.FAKE_PNPM_LOG) {
  appendFileSync(process.env.FAKE_PNPM_LOG, JSON.stringify({ argv, cwd: process.cwd(), dshHome: process.env.DSH_HOME ?? null }) + '\\n');
}

function finish(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

if (argv[0] === 'run') {
  finish(spawnSync('npm', ['run', argv[1], '--silent'], { cwd: process.cwd(), encoding: 'utf8' }));
}

if (argv[0] === 'pack') {
  const destinationIndex = argv.indexOf('--pack-destination');
  const destination = argv[destinationIndex + 1];
  finish(spawnSync('npm', ['pack', '--json', '--pack-destination', destination], { cwd: process.cwd(), encoding: 'utf8' }));
}

if (argv[0] === 'dlx') {
  const command = argv.slice(2);
  if (command[0] === 'plugin') {
    if (process.env.FAKE_DSH_INSTALL_FAIL === '1') {
      process.stderr.write('synthetic install failure\\n');
      process.exit(19);
    }
    const profileIndex = command.indexOf('--profile');
    const profile = command[profileIndex + 1];
    const tarball = command.at(-1);
    const extracted = spawnSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' });
    if (extracted.status !== 0) finish(extracted);
    const manifest = JSON.parse(extracted.stdout);
    const profileDir = path.join(process.env.DSH_HOME, 'profiles', profile);
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({
      name: 'fake-dsh-profile',
      private: true,
      dependencies: { [manifest.name]: 'file:' + tarball },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', manifest.name] } },
    }, null, 2));
    process.exit(0);
  }

  const profileIndex = command.indexOf('--profile');
  if (profileIndex !== -1 && command.includes('--dump-config')) {
    if (process.env.FAKE_DSH_DUMP_FAIL === '1') {
      process.stderr.write('synthetic dump failure\\n');
      process.exit(23);
    }
    const profile = command[profileIndex + 1];
    const profileManifest = require(path.join(process.env.DSH_HOME, 'profiles', profile, 'package.json'));
    const bundle = profileManifest.dsh.profile.bundles.at(-1);
    if (process.env.FAKE_DSH_OMIT_PROVENANCE === '1') {
      process.stdout.write('# == @deepseek-ai/dsh-base\\n- id: base\\n');
    } else {
      process.stdout.write('# == ' + bundle + '\\n- id: fixture-dsh-plugin\\n  name: ' + JSON.stringify(bundle) + '\\n');
    }
    process.exit(0);
  }
}

process.stderr.write('unexpected fake pnpm invocation: ' + JSON.stringify(argv) + '\\n');
process.exit(97);
`,
  );
  chmodSync(executable, 0o755);
  return binDir;
}

function runGate(root, packageDir, { args = [], env = {} } = {}) {
  const logPath = path.join(root, 'pnpm.log');
  const callerHome = path.join(root, 'caller-dsh-home');
  mkdirSync(callerHome, { recursive: true });
  writeFileSync(path.join(callerHome, 'sentinel.txt'), 'unchanged');
  const binDir = installFakePnpm(root);

  const result = spawnSync(process.execPath, [gateScript, packageDir, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      DSH_HOME: callerHome,
      FAKE_PNPM_LOG: logPath,
      ...env,
    },
    encoding: 'utf8',
  });

  let invocations = [];
  try {
    invocations = readFileSync(logPath, 'utf8')
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    invocations = [];
  }

  return { result, invocations, callerHome };
}

function withTemp(t, fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-release-gate-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return fn(root);
}

test('valid private bundle runs optional checks, packs, installs the tarball, and composes in an isolated DSH home', (t) =>
  withTemp(t, (root) => {
    const { packageDir } = createFixture(root, {
      manifest: {
        scripts: {
          build: "node -e \"require('node:fs').writeFileSync('build.marker','ok')\"",
          test: "node -e \"require('node:fs').writeFileSync('test.marker','ok')\"",
        },
      },
    });

    const { result, invocations, callerHome } = runGate(root, packageDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PASS package=fixture-dsh-plugin baseline=@deepseek-ai\/dsh@0\.1\.1-rc\.2/);
    assert.equal(readFileSync(path.join(packageDir, 'build.marker'), 'utf8'), 'ok');
    assert.equal(readFileSync(path.join(packageDir, 'test.marker'), 'utf8'), 'ok');
    assert.equal(readFileSync(path.join(callerHome, 'sentinel.txt'), 'utf8'), 'unchanged');

    assert.deepEqual(invocations.slice(0, 3).map(({ argv }) => argv.slice(0, 2)), [
      ['run', 'build'],
      ['run', 'test'],
      ['pack', '--pack-destination'],
    ]);

    const install = invocations.find(({ argv }) => argv.includes('plugin'));
    assert.ok(install, 'expected native DSH plugin invocation');
    assert.equal(install.argv[0], 'dlx');
    assert.equal(install.argv[1], '@deepseek-ai/dsh@0.1.1-rc.2');
    assert.ok(install.argv.includes('-w'));
    assert.match(install.argv.at(-1), /\.tgz$/);
    assert.notEqual(install.argv.at(-1), packageDir);
    assert.notEqual(install.dshHome, callerHome);

    const dump = invocations.find(({ argv }) => argv.includes('--dump-config'));
    assert.ok(dump, 'expected native DSH config dump invocation');
    assert.equal(dump.dshHome, install.dshHome);
  }),
);

test('missing bundle declaration fails structural checks before package commands run', (t) =>
  withTemp(t, (root) => {
    const { packageDir } = createFixture(root, { manifest: { dsh: undefined } });
    const { result, invocations } = runGate(root, packageDir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /phase=structural checks/);
    assert.match(result.stderr, /missing or invalid dsh declaration/);
    assert.equal(invocations.length, 0);
  }),
);

test('missing declared patch fails structural checks', (t) =>
  withTemp(t, (root) => {
    const { packageDir } = createFixture(root, {
      manifest: { dsh: { bundle: { patch: './missing.patch.yml' } } },
    });
    const { result, invocations } = runGate(root, packageDir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /phase=structural checks/);
    assert.match(result.stderr, /declared bundle patch is missing/);
    assert.equal(invocations.length, 0);
  }),
);

test('bundle patch excluded by distribution metadata fails the packing phase', (t) =>
  withTemp(t, (root) => {
    const { packageDir } = createFixture(root, { manifest: { files: ['index.js'] } });
    const { result } = runGate(root, packageDir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /phase=packing/);
    assert.match(result.stderr, /dsh\.bundle\.patch -> cordis\.patch\.yml/);
  }),
);

test('runtime entry point excluded by distribution metadata fails the packing phase', (t) =>
  withTemp(t, (root) => {
    const { packageDir } = createFixture(root, {
      manifest: {
        exports: { '.': './index.js', './client': './client.js' },
        files: ['index.js', 'cordis.patch.yml'],
      },
    });
    writeFileSync(path.join(packageDir, 'client.js'), 'export const client = true;\n');
    const { result } = runGate(root, packageDir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /phase=packing/);
    assert.match(result.stderr, /exports\.\.\/client: \.\/client\.js -> client\.js/);
  }),
);

test('build or test failure is reported as a package checks failure', (t) =>
  withTemp(t, (root) => {
    const { packageDir } = createFixture(root, {
      manifest: { scripts: { test: "node -e \"process.exit(7)\"" } },
    });
    const { result } = runGate(root, packageDir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /phase=package checks/);
    assert.match(result.stderr, /pnpm run test exited with status 7/);
  }),
);

test('packages without build or test scripts still pass', (t) =>
  withTemp(t, (root) => {
    const { packageDir } = createFixture(root);
    const { result, invocations } = runGate(root, packageDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /script=build skip \(not defined\)/);
    assert.match(result.stdout, /script=test skip \(not defined\)/);
    assert.equal(invocations.some(({ argv }) => argv[0] === 'run'), false);
  }),
);

test('native install failure is attributed to the install phase', (t) =>
  withTemp(t, (root) => {
    const { packageDir } = createFixture(root);
    const { result } = runGate(root, packageDir, { env: { FAKE_DSH_INSTALL_FAIL: '1' } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /phase=install/);
    assert.match(result.stderr, /synthetic install failure/);
  }),
);

test('config dump without selected bundle provenance fails composition', (t) =>
  withTemp(t, (root) => {
    const { packageDir } = createFixture(root);
    const { result } = runGate(root, packageDir, { env: { FAKE_DSH_OMIT_PROVENANCE: '1' } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /phase=composition/);
    assert.match(result.stderr, /contains no provenance for fixture-dsh-plugin/);
  }),
);

test('explicit DSH version override replaces but does not mutate the pinned default', (t) =>
  withTemp(t, (root) => {
    const { packageDir } = createFixture(root);
    const { result, invocations } = runGate(root, packageDir, {
      args: ['--dsh-version', '9.9.9-investigation'],
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /baseline=@deepseek-ai\/dsh@9\.9\.9-investigation \(override\)/);
    const dlxSpecs = invocations.filter(({ argv }) => argv[0] === 'dlx').map(({ argv }) => argv[1]);
    assert.ok(dlxSpecs.length >= 2);
    assert.deepEqual(new Set(dlxSpecs), new Set(['@deepseek-ai/dsh@9.9.9-investigation']));
  }),
);
