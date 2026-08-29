#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const configPath = path.join(repoRoot, 'dsh-release-gate.json');
const phaseNames = {
  structural: 'structural checks',
  packageChecks: 'package checks',
  packing: 'packing',
  install: 'install',
  composition: 'composition',
};

class GateError extends Error {
  constructor(phase, message, options) {
    super(message, options);
    this.name = 'GateError';
    this.phase = phase;
  }
}

function usage() {
  return `Usage: pnpm release:gate -- <package-directory> [--dsh-version <version>]

Validates one DSH bundle through package checks, packing, isolated native DSH install,
and config composition. The default DSH version comes from dsh-release-gate.json.`;
}

function parseArgs(argv) {
  const positional = [];
  let dshVersion;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--dsh-version') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('--dsh-version requires a version value');
      }
      dshVersion = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
    positional.push(arg);
  }

  if (positional.length !== 1) {
    throw new Error('select exactly one package directory');
  }

  return { packagePath: positional[0], dshVersion, help: false };
}

function readJson(filePath, label = filePath) {
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`cannot read ${label}: ${error.message}`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid JSON in ${label}: ${error.message}`);
  }
}

function log(message) {
  process.stdout.write(`[dsh-release-gate] ${message}\n`);
}

function formatCommand(command, args) {
  return [command, ...args]
    .map((part) => (/^[A-Za-z0-9_./:@=-]+$/.test(part) ? part : JSON.stringify(part)))
    .join(' ');
}

function compactOutput(stdout, stderr) {
  const text = [stderr, stdout]
    .filter(Boolean)
    .join('\n')
    .trim();
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  return `: ${lines.slice(-8).join('\n')}`;
}

function runCommand(command, args, { cwd, env = process.env, quiet = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    windowsHide: true,
  });

  if (!quiet) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }

  if (result.error) {
    throw new Error(`could not start ${formatCommand(command, args)}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `${formatCommand(command, args)} exited with status ${result.status}${compactOutput(result.stdout, result.stderr)}`,
    );
  }

  return result.stdout ?? '';
}

function withinDirectory(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizePackagePath(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (path.isAbsolute(value)) throw new Error(`${label} must be package-relative, got ${value}`);

  const portable = value.replaceAll('\\', '/');
  const normalized = path.posix.normalize(portable.replace(/^\.\//, ''));
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/')) {
    throw new Error(`${label} must name a file inside the package, got ${value}`);
  }
  return normalized;
}

function isExactSemver(value) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}

function getBundlePatch(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('package manifest must be a JSON object');
  }
  if (!manifest.dsh || typeof manifest.dsh !== 'object' || Array.isArray(manifest.dsh)) {
    throw new Error('missing or invalid dsh declaration');
  }
  if (!manifest.dsh.bundle || typeof manifest.dsh.bundle !== 'object' || Array.isArray(manifest.dsh.bundle)) {
    throw new Error('missing or invalid dsh.bundle declaration');
  }
  return normalizePackagePath(manifest.dsh.bundle.patch, 'dsh.bundle.patch');
}

function addTarget(targets, label, value) {
  if (typeof value !== 'string' || value.trim() === '') return;
  if (value.startsWith('#') || /^[a-z]+:/i.test(value)) return;
  const normalized = normalizePackagePath(value, label);
  targets.set(`${label}: ${value}`, normalized);
}

function collectExportTargets(value, label, targets) {
  if (typeof value === 'string') {
    addTarget(targets, label, value);
    return;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;

  for (const [key, nested] of Object.entries(value)) {
    collectExportTargets(nested, `${label}.${key}`, targets);
  }
}

function collectArtifactTargets(manifest, bundlePatch) {
  const targets = new Map([['dsh.bundle.patch', bundlePatch]]);
  addTarget(targets, 'main', manifest.main);
  addTarget(targets, 'module', manifest.module);
  collectExportTargets(manifest.exports, 'exports', targets);

  if (typeof manifest.bin === 'string') {
    addTarget(targets, 'bin', manifest.bin);
  } else if (manifest.bin && typeof manifest.bin === 'object' && !Array.isArray(manifest.bin)) {
    for (const [name, value] of Object.entries(manifest.bin)) {
      addTarget(targets, `bin.${name}`, value);
    }
  }

  return targets;
}

function targetPatternRegex(target) {
  const escaped = target.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]+');
  return new RegExp(`^package/${escaped}$`);
}

function artifactContains(entries, target) {
  if (!target.includes('*')) return entries.has(`package/${target}`);
  const pattern = targetPatternRegex(target);
  return [...entries].some((entry) => pattern.test(entry));
}

function inspectTarball(tarballPath) {
  const listing = runCommand('tar', ['-tzf', tarballPath], { quiet: true });
  const entries = new Set(
    listing
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/\/$/, ''))
      .filter(Boolean),
  );
  if (!entries.has('package/package.json')) {
    throw new Error('packed artifact does not contain package/package.json');
  }

  const packedManifestText = runCommand('tar', ['-xOf', tarballPath, 'package/package.json'], { quiet: true });
  let packedManifest;
  try {
    packedManifest = JSON.parse(packedManifestText);
  } catch (error) {
    throw new Error(`packed package.json is invalid JSON: ${error.message}`);
  }

  const bundlePatch = getBundlePatch(packedManifest);
  const requiredTargets = collectArtifactTargets(packedManifest, bundlePatch);
  const missing = [];
  for (const [label, target] of requiredTargets) {
    if (!artifactContains(entries, target)) missing.push(`${label} -> ${target}`);
  }
  if (missing.length > 0) {
    throw new Error(`packed artifact is missing declared runtime files: ${missing.join(', ')}`);
  }

  return packedManifest;
}

function runPhase(phase, fn) {
  log(`phase=${phaseNames[phase]} start`);
  try {
    const value = fn();
    log(`phase=${phaseNames[phase]} pass`);
    return value;
  } catch (error) {
    if (error instanceof GateError) throw error;
    throw new GateError(phase, error.message, { cause: error });
  }
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${usage()}\n\nError: ${error.message}\n`);
    process.exitCode = 2;
    return;
  }

  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  let baseline;
  try {
    baseline = readJson(configPath, 'dsh-release-gate.json');
  } catch (error) {
    process.stderr.write(`[dsh-release-gate] FAIL phase=structural checks selected=${args.packagePath}: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  if (typeof baseline.dshPackage !== 'string' || baseline.dshPackage.trim() === '') {
    process.stderr.write(`[dsh-release-gate] FAIL package=${args.packagePath} phase=structural checks: dshPackage must be pinned in dsh-release-gate.json\n`);
    process.exitCode = 1;
    return;
  }
  if (typeof baseline.dshVersion !== 'string' || !isExactSemver(baseline.dshVersion)) {
    process.stderr.write(`[dsh-release-gate] FAIL package=${args.packagePath} phase=structural checks: dshVersion must be an exact semver in dsh-release-gate.json\n`);
    process.exitCode = 1;
    return;
  }

  const dshVersion = args.dshVersion ?? baseline.dshVersion;
  const dshSpec = `${baseline.dshPackage}@${dshVersion}`;
  const packageDir = path.resolve(process.cwd(), args.packagePath);
  const packageJsonPath = path.join(packageDir, 'package.json');
  let packageName = args.packagePath;
  let tarballPath;
  let tempRoot;

  try {
    const manifest = runPhase('structural', () => {
      if (!existsSync(packageJsonPath)) {
        throw new Error(`selected package has no package.json: ${packageDir}`);
      }
      const candidate = readJson(packageJsonPath, `${args.packagePath}/package.json`);
      if (typeof candidate.name !== 'string' || candidate.name.trim() === '') {
        throw new Error('package.json name must be a non-empty string');
      }
      packageName = candidate.name;
      const bundlePatch = getBundlePatch(candidate);
      const sourcePatch = path.resolve(packageDir, bundlePatch);
      if (!withinDirectory(packageDir, sourcePatch)) {
        throw new Error(`dsh.bundle.patch escapes the package: ${candidate.dsh.bundle.patch}`);
      }
      if (!existsSync(sourcePatch) || !statSync(sourcePatch).isFile()) {
        throw new Error(`declared bundle patch is missing: ${candidate.dsh.bundle.patch}`);
      }
      return candidate;
    });

    log(`package=${packageName} selected=${packageDir}`);
    log(`baseline=${dshSpec}${args.dshVersion ? ' (override)' : ''}`);

    tempRoot = mkdtempSync(path.join(tmpdir(), 'dsh-release-gate-'));
    const packDir = path.join(tempRoot, 'pack');
    const dshHome = path.join(tempRoot, 'dsh-home');
    const isolatedEnv = { ...process.env, DSH_HOME: dshHome };
    mkdirSync(packDir, { recursive: true });
    mkdirSync(dshHome, { recursive: true });

    runPhase('packageChecks', () => {
      for (const scriptName of ['build', 'test']) {
        const script = manifest.scripts?.[scriptName];
        if (typeof script !== 'string' || script.trim() === '') {
          log(`package=${packageName} script=${scriptName} skip (not defined)`);
          continue;
        }
        log(`package=${packageName} script=${scriptName} run`);
        runCommand('pnpm', ['run', scriptName], { cwd: packageDir, env: isolatedEnv });
      }
    });

    runPhase('packing', () => {
      runCommand('pnpm', ['pack', '--pack-destination', packDir], {
        cwd: packageDir,
        env: isolatedEnv,
        quiet: true,
      });
      const tarballs = readdirSync(packDir)
        .filter((name) => name.endsWith('.tgz'))
        .map((name) => path.join(packDir, name));
      if (tarballs.length !== 1) {
        throw new Error(`expected exactly one packed tarball, found ${tarballs.length}`);
      }
      [tarballPath] = tarballs;
      const packedManifest = inspectTarball(tarballPath);
      if (packedManifest.name !== manifest.name) {
        throw new Error(`packed package name changed from ${manifest.name ?? '<missing>'} to ${packedManifest.name ?? '<missing>'}`);
      }
      log(`package=${packageName} artifact=${path.basename(tarballPath)} sha256=${sha256(tarballPath)}`);
    });

    const profileName = 'release-gate';

    runPhase('install', () => {
      runCommand(
        'pnpm',
        ['dlx', dshSpec, 'plugin', '--profile', profileName, 'add', '-w', tarballPath],
        { cwd: repoRoot, env: isolatedEnv },
      );

      const profileManifestPath = path.join(dshHome, 'profiles', profileName, 'package.json');
      const profileManifest = readJson(profileManifestPath, 'isolated DSH profile package.json');
      const bundles = profileManifest?.dsh?.profile?.bundles;
      if (!Array.isArray(bundles) || !bundles.includes(packageName)) {
        throw new Error(`native DSH install did not activate ${packageName} in dsh.profile.bundles`);
      }
    });

    runPhase('composition', () => {
      const dump = runCommand(
        'pnpm',
        ['dlx', dshSpec, '--profile', profileName, '--dump-config'],
        { cwd: repoRoot, env: isolatedEnv, quiet: true },
      );
      if (dump.trim() === '') throw new Error('native DSH config dump was empty');
      const provenance = dump
        .split(/\r?\n/)
        .filter((line) => line.trimStart().startsWith('# =='));
      if (!provenance.some((line) => line.includes(packageName))) {
        throw new Error(`config dump succeeded but contains no provenance for ${packageName}`);
      }
    });

    log(`PASS package=${packageName} baseline=${dshSpec} artifact=${path.basename(tarballPath)}`);
  } catch (error) {
    const phase = error instanceof GateError ? phaseNames[error.phase] : 'structural checks';
    process.stderr.write(`[dsh-release-gate] FAIL package=${packageName} phase=${phase}: ${error.message}\n`);
    process.exitCode = 1;
  } finally {
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  }
}

main();
