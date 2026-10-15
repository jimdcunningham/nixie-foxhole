const DEFAULT_GAME_ASSET_KEYS = [
    'baseIcon',
    'icon',
    'texture',
    'textureBorder',
    'textureFrontCap',
    'textureBackCap',
    'texturePost',
    'packaged',
];

function cloneFoxholeData(rawFoxholeData) {
    if (typeof globalThis.structuredClone === 'function') {
        return globalThis.structuredClone(rawFoxholeData);
    }

    return JSON.parse(JSON.stringify(rawFoxholeData));
}

export function createFoxholeAssetDirResolver(baseAssetsUrl) {
    const textureAssetsPath = `${String(baseAssetsUrl ?? '').replace(/\/+$/, '')}/game/Textures/`;

    return (value, dir = textureAssetsPath) => {
        const source = String(value ?? '').trim();
        if (!source) {
            return source;
        }

        const index = source.indexOf('../');
        if (index === -1) {
            return source;
        }

        return `${source.substring(0, index)}${dir}${source.substring(index + 3)}`;
    };
}

function appendAssetValue(assetList, value) {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
        return;
    }

    assetList[normalized] = normalized;
}

function addBaseGarrisonData(building, assetDir) {
    if (!building.baseGarrisonRadius) {
        return;
    }

    const garrisonData = {
        baseUpgrades: {
            base: {
                provisional_garrison: {
                    name: 'Provisional Garrison',
                    description: 'A Provisional Garrison connects this base to nearby defensive structures. Defensive structures will deactivate if player activity is too low. This also allows Towns to be claimed towards the victory condition.',
                    icon: assetDir('../UI/Menus/IconFacilitiesProvisionalGarrison.webp'),
                    ranges: [{ type: 'garrison', max: building.baseGarrisonRadius }],
                },
                small_garrison: {
                    name: 'Small Garrison',
                    description: 'A Small Garrison permanently connects this base to nearby defensive structures. A Small Garrison is required for upgrading the base to Tier 2.',
                    icon: assetDir('../UI/Menus/IconFacilitiesSmallGarrison.webp'),
                    ranges: [{ type: 'garrison', max: building.baseGarrisonRadius }],
                },
                large_garrison: {
                    name: 'Large Garrison',
                    description: 'A Large Garrison permanently connects this base to nearby defensive structures. A Large Garrison required for upgrading the base to Tier 3.',
                    icon: assetDir('../UI/Menus/IconFacilitiesLargeGarrison.webp'),
                    ranges: [{ type: 'garrison', max: building.baseGarrisonRadius }],
                },
            },
        },
    };

    if (Array.isArray(building.baseGarrisonTypes)) {
        for (const key of Object.keys(garrisonData.baseUpgrades.base)) {
            if (!building.baseGarrisonTypes.includes(key)) {
                delete garrisonData.baseUpgrades.base[key];
            }
        }
    }

    Object.assign(building, garrisonData);
}

function appendGameAssets(data, assetDir, assetList, gameAssetKeys) {
    if (!data || typeof data !== 'object') {
        return;
    }

    if (Array.isArray(data.sockets)) {
        for (const socket of data.sockets) {
            if (socket.texture) {
                socket.texture = assetDir(socket.texture);
                appendAssetValue(assetList, socket.texture);
            }
            if (socket.textureAlt) {
                socket.textureAlt = assetDir(socket.textureAlt);
                appendAssetValue(assetList, socket.textureAlt);
            }
        }
    }

    if (data.modslots && typeof data.modslots === 'object') {
        if (data.parent?.modslots && data.inheritModslots !== false) {
            for (const [slotKey, modslot] of Object.entries(data.parent.modslots)) {
                if (!data.modslots[slotKey]) {
                    data.modslots[slotKey] = modslot;
                } else {
                    for (const [modKey, mod] of Object.entries(modslot.mods ?? {})) {
                        if (!data.modslots[slotKey].mods?.[modKey]) {
                            data.modslots[slotKey].mods[modKey] = mod;
                        }
                    }
                }
            }
        }

        for (const [slotKey, modslot] of Object.entries(data.modslots)) {
            modslot.key = slotKey;
            for (const [modKey, mod] of Object.entries(modslot.mods ?? {})) {
                mod.key = modKey;
                if (mod.icon) {
                    mod.icon = assetDir(mod.icon);
                    appendAssetValue(assetList, mod.icon);
                }
                if (mod.texture) {
                    mod.texture = assetDir(mod.texture);
                    appendAssetValue(assetList, mod.texture);
                }
            }
        }
    }

    for (const key of gameAssetKeys) {
        let asset = data[key];
        if (!asset) {
            continue;
        }

        if (typeof asset === 'object' && !Array.isArray(asset)) {
            if (typeof asset.src === 'object' && asset.src !== null) {
                for (const [srcKey, srcValue] of Object.entries(asset.src)) {
                    asset.src[srcKey] = assetDir(srcValue);
                    appendAssetValue(assetList, asset.src[srcKey]);
                }
                continue;
            }

            asset.src = assetDir(asset.src);
            appendAssetValue(assetList, asset.src);
            continue;
        }

        asset = assetDir(asset);
        data[key] = asset;
        appendAssetValue(assetList, asset);
    }
}

function appendBuildingData(foxholeData, key, building) {
    building.key = `${key}`;

    switch (building.name) {
        case 'Safe House':
            building.description = 'A garrisoned strongpoint used in the defence of a town. Players can spawn and stockpile items here.';
            break;
        case 'Garrisoned House':
            building.description = 'An abandoned building in the world that has been fortified and garrisoned.';
            break;
    }

    if (building.production) {
        building.productionMap = {};
        if (building.power > 0) {
            building.production.hasOutput = true;
        }
        for (const recipe of building.production) {
            building.productionMap[recipe.id] = recipe;
            if (recipe.output) {
                building.production.hasOutput = true;
            }
        }
    }

    if (building.category && foxholeData.categories?.[building.category]) {
        const buildingCategory = foxholeData.categories[building.category];
        if (!buildingCategory.buildings) {
            buildingCategory.buildings = [];
        }
        buildingCategory.buildings.push(building);
    }

    if (building.canBlueprint === undefined) {
        building.canBlueprint = false;
    }
}

export function normalizeFoxholeData(rawFoxholeData, baseAssetsUrl, options = {}) {
    const foxholeData = cloneFoxholeData(rawFoxholeData);
    const assetDir = createFoxholeAssetDirResolver(baseAssetsUrl);
    const assetList = {};
    const gameAssetKeys = options.gameAssetKeys ?? DEFAULT_GAME_ASSET_KEYS;

    for (const [resourceKey, resource] of Object.entries(foxholeData.resources ?? {})) {
        resource.key = resourceKey;
        if (resource.icon) {
            resource.icon = assetDir(resource.icon);
            appendAssetValue(assetList, resource.icon);
        }
        if (resource.subIcon) {
            resource.subIcon = assetDir(resource.subIcon);
        }
    }

    for (const building of Object.values(foxholeData.buildings ?? {})) {
        if (building.parentKey) {
            let currentParent = foxholeData.buildings?.[building.parentKey];
            const parentData = currentParent ? [currentParent] : [];

            while (currentParent?.parentKey) {
                currentParent = foxholeData.buildings?.[currentParent.parentKey];
                if (!currentParent) {
                    break;
                }
                parentData.push(currentParent);
            }

            let buildingCost;
            for (const parent of parentData) {
                if (!parent?.cost) {
                    continue;
                }

                if (!buildingCost) {
                    buildingCost = Object.assign({}, building.cost);
                }

                for (const [resource, amount] of Object.entries(parent.upgradeCost ?? parent.cost)) {
                    buildingCost[resource] = (buildingCost[resource] ?? 0) + amount;
                }
            }

            if (buildingCost) {
                building.upgradeCost = building.cost;
                building.cost = buildingCost;
            }

            parentData.push(Object.assign({
                tierUp: undefined,
                tierDown: undefined,
            }, building));

            Object.assign(building, ...parentData);
            building.parent = foxholeData.buildings?.[building.parentKey];
        }

        addBaseGarrisonData(building, assetDir);

        if (building.preventOnLandscape && building.buildOnFoundation !== false) {
            building.requireFoundation = true;
        }
    }

    for (const [buildingKey, building] of Object.entries(foxholeData.buildings ?? {})) {
        appendGameAssets(building, assetDir, assetList, gameAssetKeys);
        appendBuildingData(foxholeData, buildingKey, building);

        if (!building.upgrades) {
            continue;
        }

        for (const originalUpgradeKey of Object.keys(building.upgrades)) {
            let upgradeKey = originalUpgradeKey;
            const upgrade = building.upgrades[upgradeKey];

            if (upgrade.reference) {
                continue;
            }

            appendGameAssets(upgrade, assetDir, assetList, gameAssetKeys);

            const upgradeBuilding = Object.assign({}, building, {
                hitArea: undefined,
                tierUp: undefined,
                tierDown: undefined,
            }, upgrade, {
                parentKey: undefined,
            });
            upgradeBuilding.parent = building;
            upgradeBuilding.upgradeName = upgrade.name;
            upgradeBuilding.name = upgrade.name ? `${building.name} (${upgrade.name})` : building.name;

            const parentCost = upgradeBuilding.tierDown
                ? foxholeData.buildings?.[upgradeBuilding.tierDown]?.cost
                : building.cost;
            const upgradeBuildingCost = Object.assign({}, parentCost);

            if (upgradeBuilding.cost) {
                for (const [resource, amount] of Object.entries(upgradeBuilding.cost)) {
                    upgradeBuildingCost[resource] = (upgradeBuildingCost[resource] ?? 0) + amount;
                }
            }

            upgradeBuilding.upgradeCost = upgradeBuilding.cost;
            upgradeBuilding.cost = upgradeBuildingCost;

            building.upgrades[upgradeKey] = upgradeBuilding;

            upgradeKey = `${buildingKey}_${upgradeKey}`;
            foxholeData.buildings[upgradeKey] = upgradeBuilding;
            appendBuildingData(foxholeData, upgradeKey, upgradeBuilding);
        }
    }

    for (const building of Object.values(foxholeData.buildings ?? {})) {
        if (!building.type) {
            building.type = 'building';
        }

        if (!building.upgrades) {
            continue;
        }

        for (const [upgradeKey, upgradeData] of Object.entries(building.upgrades)) {
            if (upgradeData.reference) {
                building.upgrades[upgradeKey] = foxholeData.buildings?.[upgradeData.reference];
            }
        }
    }

    for (const category of Object.values(foxholeData.categories ?? {})) {
        if (category.icon) {
            category.icon = assetDir(category.icon);
            appendAssetValue(assetList, category.icon);
        }
    }

    return {
        foxholeData,
        assetList,
    };
}
