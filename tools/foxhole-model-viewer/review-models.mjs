/** Select base/default/upgrade resources without changing their authored placement. */
export function reviewModelPlan(dataset, assetId, selection = '') {
    const base = dataset.rows.find(row => row.id === assetId);
    if (!base) throw new Error(`No review model for ${assetId}`);
    const parts = (base.assembly?.slots ?? []).flatMap(slot => {
        const option = slot.options.find(option => option.part.resourceId === selection);
        const part = option?.part ?? slot.default;
        if (!part) return [];
        const row = dataset.rows.find(row => row.resourceId === part.resourceId);
        if (!row) throw new Error(`Missing review part ${part.resourceId}`);
        return [{ ...row, replacesBase: part.replacesBase === true }];
    });
    return [...(parts.some(part => part.replacesBase) ? [] : [base]), ...parts];
}

export function reviewAssemblyOptions(dataset, assetId) {
    const base = dataset.rows.find(row => row.id === assetId);
    return (base?.assembly?.slots ?? []).flatMap(slot => slot.options.map(option => ({
        value: option.part.resourceId, label: base.upgradeLabels?.[option.match.variantId] ?? option.match.variantId,
    })));
}
