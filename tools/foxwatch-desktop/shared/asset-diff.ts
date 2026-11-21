export interface FieldChange {
  kind: 'added' | 'removed' | 'changed';
  path: string;
  before: string | null;
  after: string | null;
}
export interface ManifestDiff { changes: FieldChange[]; visited: number; limited: boolean }
const missing = Symbol('missing');
const fieldPath = (parent: string, key: string) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
  ? (parent ? parent + '.' : '') + key
  : parent + '[' + JSON.stringify(key) + ']';
const identityPath = (parent: string, key: string, id: string | number) =>
  parent + '[' + key + '=' + (typeof id === 'number' || /^[A-Za-z0-9_-]+$/.test(id) ? id : JSON.stringify(id)) + ']';
const printable = (value: unknown) => {
  const text = JSON.stringify(value, null, 2) ?? String(value);
  return text.length > 4000 ? text.slice(0, 4000) + '\n… Value shortened' : text;
};

// Anchor equal entries so an insertion does not turn the rest of an array into replacements.
function arrayAnchors(before: unknown[], after: unknown[]): [number, number][] {
  const token = (value: unknown) => JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]))
      : item);
  const previous = before.map(token), current = after.map(token);
  const anchors: [number, number][] = [];
  let start = 0, oldEnd = before.length, newEnd = after.length;
  while (start < oldEnd && start < newEnd && previous[start] === current[start]) {
    anchors.push([start, start]);
    start++;
  }
  while (oldEnd > start && newEnd > start && previous[oldEnd - 1] === current[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  const width = newEnd - start + 1;
  if (width > 1 && oldEnd > start && (oldEnd - start + 1) * width <= 1_000_000) {
    const lengths = new Uint32Array((oldEnd - start + 1) * width);
    for (let a = oldEnd - 1; a >= start; a--) {
      for (let b = newEnd - 1; b >= start; b--) {
        const offset = (a - start) * width + b - start;
        lengths[offset] = previous[a] === current[b] ? lengths[offset + width + 1]! + 1
          : Math.max(lengths[offset + width]!, lengths[offset + 1]!);
      }
    }
    let a = start, b = start;
    while (a < oldEnd && b < newEnd) {
      const offset = (a - start) * width + b - start;
      if (previous[a] === current[b]) anchors.push([a++, b++]);
      else if (lengths[offset + width]! > lengths[offset + 1]!) a++;
      else b++;
    }
  }
  for (let a = oldEnd, b = newEnd; a < before.length; a++, b++) anchors.push([a, b]);
  return anchors;
}

function walkManifest(a: unknown, b: unknown, catalogReview: boolean, onChange: (
  path: string, old: unknown, next: unknown,
) => void) {
  const result = { visited: 0, limited: false };
  const maxVisited = catalogReview ? 2_000_000 : 200_000;
  let changes = 0;
  const record = (...args: Parameters<typeof onChange>) => { changes++; onChange(...args); };
  const walk = (old: any, next: any, at: string, depth: number) => {
    if (++result.visited > maxVisited || changes >= 3000 || depth > 64) { result.limited = true; return; }
    if (old === next) return;
    if (old === missing || next === missing) { record(at, old, next); return; }
    if (old !== null && next !== null && typeof old === 'object' && typeof next === 'object' && Array.isArray(old) === Array.isArray(next)) {
      if (Array.isArray(old)) {
        const identity = ['id', 'key', 'path', 'name'].find(key => [old, next].every(rows =>
          rows.every((row: any) => row && typeof row === 'object' && ['string','number'].includes(typeof row[key])) &&
          new Set(rows.map((row: any) => row[key])).size === rows.length));
        if (identity && (old.length || next.length)) {
          const previous = new Map<string | number, number>(old.map((row: any, index: number) => [row[identity], index]));
          const current = new Map<string | number, number>(next.map((row: any, index: number) => [row[identity], index]));
          const oldOrder = [...previous.keys()].filter(id => current.has(id));
          const newOrder = [...current.keys()].filter(id => previous.has(id));
          if (JSON.stringify(oldOrder) !== JSON.stringify(newOrder)) {
            const path = at ? at + '.(order)' : '(order)';
            record(path, oldOrder, newOrder);
          }
          for (const id of new Set([...previous.keys(), ...current.keys()])) {
            if (result.limited) break;
            const oldIndex = previous.get(id), newIndex = current.get(id);
            walk(oldIndex === undefined ? missing : old[oldIndex], newIndex === undefined ? missing : next[newIndex],
              identityPath(at, identity, id), depth + 1);
          }
          return;
        }
        let oldIndex = 0, newIndex = 0;
        const anchors = arrayAnchors(old, next);
        for (const [oldAnchor, newAnchor] of [...anchors, [old.length, next.length]]) {
          while (!result.limited && (oldIndex < oldAnchor || newIndex < newAnchor)) {
            const oldKey = oldIndex < oldAnchor ? oldIndex++ : undefined;
            const newKey = newIndex < newAnchor ? newIndex++ : undefined;
            walk(oldKey === undefined ? missing : old[oldKey], newKey === undefined ? missing : next[newKey],
              at + '[' + (newKey ?? oldKey) + ']', depth + 1);
          }
          if (result.limited) break;
          oldIndex = oldAnchor + 1;
          newIndex = newAnchor + 1;
        }
        return;
      }
      for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
        if (result.limited) break;
        walk(Object.hasOwn(old, key) ? old[key] : missing, Object.hasOwn(next, key) ? next[key] : missing,
          fieldPath(at, key), depth + 1);
      }
    } else record(at, old, next);
  };
  walk(a, b, '', 0);
  return result;
}

/** Dictionary key order is irrelevant. Named arrays match stable identities. */
export function compareManifest(before: string | null, after: string | null, catalogReview = false): ManifestDiff {
  const a = before === null ? missing : JSON.parse(before);
  const b = after === null ? missing : JSON.parse(after);
  const changes: FieldChange[] = [];
  const status = walkManifest(a, b, catalogReview, (path, old, next) => changes.push({
    kind: old === missing ? 'added' : next === missing ? 'removed' : 'changed', path: path || '(root)',
    before: old === missing ? null : printable(old), after: next === missing ? null : printable(next),
  }));
  return { changes, ...status };
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
