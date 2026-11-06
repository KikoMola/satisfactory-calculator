#!/usr/bin/env node
/**
 * Copies the item and building icons the app uses from a folder of textures exported with
 * FModel ("Export Folder → Textures" on the game's .utoc), resized to 64×64 PNG.
 * Resizing uses System.Drawing through PowerShell, so this script runs on Windows only.
 *
 * Usage:
 *   npm run icons:extract                      (defaults to ../assets_satis next to the repo)
 *   npm run icons:extract -- "D:/exports"
 *   SATISFACTORY_ICONS_DIR="D:/exports" npm run icons:extract
 *
 * The export folder must keep FModel's layout: <dir>/FactoryGame/Content/FactoryGame/...
 * Run `npm run data:extract` first: icon paths come from items.json and buildings.json.
 *
 * Output: public/icons/<ClassName>.png and src/app/data/icons.json (IDs that have an icon).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const exportDir = resolve(
  process.argv[2] ?? process.env.SATISFACTORY_ICONS_DIR ?? join(root, '..', 'assets_satis'),
);
const dataDir = join(root, 'src', 'app', 'data');
const iconsDir = join(root, 'public', 'icons');
const SIZE = 64;

if (!existsSync(join(exportDir, 'FactoryGame', 'Content'))) {
  console.error(
    `No se encuentra ${join(exportDir, 'FactoryGame', 'Content')}\n` +
      'Pasa la carpeta exportada con FModel como argumento o en SATISFACTORY_ICONS_DIR.',
  );
  process.exit(1);
}

const load = (file) => JSON.parse(readFileSync(join(dataDir, file), 'utf8'));
const entries = [...load('items.json'), ...load('buildings.json')].filter((e) => e.iconPath);

/** '/Game/FactoryGame/X/IconDesc_Y_256' → '<exportDir>/FactoryGame/Content/FactoryGame/X/IconDesc_Y_256.png' */
const sourceOf = (iconPath) =>
  join(exportDir, 'FactoryGame', 'Content', ...iconPath.replace(/^\/Game\//, '').split('/')) +
  '.png';

const found = [];
const missing = [];
for (const entry of entries) {
  const source = sourceOf(entry.iconPath);
  (existsSync(source) ? found : missing).push({ id: entry.id, source });
}

// public/icons only holds generated files: start clean so removed items don't linger.
mkdirSync(iconsDir, { recursive: true });
for (const file of readdirSync(iconsDir)) {
  if (file.endsWith('.png')) rmSync(join(iconsDir, file));
}

const listFile = join(tmpdir(), `satisfactory-icons-${process.pid}.txt`);
writeFileSync(
  listFile,
  found.map(({ id, source }) => `${source}\t${join(iconsDir, `${id}.png`)}`).join('\n'),
  'utf8',
);
const result = spawnSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    join(root, 'scripts', 'resize-icons.ps1'),
    '-List',
    listFile,
    '-Size',
    String(SIZE),
  ],
  { encoding: 'utf8' },
);
rmSync(listFile, { force: true });
if (result.status !== 0) {
  console.error(result.stderr || result.error?.message || 'PowerShell falló');
  process.exit(1);
}

const ids = found.map((f) => f.id).sort();
writeFileSync(join(dataDir, 'icons.json'), JSON.stringify(ids, null, 2) + '\n', 'utf8');

console.log(`OK → ${found.length} iconos (${SIZE}×${SIZE}) en public/icons`);
if (missing.length > 0) {
  console.warn(`Faltan ${missing.length} (expórtalos con FModel y vuelve a ejecutar):`);
  for (const m of missing) console.warn(`  ${m.id}  ←  ${m.source}`);
}
