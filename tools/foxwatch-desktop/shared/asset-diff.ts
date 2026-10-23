export interface FieldChange {
  kind: 'added' | 'removed' | 'changed';
  path: string;
  before: string | null;
  after: string | null;
}
export interface ManifestDiff { changes: FieldChange[]; visited: number; limited: boolean }
const missing = Symbol('missing');
const pointer = (key: string) => key.replaceAll('~', '~0').replaceAll('/', '~1');
const printable = (value: unknown) => {
  const text = JSON.stringify(value, null, 2) ?? String(value);
  return text.length > 4000 ? text.slice(0, 4000) + '\n… Value shortened' : text;
};

/** Dictionary key order is irrelevant. Named arrays match stable identities. */
export function compareManifest(before: string | null, after: string | null): ManifestDiff {
  const a = before === null ? missing : JSON.parse(before);
  const b = after === null ? missing : JSON.parse(after);
  const result: ManifestDiff = { changes: [], visited: 0, limited: false };
  const record = (path: string, old: unknown, next: unknown) => result.changes.push({
    kind: old === missing ? 'added' : next === missing ? 'removed' : 'changed', path: path || '/',
    before: old === missing ? null : printable(old), after: next === missing ? null : printable(next),
  });
  const walk = (old: any, next: any, at: string, depth: number) => {
    if (++result.visited > 200000 || result.changes.length >= 3000 || depth > 64) { result.limited = true; return; }
    if (old === next) return;
    if (old === missing || next === missing) { record(at, old, next); return; }
    if (old !== null && next !== null && typeof old === 'object' && typeof next === 'object' && Array.isArray(old) === Array.isArray(next)) {
      if (Array.isArray(old)) {
        const identity = ['id', 'key', 'path', 'name'].find(key => [old, next].every(rows =>
          rows.every((row: any) => row && typeof row === 'object' && ['string','number'].includes(typeof row[key])) &&
          new Set(rows.map((row: any) => row[key])).size === rows.length));
        if (identity && (old.length || next.length)) {
          const previous = new Map(old.map((row: any) => [row[identity], row]));
          const current = new Map(next.map((row: any) => [row[identity], row]));
          const oldOrder = old.map((row: any) => row[identity]).filter((id: any) => current.has(id));
          const newOrder = next.map((row: any) => row[identity]).filter((id: any) => previous.has(id));
          if (JSON.stringify(oldOrder) !== JSON.stringify(newOrder)) record(at + '/(order)', oldOrder, newOrder);
          for (const id of new Set([...previous.keys(), ...current.keys()])) {
            if (result.limited) break;
            walk(previous.has(id) ? previous.get(id) : missing, current.has(id) ? current.get(id) : missing, at + '/[' + identity + '=' + pointer(String(id)) + ']', depth + 1);
          }
          return;
        }
      }
      for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
        if (result.limited) break;
        walk(Object.hasOwn(old, key) ? old[key] : missing, Object.hasOwn(next, key) ? next[key] : missing, at + '/' + pointer(key), depth + 1);
      }
    } else record(at, old, next);
  };
  walk(a, b, '', 0);
  return result;
}

/** Compare visible RGBA values, ignoring RGB garbage in fully transparent pixels. */
export function pixelDifference(before: Uint8ClampedArray, after: Uint8ClampedArray) {
  if (before.length !== after.length || before.length % 4) throw new Error('Pixel buffers must have matching dimensions.');
  const pixels = new Uint8ClampedArray(before.length);
  let changed = 0, maximum = 0;
  for (let i = 0; i < before.length; i += 4) {
    const a = before[i + 3]! / 255, b = after[i + 3]! / 255;
    const difference = Math.max(Math.abs(before[i]! * a - after[i]! * b), Math.abs(before[i + 1]! * a - after[i + 1]! * b), Math.abs(before[i + 2]! * a - after[i + 2]! * b), Math.abs(before[i + 3]! - after[i + 3]!));
    if (difference > 0.5) {
      changed++; maximum = Math.max(maximum, difference);
      pixels.set([255, 78, 161, Math.max(80, difference)], i);
    } else {
      const grey = after[i + 3] ? Math.round((after[i]! + after[i + 1]! + after[i + 2]!) / 3) : 0;
      pixels.set([grey, grey, grey, after[i + 3]! * 0.2], i);
    }
  }
  return { pixels, changed, total: before.length / 4, maximum };
}

export interface ModelBounds { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }
export interface PreviewCamera { yaw: number; pitch: number; distance: number; target: { x: number; y: number; z: number } }
export function unionBounds(rows: ModelBounds[]): ModelBounds {
  if (!rows.length) throw new Error('No model bounds.');
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const row of rows) for (const axis of ['x','y','z'] as const) { min[axis] = Math.min(min[axis], row.min[axis]); max[axis] = Math.max(max[axis], row.max[axis]); }
  return { min, max };
}
