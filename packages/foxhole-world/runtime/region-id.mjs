const aliases = new Map([
    ['callahanspassagehex', 'callahans'],
    ['fishermansrowhex', 'fishermans'],
    ['weatheredexpansehex', 'weathered'],
]);

export function regionIdForKey(key) {
    return aliases.get(key.toLowerCase()) ?? key.replace(/Hex$/iu, '').toLowerCase();
}
