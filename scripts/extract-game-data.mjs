#!/usr/bin/env node
/**
 * Extracts items, recipes and production buildings from the game's Docs JSON
 * (CommunityResources/Docs/<lang>.json) into clean, typed JSON files used by the app.
 *
 * Usage:
 *   npm run data:extract
 *   npm run data:extract -- "D:/path/to/Satisfactory"
 *   SATISFACTORY_DIR="D:/path/to/Satisfactory" npm run data:extract
 *
 * Output: src/app/data/{items,recipes,buildings}.json (types in game-data.model.ts).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_GAME_DIR = 'C:/Program Files (x86)/Steam/steamapps/common/Satisfactory';
const gameDir = process.argv[2] ?? process.env.SATISFACTORY_DIR ?? DEFAULT_GAME_DIR;
const docsDir = join(gameDir, 'CommunityResources', 'Docs');
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app', 'data');

/** Fluids are stored in litres in the game files; the UI works in m³. */
const FLUID_FACTOR = 1000;

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** Docs files are UTF-16 LE with BOM. */
function loadDocs(lang) {
  const path = join(docsDir, `${lang}.json`);
  let buffer;
  try {
    buffer = readFileSync(path);
  } catch {
    console.error(
      `No se encuentra ${path}\nPasa la carpeta del juego como argumento o en SATISFACTORY_DIR.`,
    );
    process.exit(1);
  }
  const isUtf16 = buffer[0] === 0xff && buffer[1] === 0xfe;
  const text = buffer.toString(isUtf16 ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '');
  /** @type {{NativeClass: string, Classes: Record<string, any>[]}[]} */
  const groups = JSON.parse(text);
  const byClass = new Map();
  for (const group of groups) {
    const native = group.NativeClass.match(/\.(\w+)'?$/)?.[1] ?? group.NativeClass;
    for (const cls of group.Classes) byClass.set(cls.ClassName, { ...cls, _native: native });
  }
  return byClass;
}

const es = loadDocs('es-ES');
const en = loadDocs('en-US');

// ---------------------------------------------------------------------------
// Parsing helpers for Unreal's text serialisation
// ---------------------------------------------------------------------------

const num = (value) => (value === undefined || value === '' ? 0 : Number(value));
const bool = (value) => value === 'True';
const round = (value) => Math.round(value * 1e6) / 1e6;

/** All class names (`Foo_C`) referenced in a serialised string, in order. */
function classRefs(value) {
  if (!value) return [];
  return [...value.matchAll(/\.(\w+_C)\b/g)].map((m) => m[1]);
}

/** `((ItemClass="...Desc_X_C'",Amount=3),(...))` → [{ item, amount }] */
function parseItemAmounts(value) {
  if (!value) return [];
  return [...value.matchAll(/ItemClass="[^"]*?\.(\w+_C)'?"\s*,\s*Amount=(\d+(?:\.\d+)?)/g)].map(
    (m) => ({ item: m[1], amount: Number(m[2]) }),
  );
}

/** `(RF_LIQUID,RF_GAS)` → ['liquid', 'gas'] */
function parseForms(value) {
  return [...(value ?? '').matchAll(/RF_(SOLID|LIQUID|GAS)/g)].map((m) => m[1].toLowerCase());
}

/** `(B=21,G=125,R=235,A=0)` → '#eb7d15' */
function parseColor(value) {
  const c = Object.fromEntries(
    [...(value ?? '').matchAll(/([RGBA])=(\d+)/g)].map((m) => [m[1], +m[2]]),
  );
  const hex = (n) => (n ?? 0).toString(16).padStart(2, '0');
  return `#${hex(c.R)}${hex(c.G)}${hex(c.B)}`;
}

/** `Texture2D /Game/.../IconDesc_X_256.IconDesc_X_256` → '/Game/.../IconDesc_X_256' */
function parseTexture(value) {
  if (!value || value === 'None') return null;
  return value.replace(/^Texture2D\s+/, '').replace(/\.[^./]+$/, '');
}

function localized(id, field) {
  return { es: es.get(id)?.[field] ?? '', en: en.get(id)?.[field] ?? '' };
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

const MANUFACTURERS = ['FGBuildableManufacturer', 'FGBuildableManufacturerVariablePower'];
const EXTRACTORS = [
  'FGBuildableResourceExtractor',
  'FGBuildableWaterPump',
  'FGBuildableFrackingExtractor',
];
const GENERATORS = [
  'FGBuildableGeneratorFuel',
  'FGBuildableGeneratorNuclear',
  'FGBuildableGeneratorGeoThermal',
];
const PRESSURIZERS = ['FGBuildableFrackingActivator'];

/** Items referenced by buildings (fuels, extractable resources) are kept in items.json. */
const referencedItems = new Set();

function buildingBase(cls) {
  return {
    id: cls.ClassName,
    name: localized(cls.ClassName, 'mDisplayName'),
    description: localized(cls.ClassName, 'mDescription'),
    powerMW: num(cls.mPowerConsumption),
    powerExponent: num(cls.mPowerConsumptionExponent),
    canOverclock: bool(cls.mCanChangePotential),
  };
}

const buildings = [];
for (const cls of es.values()) {
  const native = cls._native;
  if (MANUFACTURERS.includes(native)) {
    const isVariable = native === 'FGBuildableManufacturerVariablePower';
    buildings.push({
      ...buildingBase(cls),
      kind: 'manufacturer',
      somersloopSlots: num(cls.mProductionShardSlotSize),
      somersloopMultiplier: num(cls.mProductionShardBoostMultiplier),
      boostPowerExponent: num(cls.mProductionBoostPowerConsumptionExponent),
      variablePower: isVariable
        ? {
            min: num(cls.mEstimatedMininumPowerConsumption),
            max: num(cls.mEstimatedMaximumPowerConsumption),
          }
        : null,
    });
  } else if (EXTRACTORS.includes(native)) {
    const allowedForms = parseForms(cls.mAllowedResourceForms);
    const isFluid = allowedForms.every((f) => f !== 'solid');
    const itemsPerCycle = num(cls.mItemsPerCycle) / (isFluid ? FLUID_FACTOR : 1);
    const cycleTime = num(cls.mExtractCycleTime);
    const allowedResources = bool(cls.mOnlyAllowCertainResources)
      ? classRefs(cls.mAllowedResources)
      : [];
    allowedResources.forEach((r) => referencedItems.add(r));
    buildings.push({
      ...buildingBase(cls),
      kind: 'extractor',
      cycleTime,
      itemsPerCycle: round(itemsPerCycle),
      ratePerMinute: round((itemsPerCycle / cycleTime) * 60),
      allowedForms,
      allowedResources,
    });
  } else if (GENERATORS.includes(native)) {
    const fuels = (Array.isArray(cls.mFuel) ? cls.mFuel : []).map((f) => ({
      fuel: f.mFuelClass,
      supplemental: f.mSupplementalResourceClass || null,
      byproduct: f.mByproduct ? { item: f.mByproduct, amount: num(f.mByproductAmount) } : null,
    }));
    for (const f of fuels) {
      referencedItems.add(f.fuel);
      if (f.supplemental) referencedItems.add(f.supplemental);
      if (f.byproduct) referencedItems.add(f.byproduct.item);
    }
    const isGeothermal = native === 'FGBuildableGeneratorGeoThermal';
    buildings.push({
      ...buildingBase(cls),
      kind: 'generator',
      powerProductionMW: num(cls.mPowerProduction),
      fuels,
      supplementalToPowerRatio: num(cls.mSupplementalToPowerRatio),
      variablePowerProduction: isGeothermal
        ? {
            constant: num(cls.mVariablePowerProductionConstant),
            factor: num(cls.mVariablePowerProductionFactor),
            cycleLength: num(cls.mVariablePowerProductionCycleLength),
          }
        : null,
    });
  } else if (PRESSURIZERS.includes(native)) {
    buildings.push({
      ...buildingBase(cls),
      kind: 'pressurizer',
      allowedResources: classRefs(cls.mAllowedResources),
    });
  }
}

const buildingIds = new Set(buildings.map((b) => b.id));

// ---------------------------------------------------------------------------
// Items (lookup only; filtered to what recipes/buildings use at the end)
// ---------------------------------------------------------------------------

const isItemClass = (cls) => cls.mForm !== undefined && cls.mStackSize !== undefined;
const isFluidId = (id) => {
  const form = es.get(id)?.mForm;
  return form === 'RF_LIQUID' || form === 'RF_GAS';
};

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

/** Recipe IDs unlocked by hard drive schematics. */
const alternateRecipeIds = new Set();
for (const cls of es.values()) {
  if (cls.mType !== 'EST_Alternate' || !Array.isArray(cls.mUnlocks)) continue;
  for (const unlock of cls.mUnlocks)
    classRefs(unlock.mRecipes).forEach((r) => alternateRecipeIds.add(r));
}

const normaliseAmounts = (list) =>
  list.map(({ item, amount }) => ({
    item,
    amount: round(isFluidId(item) ? amount / FLUID_FACTOR : amount),
  }));

const recipes = [];
for (const cls of es.values()) {
  if (cls._native !== 'FGRecipe') continue;
  // Only recipes run by an automated production building (drops build gun, workbench, etc.).
  const producedIn = classRefs(cls.mProducedIn).find((b) => buildingIds.has(b));
  if (!producedIn) continue;

  const ingredients = normaliseAmounts(parseItemAmounts(cls.mIngredients));
  const products = normaliseAmounts(parseItemAmounts(cls.mProduct));
  if (products.length === 0) continue;

  const variableConstant = num(cls.mVariablePowerConsumptionConstant);
  const variableFactor = num(cls.mVariablePowerConsumptionFactor);
  const building = buildings.find((b) => b.id === producedIn);
  const hasVariablePower = building?.kind === 'manufacturer' && building.variablePower !== null;

  recipes.push({
    id: cls.ClassName,
    name: localized(cls.ClassName, 'mDisplayName'),
    // Hard drive unlocks, plus the few MAM ones the game itself names "Alternate: ...".
    alternate:
      alternateRecipeIds.has(cls.ClassName) ||
      (en.get(cls.ClassName)?.mDisplayName ?? '').startsWith('Alternate'),
    ingredients,
    products,
    duration: num(cls.mManufactoringDuration),
    producedIn,
    variablePower: hasVariablePower
      ? { min: variableConstant, max: round(variableConstant + variableFactor) }
      : null,
  });

  for (const { item } of [...ingredients, ...products]) referencedItems.add(item);
}

// ---------------------------------------------------------------------------
// Final items list
// ---------------------------------------------------------------------------

const FORMS = { RF_SOLID: 'solid', RF_LIQUID: 'liquid', RF_GAS: 'gas' };

const items = [];
for (const id of referencedItems) {
  const cls = es.get(id);
  if (!cls || !isItemClass(cls)) {
    console.warn(`Aviso: item referenciado pero no encontrado: ${id}`);
    continue;
  }
  const form = FORMS[cls.mForm] ?? 'solid';
  const fluid = form !== 'solid';
  items.push({
    id,
    name: localized(id, 'mDisplayName'),
    description: localized(id, 'mDescription'),
    form,
    isRawResource: cls._native === 'FGResourceDescriptor',
    stackSize: fluid ? null : num(cls.mCachedStackSize),
    sinkPoints: num(cls.mResourceSinkPoints),
    energyMJ: round(num(cls.mEnergyValue) * (fluid ? FLUID_FACTOR : 1)),
    radioactiveDecay: num(cls.mRadioactiveDecay),
    fluidColor: fluid ? parseColor(cls.mFluidColor) : null,
    iconPath: parseTexture(cls.mPersistentBigIcon),
  });
}

// ---------------------------------------------------------------------------
// Output (sorted by ID for stable diffs between game versions)
// ---------------------------------------------------------------------------

const byId = (a, b) => a.id.localeCompare(b.id);
mkdirSync(outDir, { recursive: true });
for (const [file, data] of [
  ['items.json', items.sort(byId)],
  ['recipes.json', recipes.sort(byId)],
  ['buildings.json', buildings.sort(byId)],
]) {
  writeFileSync(join(outDir, file), JSON.stringify(data, null, 2) + '\n', 'utf8');
}

const alternates = recipes.filter((r) => r.alternate).length;
console.log(
  `OK → ${items.length} items, ${recipes.length} recetas (${alternates} alternativas), ${buildings.length} edificios`,
);
