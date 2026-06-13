import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(currentDir, "..", "..", "..");
const foxholePlannerRoot = resolve(repositoryRoot, "apps", "foxhole-planner");
const assetsDirectory = resolve(foxholePlannerRoot, "public", "foxhole", "assets");
const plannerPackageJsonPath = resolve(foxholePlannerRoot, "package.json");
const publishedManifestPath = resolve(assetsDirectory, "manifest.v1.json");
const mapDataPath = resolve(assetsDirectory, "maps", "map-data.v1.json");
const plannerCompatPath = resolve(assetsDirectory, "planner-compat.json");

export async function publishPlannerCompat(options = {}) {
  const root = options.repositoryRoot ?? repositoryRoot;
  const plannerPackage = JSON.parse(await readFile(
    options.plannerPackageJsonPath ?? resolve(root, "apps", "foxhole-planner", "package.json"),
    "utf8",
  ));
  const manifestDocument = JSON.parse(await readFile(
    options.publishedManifestPath ?? resolve(root, "apps", "foxhole-planner", "public", "foxhole", "assets", "manifest.v1.json"),
    "utf8",
  ));

  const compatDocument = {
    plannerVersion: String(plannerPackage.version ?? "").trim(),
    manifestSchemaVersion: String(manifestDocument.schemaVersion ?? "").trim(),
    publishedAt: new Date().toISOString(),
  };

  if (!compatDocument.plannerVersion) {
    throw new Error("publish-planner-compat requires apps/foxhole-planner/package.json version");
  }

  if (!compatDocument.manifestSchemaVersion) {
    throw new Error("publish-planner-compat requires manifest.v1.json schemaVersion");
  }

  const resolvedMapDataPath = options.mapDataPath ?? resolve(root, "apps", "foxhole-planner", "public", "foxhole", "assets", "maps", "map-data.v1.json");
  try {
    const mapDataDocument = JSON.parse(await readFile(resolvedMapDataPath, "utf8"));
    const mapDataSchemaVersion = String(mapDataDocument.schemaVersion ?? "").trim();
    if (mapDataSchemaVersion) {
      compatDocument.mapDataSchemaVersion = mapDataSchemaVersion;
    }
  } catch {
    // map-data.v1.json is optional for compat metadata
  }

  const outputPath = options.plannerCompatPath ?? resolve(root, "apps", "foxhole-planner", "public", "foxhole", "assets", "planner-compat.json");
  await writeFile(outputPath, `${JSON.stringify(compatDocument, null, 2)}\n`, "utf8");
  return compatDocument;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  await publishPlannerCompat();
}
