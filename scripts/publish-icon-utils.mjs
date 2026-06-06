import sharp from 'sharp';

const SUBTYPE_ICON_SCALE = 0.28;
const defaultSubtypeComposeWebpOptions = { lossless: true, quality: 100, effort: 6 };

export async function composeSubtypeIcon(baseIconContent, subTypeIconContent, webpOptions = defaultSubtypeComposeWebpOptions) {
    const normalizedBaseContent = Buffer.isBuffer(baseIconContent)
        ? baseIconContent
        : Buffer.from(baseIconContent ?? []);
    const normalizedSubTypeContent = Buffer.isBuffer(subTypeIconContent)
        ? subTypeIconContent
        : Buffer.from(subTypeIconContent ?? []);

    if (normalizedBaseContent.length === 0 || normalizedSubTypeContent.length === 0) {
        return normalizedBaseContent;
    }

    const baseMetadata = await sharp(normalizedBaseContent).metadata();
    if (!baseMetadata.width || !baseMetadata.height) {
        return normalizedBaseContent;
    }

    const subTypeMetadata = await sharp(normalizedSubTypeContent).metadata();
    if (!subTypeMetadata.width || !subTypeMetadata.height) {
        return normalizedBaseContent;
    }

    const overlayWidth = Math.max(1, Math.round(baseMetadata.width * SUBTYPE_ICON_SCALE));
    const overlayHeight = Math.max(1, Math.round(baseMetadata.height * SUBTYPE_ICON_SCALE));
    const overlayInput = await sharp(normalizedSubTypeContent)
        .resize({
            width: overlayWidth,
            height: overlayHeight,
            fit: 'inside',
            withoutEnlargement: false,
        })
        .png()
        .toBuffer();

    return sharp(normalizedBaseContent)
        .composite([{ input: overlayInput, left: 0, top: 0 }])
        .webp(webpOptions)
        .toBuffer();
}