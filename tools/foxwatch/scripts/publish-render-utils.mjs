export function imageDataHasVisiblePixels(imageData) {
    for (let index = 3; index < imageData.length; index += 4) {
        if (Number(imageData[index] ?? 0) > 0) {
            return true;
        }
    }

    return false;
}
import { readdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function pruneRootStructureArtifactDirectory(directory, {
    structureId,
    isAllowedArtifact,
    preserveProjectionSidecars = false,
    onRemoved = () => {},
}) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().startsWith(`${structureId.toLowerCase()}.`)) continue;
        // Blender owns these intermediate projections, and the render cache
        // verifies them alongside images. They are not public asset deliverables.
        if (preserveProjectionSidecars && entry.name.toLowerCase().endsWith('.render.json')) continue;
        // 3D export owns its co-located files independently of 2D sprite cleanup.
        if (entry.name.toLowerCase().endsWith('.glb')) continue;
        if (isAllowedArtifact(entry.name)) continue;
        const outputPath = resolve(directory, entry.name);
        await unlink(outputPath);
        onRemoved(outputPath);
    }
}
