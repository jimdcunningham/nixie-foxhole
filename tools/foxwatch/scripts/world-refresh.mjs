/** Re-publish prepared world data only during a complete catalog refresh. */
export function worldRefreshArguments({input,onlyIds,limited=false}={}) {
    if (!input || onlyIds !== null || limited) return null;
    return ['--world-input', input, '--world-format', 'compact'];
}
