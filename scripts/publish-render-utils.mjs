export function imageDataHasVisiblePixels(imageData) {
    for (let index = 3; index < imageData.length; index += 4) {
        if (Number(imageData[index] ?? 0) > 0) {
            return true;
        }
    }

    return false;
}