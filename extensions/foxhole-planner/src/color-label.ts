const namedColors = [
    ['Black', '000000'], ['White', 'ffffff'], ['Gray', '808080'], ['Silver', 'c0c0c0'],
    ['Red', 'b04040'], ['Orange', 'd08040'], ['Tan', 'c2a878'], ['Brown', '705030'],
    ['Green', '408040'], ['Olive', '808040'], ['Blue', '4080c0'], ['Navy', '203060'],
    ['Teal', '408080'], ['Purple', '804080'], ['Pink', 'd080a0'], ['Ivory', 'eee8c8'],
] as const;
export function foxholeColorLabel(hex: string): string {
    const channels = (value: string) => [0, 2, 4].map(offset => Number.parseInt(value.slice(offset, offset + 2), 16));
    const rgb = channels(hex);
    if (Math.max(...rgb) - Math.min(...rgb) < 20) {
        const brightness = rgb.reduce((sum, channel) => sum + channel, 0) / 3;
        return brightness < 32 ? 'Black' : brightness > 224 ? 'White' : brightness > 160 ? 'Silver' : 'Gray';
    }
    return namedColors.reduce((best, candidate) => {
        const distance = (value: string) => channels(value).reduce((sum, channel, index) => sum + (channel - rgb[index]!) ** 2, 0);
        return distance(candidate[1]) < distance(best[1]) ? candidate : best;
    })[0];
}
