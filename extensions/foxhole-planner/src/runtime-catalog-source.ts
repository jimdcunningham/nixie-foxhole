let text: string | undefined;

export function setPlannerCatalogText(catalogText: string | undefined): void {
    text = catalogText;
}

export function takePlannerCatalogText(): string | undefined {
    const catalogText = text;
    text = undefined;
    return catalogText;
}
