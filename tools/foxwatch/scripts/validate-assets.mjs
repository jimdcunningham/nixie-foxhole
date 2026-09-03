// validate-assets.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..', '..');
const ROOT = path.resolve(repositoryRoot, 'packages', 'extensions', 'foxhole', 'public', 'foxhole', 'assets');

// ---- EXAMPLE ASSET STRUCTURE ----
// packages/extensions/foxhole/public/foxhole/assets/
// - localizations/
// - shared/
//     - <components|modifications>/
//         - <componentOrModificationId>/   # shared mods use renderId folder names
//             - <componentOrModificationId>.icon.default.webp
//             - <componentOrModificationId>.icon.rendered.webp
//             - <componentOrModificationId>.preview.webp
//             - <componentOrModificationId>.texture.webp
// - types/
//     - <items|structures|vehicles>/
//         - <codename>/
//             - <components|modifications>/
//                 - <componentId|renderId>/   # renderId = {variantId}-{hash12}
//                     - <componentId|renderId>.icon.default.webp
//                     - <componentOrModificationId>.icon.rendered.webp
//                     - <componentOrModificationId>.preview.webp
//                     - <componentOrModificationId>.texture.webp
//             - <codename>.icon.default.webp
//             - <codename>.icon.rendered.webp
//             - <codename>.preview.webp
//             - <codename>.texture.webp
// - icons/ # Fallback icon assets published outside typed structure folders.
// - maps/ # Published map overlays and backgrounds.
// - ui/ # Global UI Assets: Map Textures, World Background, other generic UI icons.
// - manifest.v1.json

// ---- CONFIG ----
const ROOT_FOLDERS = ['types', 'shared', 'icons', 'maps', 'ui', 'localizations'];
const ROOT_METADATA_FOLDERS = ['.git', '.github'];
const ROOT_FILES = ['.gitignore', 'README.md', 'manifest.v1.json', 'planner-compat.json'];

const TYPES = ['structures', 'items', 'vehicles'];
const SUBTYPES = ['components', 'modifications'];
const SHARED_SUBTYPES = ['components', 'modifications', 'packaging'];

const ICON_VARIANTS = ['default', 'rendered'];

// ---- HELPERS ----
function fail(msg, filePath) {
    console.error(`ERROR: ${msg}\n  at ${filePath}`);
    process.exitCode = 1;
}

function ensureRootExists() {
    if (fs.existsSync(ROOT)) {
        return true;
    }

    fail('Asset root folder does not exist', ROOT);
    return false;
}

function isWebp(file) {
    return file.endsWith('.webp');
}

function isTextureSidecar(file) {
    return /\.texture(?:\.(?:c|w|[0-9a-f]{6}))?\.json$/i.test(file)
        || /\.destroyed\.texture\.json$/i.test(file)
        || /\.packaged\.texture\.json$/i.test(file);
}

function parseFileName(file) {
    const packagedTextureMatch = file.match(/^(.*?)\.packaged\.texture\.webp$/i);
    if (packagedTextureMatch) {
        return {
            raw: file,
            id: packagedTextureMatch[1],
            role: 'texture',
            destroyed: false,
            packaged: true,
            colorHex: null,
            iconVariant: null,
            previewVariant: null,
        };
    }

    const packagedPreviewMatch = file.match(/^(.*?)\.packaged\.preview(?:\.(ne|nw|se|sw))?\.webp$/i);
    if (packagedPreviewMatch) {
        return {
            raw: file,
            id: packagedPreviewMatch[1],
            role: 'preview',
            destroyed: false,
            packaged: true,
            colorHex: null,
            iconVariant: null,
            previewVariant: packagedPreviewMatch[2] ? packagedPreviewMatch[2].toLowerCase() : null,
        };
    }

    const packagedIconMatch = file.match(/^(.*?)\.packaged\.icon\.(default|rendered)\.webp$/i);
    if (packagedIconMatch) {
        return {
            raw: file,
            id: packagedIconMatch[1],
            role: 'icon',
            destroyed: false,
            packaged: true,
            colorHex: null,
            iconVariant: packagedIconMatch[2].toLowerCase(),
            previewVariant: null,
        };
    }

    const destroyedTextureMatch = file.match(/^(.*?)\.destroyed\.texture\.webp$/i);
    if (destroyedTextureMatch) {
        return {
            raw: file,
            id: destroyedTextureMatch[1],
            role: 'texture',
            destroyed: true,
            packaged: false,
            colorHex: null,
            iconVariant: null,
            previewVariant: null,
        };
    }

    const destroyedPreviewMatch = file.match(/^(.*?)\.destroyed\.preview(?:\.(ne|nw|se|sw))?\.webp$/i);
    if (destroyedPreviewMatch) {
        return {
            raw: file,
            id: destroyedPreviewMatch[1],
            role: 'preview',
            destroyed: true,
            packaged: false,
            colorHex: null,
            iconVariant: null,
            previewVariant: destroyedPreviewMatch[2] ? destroyedPreviewMatch[2].toLowerCase() : null,
        };
    }

    const destroyedIconMatch = file.match(/^(.*?)\.destroyed\.icon\.(default|rendered)\.webp$/i);
    if (destroyedIconMatch) {
        return {
            raw: file,
            id: destroyedIconMatch[1],
            role: 'icon',
            destroyed: true,
            packaged: false,
            colorHex: null,
            iconVariant: destroyedIconMatch[2].toLowerCase(),
            previewVariant: null,
        };
    }

    const textureMatch = file.match(/^(.*?)\.texture(?:\.(c|w|[0-9a-f]{6}))?\.webp$/i);
    if (textureMatch) {
        return {
            raw: file,
            id: textureMatch[1],
            role: 'texture',
            destroyed: false,
            packaged: false,
            colorHex: textureMatch[2] ? textureMatch[2].toLowerCase() : null,
            iconVariant: null,
            previewVariant: null,
        };
    }

    const previewMatch = file.match(/^(.*?)\.preview(?:\.(ne|nw|se|sw|c|w|[0-9a-f]{6}))?\.webp$/i);
    if (previewMatch) {
        const previewVariant = previewMatch[2] ? previewMatch[2].toLowerCase() : null;
        return {
            raw: file,
            id: previewMatch[1],
            role: 'preview',
            destroyed: false,
            packaged: false,
            colorHex: previewVariant && /^[0-9a-f]{6}$/.test(previewVariant) ? previewVariant : null,
            iconVariant: null,
            previewVariant,
        };
    }

    const iconMatch = file.match(/^(.*?)\.icon\.(default|rendered)(?:\.(c|w|[0-9a-f]{6}))?\.webp$/i);
    if (iconMatch) {
        return {
            raw: file,
            id: iconMatch[1],
            role: 'icon',
            destroyed: false,
            packaged: false,
            colorHex: iconMatch[3] ? iconMatch[3].toLowerCase() : null,
            iconVariant: iconMatch[2].toLowerCase(),
            previewVariant: null,
        };
    }

    return null;
}

function parseTextureSidecarName(file) {
    const packagedMatch = file.match(/^(.*?)\.packaged\.texture\.json$/i);
    if (packagedMatch) {
        return {
            raw: file,
            id: packagedMatch[1],
            role: 'texture',
            destroyed: false,
            packaged: true,
            colorHex: null,
        };
    }

    const destroyedMatch = file.match(/^(.*?)\.destroyed\.texture\.json$/i);
    if (destroyedMatch) {
        return {
            raw: file,
            id: destroyedMatch[1],
            role: 'texture',
            destroyed: true,
            packaged: false,
            colorHex: null,
        };
    }

    const match = file.match(/^(.*?)\.texture(?:\.(c|w|[0-9a-f]{6}))?\.json$/i);
    if (!match) {
        return null;
    }

    return {
        raw: file,
        id: match[1],
        role: 'texture',
        destroyed: false,
        packaged: false,
        colorHex: match[2] ? match[2].toLowerCase() : null,
    };
}

function createTextureVariantKey(id, variant = 'base', colorHex = null) {
    return [id, variant, colorHex ?? 'default'].join(':');
}

function formatTextureArtifactName(id, variant = 'base', colorHex = null, extension = 'webp') {
    if (variant === 'destroyed') {
        return `${id}.destroyed.texture.${extension}`;
    }

    if (variant === 'packaged') {
        return `${id}.packaged.texture.${extension}`;
    }

    const colorSuffix = colorHex ? `.${colorHex}` : '';
    return `${id}.texture${colorSuffix}.${extension}`;
}

// ---- VALIDATION ----
function validateRoot() {
    if (!ensureRootExists()) {
        return;
    }

    const entries = fs.readdirSync(ROOT);

    for (const entry of entries) {
        const fullPath = path.join(ROOT, entry);

        if (!ROOT_FOLDERS.includes(entry)
            && !ROOT_METADATA_FOLDERS.includes(entry)
            && !ROOT_FILES.includes(entry)) {
            fail('Invalid root entry', fullPath);
        }
    }
}

function validateAssetFiles(dir, expectedId) {
    const files = fs.readdirSync(dir);
    const textureIds = new Set();
    const sidecarIds = new Set();

    for (const file of files) {
        const fullPath = path.join(dir, file);

        if (fs.statSync(fullPath).isDirectory()) {
            continue;
        }

        if (isTextureSidecar(file)) {
            const parsed = parseTextureSidecarName(file);
            if (!parsed) {
                fail('Invalid texture sidecar name', fullPath);
                continue;
            }
            if (parsed.id !== expectedId) {
                fail(`Texture sidecar ID mismatch (expected "${expectedId}")`, fullPath);
            }
            sidecarIds.add(createTextureVariantKey(
                parsed.id,
                parsed.packaged ? 'packaged' : parsed.destroyed ? 'destroyed' : 'base',
                parsed.colorHex,
            ));
            continue;
        }

        if (!isWebp(file)) {
            fail('Unexpected non-asset file', fullPath);
            continue;
        }

        const parsed = parseFileName(file);
        if (!parsed) {
            fail('Invalid asset filename', fullPath);
            continue;
        }

        // ID must match folder
        if (parsed.id !== expectedId) {
            fail(`ID mismatch (expected "${expectedId}")`, fullPath);
        }

        if (parsed.role === 'icon') {
            if (!ICON_VARIANTS.includes(parsed.iconVariant)) {
                fail('Invalid icon variant', fullPath);
            }
            if (parsed.colorHex && parsed.iconVariant !== 'rendered') {
                fail('Only rendered icons may use color suffixes', fullPath);
            }
        }

        if ((parsed.destroyed || parsed.packaged) && parsed.colorHex) {
            fail('Destroyed or packaged assets cannot use color suffixes', fullPath);
        }

        if (parsed.role === 'texture' && (parsed.destroyed || parsed.packaged) && parsed.colorHex) {
            fail('Destroyed or packaged textures cannot use color suffixes', fullPath);
        }

        if (parsed.role === 'preview' && parsed.previewVariant && !/^(ne|nw|se|sw|c|w|[0-9a-f]{6})$/.test(parsed.previewVariant)) {
            fail('Invalid preview variant', fullPath);
        }

        if (parsed.role === 'texture') {
            textureIds.add(createTextureVariantKey(
                parsed.id,
                parsed.packaged ? 'packaged' : parsed.destroyed ? 'destroyed' : 'base',
                parsed.colorHex,
            ));
        }
    }

    for (const textureId of textureIds) {
        if (!sidecarIds.has(textureId)) {
            const [id, variant, colorHex] = textureId.split(':');
            const hasSiblingSidecar = [...sidecarIds]
                .some(sidecarId => sidecarId.startsWith(`${id}:${variant}:`));
            if (hasSiblingSidecar) {
                // Color/faction variants share one sprite geometry. A sidecar for
                // any sibling in the same variant group is authoritative for all.
                continue;
            }
            fail(`Missing texture sidecar "${formatTextureArtifactName(id, variant, colorHex === 'default' ? null : colorHex, 'json')}"`, dir);
        }
    }

    for (const sidecarId of sidecarIds) {
        if (!textureIds.has(sidecarId)) {
            const [id, variant, colorHex] = sidecarId.split(':');
            fail(`Texture sidecar without matching texture "${formatTextureArtifactName(id, variant, colorHex === 'default' ? null : colorHex, 'webp')}"`, dir);
        }
    }
}

function isRenderIdFolderName(value) {
    return /-[a-f0-9]{12}$/.test(String(value ?? '').toLowerCase());
}

function validateChildFolder(dir, requireRenderId = false) {
    const childId = path.basename(dir);
    const parentSubtype = path.basename(path.dirname(dir));
    if (requireRenderId && parentSubtype === 'modifications' && !isRenderIdFolderName(childId)) {
        fail('Modification folder must use renderId (variant-hash), not bare variantId', dir);
    }
    validateAssetFiles(dir, childId);
}

function validateSubtypeFolder(dir, requireRenderIds = false) {
    const entries = fs.readdirSync(dir);

    for (const entry of entries) {
        const fullPath = path.join(dir, entry);

        if (!fs.statSync(fullPath).isDirectory()) {
            fail('Expected directory inside subtype', fullPath);
            continue;
        }

        validateChildFolder(fullPath, requireRenderIds);
    }
}

function validateAssetFolder(dir) {
    const id = path.basename(dir);
    const entries = fs.readdirSync(dir);
    let hasAssetFiles = false;

    for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            if (!SUBTYPES.includes(entry)) {
                fail(`Invalid subtype folder "${entry}"`, fullPath);
                continue;
            }

            validateSubtypeFolder(fullPath);
        } else {
            if (!isWebp(entry)) {
                continue;
            }

            hasAssetFiles = true;
        }
    }

    if (hasAssetFiles) {
        validateAssetFiles(dir, id);
    }
}

function validateTypeFolder(typeDir) {
    const entries = fs.readdirSync(typeDir);

    for (const entry of entries) {
        const fullPath = path.join(typeDir, entry);

        if (!fs.statSync(fullPath).isDirectory()) {
            fail('Expected asset directory', fullPath);
            continue;
        }

        validateAssetFolder(fullPath);
    }
}

function validateTypesRoot(typesDir) {
    const entries = fs.readdirSync(typesDir);

    for (const entry of entries) {
        const fullPath = path.join(typesDir, entry);

        if (!fs.statSync(fullPath).isDirectory()) {
            fail('Expected type directory', fullPath);
            continue;
        }

        if (!TYPES.includes(entry)) {
            fail(`Invalid type folder "${entry}"`, fullPath);
            continue;
        }

        validateTypeFolder(fullPath);
    }
}

function validateShared(sharedDir) {
    const entries = fs.readdirSync(sharedDir);

    for (const subtype of entries) {
        const subtypePath = path.join(sharedDir, subtype);

        if (!SHARED_SUBTYPES.includes(subtype)) {
            fail(`Invalid shared subtype "${subtype}"`, subtypePath);
            continue;
        }

        validateSubtypeFolder(subtypePath, subtype === 'modifications');
    }
}

// ---- MAIN ----
function run() {
    console.log('Validating assets...\n');

    validateRoot();

    if (process.exitCode) {
        console.error('\nValidation failed');
        process.exit(1);
    }

    for (const folder of fs.readdirSync(ROOT)) {
        const fullPath = path.join(ROOT, folder);

        if (!fs.statSync(fullPath).isDirectory()) {
            continue;
        }

        if (folder === 'types') {
            validateTypesRoot(fullPath);
        } else if (folder === 'shared') {
            validateShared(fullPath);
        }
    }

    if (process.exitCode) {
        console.error('\nValidation failed');
        process.exit(1);
    } else {
        console.log('Assets valid');
    }
}

run();
