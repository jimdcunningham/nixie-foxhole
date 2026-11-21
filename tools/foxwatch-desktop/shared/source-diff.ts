import { diffLines } from 'diff';

export interface SourceObject { start: number; end: number }
export interface SourcePart {
  kind: 'context' | 'removed' | 'added';
  before: number;
  after: number;
  lines: string[];
  object?: SourceObject;
}
export interface ManifestSource {
  parts: SourcePart[];
  unavailable: boolean;
  limited: boolean;
}

function addObjectRanges(lines: string[], changed: Map<number, SourcePart>) {
  const stack: { range: SourceObject; parent: SourceObject | undefined }[] = [];
  let object: SourceObject | undefined;
  for (const [index, text] of lines.entries()) {
    const line = index + 1;
    const part = changed.get(line);
    if (part && object) part.object = object;
    if (/^[}\]]/.test(text.trimStart())) {
      const closed = stack.pop();
      if (closed) {
        closed.range.end = line;
        object = closed.parent;
      }
    } else if (text.endsWith('{') || text.endsWith('[')) {
      const range = { start: line, end: lines.length };
      stack.push({ range, parent: object });
      if (text.endsWith('{')) object = range;
    }
  }
}

/** Numbers refer to the two indented source documents. Fields has a separate semantic comparison. */
export function compareManifestSource(before: string | null, after: string | null, comparable: boolean): ManifestSource {
  const result: ManifestSource = { parts: [], unavailable: !comparable, limited: false };
  if (!comparable) return result;
  const format = (source: string | null) => source === null ? '' : JSON.stringify(JSON.parse(source), null, 2) + '\n';
  let oldText: string, nextText: string;
  try {
    oldText = format(before);
    nextText = format(after);
  } catch {
    return { ...result, unavailable: true };
  }
  if (oldText === nextText) return result;
  if (oldText.length + nextText.length > 32 * 1024 * 1024) return { ...result, limited: true };
  const changes = diffLines(oldText, nextText, { timeout: 8000 });
  if (!changes) return { ...result, limited: true };

  let oldLine = 1, nextLine = 1;
  for (const part of changes) {
    if (!part.value) continue;
    const lines = part.value.slice(0, -1).split('\n');
    const kind = part.added ? 'added' : part.removed ? 'removed' : 'context';
    result.parts.push({ kind, before: oldLine, after: nextLine, lines });
    if (kind !== 'added') oldLine += lines.length;
    if (kind !== 'removed') nextLine += lines.length;
  }
  for (const [kind, text, side] of [['removed', oldText, 'before'], ['added', nextText, 'after']] as const) {
    const changed = new Map(result.parts.filter(part => part.kind === kind).map(part => [part[side], part]));
    if (changed.size) addObjectRanges(text.slice(0, -1).split('\n'), changed);
  }
  return result;
}
