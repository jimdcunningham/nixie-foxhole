export function isFoxholeModificationSlotTierEligible(componentType: string | null | undefined, tier: number | null | undefined): boolean {
    return String(componentType ?? '').trim().toLowerCase() !== 'bpfortinframodslot_c'
        || tier === 2 || tier === 3;
}
