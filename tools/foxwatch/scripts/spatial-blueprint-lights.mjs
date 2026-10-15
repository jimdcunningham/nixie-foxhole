import { createHash } from 'node:crypto';

const linear = n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
const bounded = (value, min, max, label) => {
    if (!Number.isFinite(value) || value < min || value > max) throw Error('Invalid blueprint light ' + label);
    return value;
};
// CIE 1960 blackbody approximation, converted from XYZ to linear sRGB.
function temperatureColor(kelvin) {
    const t = Math.max(1000, Math.min(15000, kelvin)), t2 = t * t;
    const u = (.860117757 + 1.54118254e-4 * t + 1.28641212e-7 * t2) / (1 + 8.42420235e-4 * t + 7.08145163e-7 * t2);
    const v = (.317398726 + 4.22806245e-5 * t + 4.20481691e-8 * t2) / (1 - 2.89741816e-5 * t + 1.61456053e-7 * t2);
    const d = 2 * u - 8 * v + 4, x = 3 * u / d, y = 2 * v / d;
    const X = x / y, Z = (1 - x - y) / y;
    const rgb = [3.2406 * X - 1.5372 - .4986 * Z, -.9689 * X + 1.8758 + .0415 * Z, .0557 * X - .204 + 1.057 * Z].map(n => Math.max(0, n));
    const peak = Math.max(...rgb, 1); return rgb.map(n => n / peak);
}

/** Preserve source photometry and publish genuine glTF punctual lights beside the baked meshes. */
export function attachSpatialBlueprintLights(document, exported) {
    const rows = exported.blueprintLights ?? [];
    if (!Array.isArray(rows) || rows.length > 64) throw Error('Invalid blueprint light budget');
    if (!rows.length) return 0;
    document.nodes ??= []; document.extensions ??= {};
    if (document.extensions.KHR_lights_punctual) throw Error('Unexpected pre-existing model light definitions');
    const lights = [];
    for (const row of rows) {
        const source = row.source;
        if (!source || !['point', 'spot'].includes(source.type)) throw Error('Unsupported blueprint light type');
        const vector = (value, label) => {
            if (!Array.isArray(value) || value.length !== 3) throw Error('Invalid blueprint light ' + label);
            return value.map(n => bounded(n, -1e6, 1e6, label));
        };
        const translation = vector(row.translation, 'position'), direction = vector(row.direction, 'direction');
        const magnitude = Math.hypot(...direction);
        if (magnitude < 1e-8) throw Error('Invalid blueprint light direction');
        const forward = direction.map(n => n / magnitude);
        const range = bounded(source.attenuationRadius, .001, 1e7, 'range') / 100;
        const outer = bounded(source.outerConeAngle ?? 44, .01, 89.9, 'outer cone') * Math.PI / 180;
        const inner = Math.min(outer - 1e-6, bounded(source.innerConeAngle ?? 0, 0, 89.9, 'inner cone') * Math.PI / 180);
        const intensity = bounded(source.intensity, 0, 1e9, 'intensity');
        let candela;
        if (source.useInverseSquaredFalloff === false) {
            // glTF has inverse-square falloff only. Match the authored custom curve at
            // half its attenuation radius; retain the exact original data for future renderers.
            const exponent = bounded(source.lightFalloffExponent ?? 8, 0, 64, 'falloff');
            candela = intensity * .75 ** exponent * (range / 2) ** 2 / (1 - .5 ** 4) ** 2;
        } else {
            const solidAngle = source.type === 'spot' ? 2 * Math.PI * (1 - Math.cos(outer)) : 4 * Math.PI;
            switch (source.intensityUnits ?? 'Unitless') {
                case 'Candelas': candela = intensity; break;
                case 'Lumens': candela = intensity / solidAngle; break;
                case 'Unitless': candela = intensity / 625; break;
                default: throw Error('Unsupported blueprint intensity units: ' + source.intensityUnits);
            }
        }
        const tint = vector(source.color ?? [1,1,1], 'color').map(n => linear(bounded(n, 0, 1, 'color')));
        const temperature = source.useTemperature ? temperatureColor(bounded(source.temperature, 1, 1e6, 'temperature')) : [1,1,1];
        const light = { name: row.name, type: source.type, color: tint.map((n,i) => n * temperature[i]), range,
            intensity: source.enabled === false ? 0 : candela,
            ...(source.type === 'spot' ? {spot: {outerConeAngle: outer, innerConeAngle: Math.max(0, inner)}} : {}) };
        const cross = [forward[1], -forward[0], 0], w = 1 - forward[2];
        const quaternion = w < 1e-8 ? [1,0,0,0] : [...cross,w].map(n => n / Math.hypot(...cross,w));
        const name = 'blueprint-light-' + createHash('sha256').update(String(row.name)).digest('hex').slice(0,20);
        const node = {name,translation,rotation:quaternion,extensions:{KHR_lights_punctual:{light:lights.length}},
            extras:{nixieBlueprintLight:{version:1,source,sourceName:row.name,candela,
                ...(source.useInverseSquaredFalloff === false ? {falloffApproximation:'inverse-square-midpoint'} : {})}}};
        if (source.enabled === false) node.extensions.KHR_node_visibility = {visible:false};
        const index = document.nodes.length; document.nodes.push(node); lights.push(light);
        const groupName = row.group && exported.semanticGroups?.[row.group];
        const parent = groupName && document.nodes.find(n => n.name === groupName);
        if (row.group && !parent) throw Error('Missing blueprint light visibility group: ' + row.group);
        if (parent) (parent.children ??= []).push(index);
        else (document.scenes[document.scene ?? 0].nodes ??= []).push(index);
    }
    document.extensions.KHR_lights_punctual = {lights};
    document.extensionsUsed = [...new Set([...document.extensionsUsed ?? [],'KHR_lights_punctual','KHR_node_visibility'])];
    return lights.length;
}
