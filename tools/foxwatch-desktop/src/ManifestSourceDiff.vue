<script setup lang="ts">
import { computed, reactive } from 'vue';
import type { SourcePart } from '../shared/source-diff';

const props = defineProps<{ parts: SourcePart[]; beforeLabel: string; afterLabel: string }>();
const shownContext = reactive(new Map<number, { head: number; tail: number }>());
const shownChanges = reactive(new Map<number, number>());
const contextStep = 10;
const initialContext = 3;
const changeStep = 200;

function lineText(text: string, other?: string) {
  if (other === undefined || text.length + other.length > 8192) return { prefix: text, changed: '', suffix: '' };
  const a = Array.from(text), b = Array.from(other);
  let start = 0, end = 0;
  const min = Math.min(a.length, b.length);
  while (start < min && a[start] === b[start]) start++;
  while (end < min - start && a.at(-1 - end) === b.at(-1 - end)) end++;
  return { prefix: a.slice(0, start).join(''), changed: a.slice(start, a.length - end).join(''),
    suffix: end ? a.slice(-end).join('') : '' };
}

function rows(part: SourcePart, start: number, end: number, counterpart?: SourcePart) {
  return part.lines.slice(start, end).map((text, index) => {
    const offset = start + index;
    return {
      offset,
      before: part.kind === 'added' ? null : part.before + offset,
      after: part.kind === 'removed' ? null : part.after + offset,
      ...lineText(text, counterpart?.lines[offset]),
    };
  });
}

function overlap(part: SourcePart, edit?: SourcePart) {
  if (!edit?.object || edit.object.end - edit.object.start >= 2000) return null;
  const base = edit.kind === 'removed' ? part.before : part.after;
  const start = Math.max(0, edit.object.start - base);
  const end = Math.min(part.lines.length, edit.object.end - base + 1);
  return start < end ? { start, end } : null;
}

const sections = computed(() => props.parts.map((part, index) => {
  const previous = props.parts[index - 1], next = props.parts[index + 1];
  if (part.kind !== 'context') {
    const candidate = part.kind === 'added' ? previous : next;
    const counterpart = candidate && candidate.kind !== 'context' && candidate.kind !== part.kind &&
      candidate.lines.length === part.lines.length ? candidate : undefined;
    const end = shownChanges.get(index) ?? changeStep;
    return { kind: part.kind, index, top: rows(part, 0, end, counterpart),
      bottom: [], hidden: Math.max(0, part.lines.length - end) };
  }
  const expansion = shownContext.get(index);
  const head = Math.min(part.lines.length, previous ? initialContext + (expansion?.head ?? 0) : 0);
  const tail = Math.max(head, part.lines.length - (next ? initialContext + (expansion?.tail ?? 0) : 0));
  const hidesObject = (edit?: SourcePart) => {
    const range = overlap(part, edit);
    return !!range && Math.max(head, range.start) < Math.min(tail, range.end);
  };
  return { kind: part.kind, index, top: rows(part, 0, head), bottom: rows(part, tail, part.lines.length),
    hidden: tail - head, previous: !!previous, next: !!next, objectAbove: hidesObject(previous), objectBelow: hidesObject(next) };
}));

function expand(index: number, side: 'head' | 'tail') {
  const current = shownContext.get(index) ?? { head: 0, tail: 0 };
  shownContext.set(index, { ...current, [side]: current[side] + contextStep });
}

function showObject(index: number) {
  const chosen = props.parts[index];
  if (!chosen?.object) return;
  for (const [gap, part] of props.parts.entries()) {
    if (part.kind !== 'context') continue;
    const range = overlap(part, chosen);
    if (!range) continue;
    const current = shownContext.get(gap) ?? { head: 0, tail: 0 };
    if (gap < index) current.tail = Math.max(current.tail, part.lines.length - range.start - initialContext);
    else current.head = Math.max(current.head, range.end - initialContext);
    shownContext.set(gap, current);
  }
}
</script>

<template>
  <div class="source-diff" role="region" aria-label="Source Changes" tabindex="0">
    <div class="source-inline">
      <header class="source-columns">
        <span :title="beforeLabel">Old</span><span :title="afterLabel">New</span><span />
        <span>Formatted JSON</span>
      </header>
      <template v-for="section in sections" :key="section.index">
        <div v-for="row in section.top" :key="row.offset" class="source-line" :class="'source-' + section.kind">
          <span class="source-number">{{ row.before }}</span><span class="source-number">{{ row.after }}</span>
          <span class="source-gutter">{{ section.kind === 'removed' ? '−' : section.kind === 'added' ? '+' : '' }}</span>
          <code class="source-code">{{ row.prefix }}<mark v-if="row.changed">{{ row.changed }}</mark>{{ row.suffix }}</code>
        </div>
        <div v-if="section.hidden && section.kind === 'context'" class="source-gap">
          <div class="source-gap-actions">
            <span>{{ section.hidden.toLocaleString() }} Unchanged Lines</span>
            <button v-if="section.previous" type="button" @click="expand(section.index, 'head')"
              title="Show more lines after the previous change">↓ Show {{ Math.min(contextStep, section.hidden) }} Lines</button>
            <button v-if="section.next" type="button" @click="expand(section.index, 'tail')"
              title="Show more lines before the next change">↑ Show {{ Math.min(contextStep, section.hidden) }} Lines</button>
            <button v-if="section.objectAbove" type="button" @click="showObject(section.index - 1)">Show Object Above</button>
            <button v-if="section.objectBelow" type="button" @click="showObject(section.index + 1)">Show Object Below</button>
          </div>
        </div>
        <div v-else-if="section.hidden" class="source-gap">
          <div class="source-gap-actions">
            <button type="button" @click="shownChanges.set(section.index, (shownChanges.get(section.index) ?? changeStep) + changeStep)">
              Show {{ Math.min(changeStep, section.hidden) }} More Changed Lines
            </button>
          </div>
        </div>
        <div v-for="row in section.bottom" :key="row.offset" class="source-line source-context">
          <span class="source-number">{{ row.before }}</span><span class="source-number">{{ row.after }}</span>
          <span class="source-gutter" /><code class="source-code">{{ row.prefix }}</code>
        </div>
      </template>
    </div>
  </div>
</template>
