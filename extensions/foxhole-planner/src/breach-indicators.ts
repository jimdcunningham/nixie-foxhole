/** Shared V1/V2 classification of authored bunker faces. */
export function isFoxholeBunkerSocketUnbreachable(options: {
    selfBreachable: boolean;
    selfStructuralGarrison: boolean;
    selfExposed?: boolean;
    neighborBreachable: boolean;
    neighborStructuralGarrison: boolean;
    neighborExposed?: boolean;
    connectionCount: number;
}): boolean {
    if (!options.selfBreachable || options.selfExposed === true || options.connectionCount !== 1
        || !options.neighborBreachable || options.neighborExposed === true) {
        return false;
    }
    return !(options.neighborStructuralGarrison && options.selfStructuralGarrison === options.neighborStructuralGarrison);
}

export function isFoxholeBreachIndicatorSocket(
    structure: { breachable?: boolean | null; isDestroyed?: boolean | null; isBreached?: boolean | null; },
    socket: { integrityBonus?: boolean | null; breachFace?: boolean | null; },
): boolean {
    return structure.breachable === true && structure.isDestroyed !== true && structure.isBreached !== true
        && socket.integrityBonus !== false && socket.breachFace === true;
}
