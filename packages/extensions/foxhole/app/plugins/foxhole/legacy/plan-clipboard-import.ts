import type { NixieSelectionClipboardItem } from '#nixie/plugins/nixie/registry/types.ts';
import {
    isLegacyPlanClipboardText,
    parseLegacyPlanClipboardText,
} from './plan-clipboard.ts';
import { LegacyPlanImporter } from './plan-importer.ts';

export { isLegacyPlanClipboardText };

/**
 * Convert a legacy `data:plan;…` clipboard string into Nixie selection clipboard items.
 */
export async function importLegacyPlanClipboardText(
    text: string,
): Promise<NixieSelectionClipboardItem[] | null> {
    if (!isLegacyPlanClipboardText(text)) {
        return null;
    }

    const save = parseLegacyPlanClipboardText(text);
    const result = await new LegacyPlanImporter({
        fixtureName: 'clipboard',
    }).importSave(save, { fixtureName: 'clipboard' });

    if (!result.boardSnapshots.length) {
        return null;
    }

    return result.boardSnapshots.map(snapshot => ({ snapshot }));
}
