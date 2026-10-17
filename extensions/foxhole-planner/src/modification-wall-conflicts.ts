export interface FoxholeWallModificationSlot {
    componentType?: string | null;
    linkedSocketNames?: readonly string[];
    blockedByModTypes?: readonly string[];
}

export interface FoxholeWallModificationSelection {
    slotId: string;
    variantId: string;
}

function isInfrastructure(slot: FoxholeWallModificationSlot): boolean {
    return slot.componentType?.trim().toLowerCase() === 'bpfortinframodslot_c';
}

function isFiringPort(slot: FoxholeWallModificationSlot, variantId: string): boolean {
    return slot.componentType?.trim().toLowerCase() === 'bpfortwallmodslot_c'
        && variantId.trim().toLowerCase() === 'firingport';
}

/** Only the shared wall socket conflicts; nearby wall slots remain independent. */
export function hasFoxholeSameWallModificationConflict(
    slot: FoxholeWallModificationSlot,
    variantId: string,
    slots: Readonly<Record<string, FoxholeWallModificationSlot>>,
    selections: readonly FoxholeWallModificationSelection[],
): boolean {
    const wallSockets = new Set((slot.linkedSocketNames ?? []).map(name => name.trim().toLowerCase()).filter(Boolean));
    if (!wallSockets.size) return false;
    return selections.some(selection => {
        const other = slots[selection.slotId];
        return other && ((isInfrastructure(slot) && isFiringPort(other, selection.variantId))
            || (isFiringPort(slot, variantId) && isInfrastructure(other)))
            && (other.linkedSocketNames ?? []).some(name => wallSockets.has(name.trim().toLowerCase()));
    });
}

/** Resolve older invalid plans consistently: keep the first type-compatible choice and prefer firing ports over infrastructure. */
export function filterFoxholeSameWallInfrastructureSelections<T extends FoxholeWallModificationSelection>(
    slots: Readonly<Record<string, FoxholeWallModificationSlot>>,
    selections: readonly T[],
): T[] {
    const retained: T[] = [];
    for (const selection of selections) {
        const slot = slots[selection.slotId];
        if (!slot || !hasFoxholeModificationTypeConflict(slot, selection.variantId, slots, retained)) retained.push(selection);
    }
    return retained.filter(selection => {
        const slot = slots[selection.slotId];
        return !slot || !isInfrastructure(slot)
            || !hasFoxholeSameWallModificationConflict(slot, selection.variantId, slots, selections);
    });
}

/** Source BlockedByModTypes applies across slots on the same host, excluding the slot itself. */
export function hasFoxholeModificationTypeConflict(
    slot: FoxholeWallModificationSlot,
    variantId: string,
    slots: Readonly<Record<string, FoxholeWallModificationSlot>>,
    selections: readonly FoxholeWallModificationSelection[],
): boolean {
    return selections.some(selection => {
        const other = slots[selection.slotId];
        return other && other !== slot && ((slot.blockedByModTypes ?? []).includes(selection.variantId)
            || (other.blockedByModTypes ?? []).includes(variantId));
    });
}
