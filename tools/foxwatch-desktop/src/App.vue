<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
} from 'vue';
import type { AssetDetails, AssetEntry, AssetRoot } from '../shared/contracts';
import Icon from './Icon.vue';

interface TreeRow extends AssetEntry {
  depth: number;
}
const root = shallowRef<AssetRoot | null>(null);
const children = ref(new Map<string, AssetEntry[]>());
const expanded = ref(new Set<string>());
const pending = ref(new Set<string>());
const details = shallowRef<AssetDetails | null>(null);
const selected = ref('');
const focused = ref('');
const error = ref('');
const inspecting = ref(false);
const sidebar = ref(true);
const sidebarWidth = ref(
  Math.max(
    220,
    Math.min(520, Number(localStorage.getItem('foxwatch.sidebarWidth')) || 300),
  ),
);
const tree = ref<HTMLElement>();
const scrollTop = ref(0);
const viewportHeight = ref(600);
const rowHeight = 26;
let selectionVersion = 0;
let listingVersion = 0;
let observer: ResizeObserver | undefined;
const unsubscribe: Array<() => void> = [];

const rows = computed(() => {
  const result: TreeRow[] = [];
  const visit = (parent: string, depth: number) => {
    for (const entry of children.value.get(parent) ?? []) {
      result.push({ ...entry, depth });
      if (entry.directory && expanded.value.has(entry.path))
        visit(entry.path, depth + 1);
    }
  };
  visit('', 0);
  return result;
});
const firstRow = computed(() =>
  Math.max(0, Math.floor(scrollTop.value / rowHeight) - 8),
);
const visibleRows = computed(() =>
  rows.value.slice(
    firstRow.value,
    firstRow.value + Math.ceil(viewportHeight.value / rowHeight) + 16,
  ),
);
const kindLabels: Record<string, string> = {
  image: 'Image',
  model: '3D Model',
  data: 'Data',
  text: 'Text',
  audio: 'Audio',
  file: 'File',
};
const selectedLabel = computed(
  () =>
    details.value?.label ??
    rows.value.find((row) => row.path === selected.value)?.label ??
    '',
);
const formatBytes = (bytes: number) =>
  bytes < 1024
    ? `${bytes.toLocaleString()} B`
    : bytes < 1024 ** 2
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 ** 2).toFixed(2)} MB`;
const modifiedDate = computed(() =>
  details.value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(details.value.modifiedAt))
    : '',
);
const message = (cause: unknown) =>
  String(cause instanceof Error ? cause.message : cause).replace(
    /^Error invoking remote method '[^']+': Error: /,
    '',
  );

async function load(parent: string, force = false): Promise<void> {
  const current = root.value;
  if (
    !current ||
    pending.value.has(parent) ||
    (!force && children.value.has(parent))
  )
    return;
  const version = listingVersion;
  pending.value.add(parent);
  try {
    const entries = await window.foxwatch.list(current.id, parent);
    if (root.value?.id === current.id && version === listingVersion)
      children.value.set(parent, entries);
  } catch (cause) {
    if (root.value?.id === current.id && version === listingVersion)
      error.value = message(cause);
  } finally {
    if (root.value?.id === current.id && version === listingVersion)
      pending.value.delete(parent);
  }
}
async function setRoot(value: AssetRoot) {
  if (root.value?.id === value.id) return;
  selectionVersion++;
  listingVersion++;
  root.value = value;
  children.value = new Map();
  expanded.value = new Set();
  pending.value = new Set();
  details.value = null;
  selected.value = '';
  focused.value = '';
  error.value = '';
  inspecting.value = false;
  scrollTop.value = 0;
  if (tree.value) tree.value.scrollTop = 0;
  await load('');
}
async function chooseRoot() {
  try {
    const value = await window.foxwatch.chooseRoot();
    if (value) await setRoot(value);
  } catch (cause) {
    error.value = message(cause);
  }
}
async function activate(row: TreeRow) {
  focused.value = row.path;
  error.value = '';
  if (row.directory) {
    if (expanded.value.has(row.path)) expanded.value.delete(row.path);
    else {
      expanded.value.add(row.path);
      await load(row.path);
    }
    return;
  }
  const current = root.value;
  if (!current) return;
  const version = ++selectionVersion;
  selected.value = row.path;
  details.value = null;
  inspecting.value = true;
  try {
    const value = await window.foxwatch.inspect(current.id, row.path);
    if (version === selectionVersion && root.value?.id === current.id)
      details.value = value;
  } catch (cause) {
    if (version === selectionVersion) error.value = message(cause);
  } finally {
    if (version === selectionVersion) inspecting.value = false;
  }
}
async function refresh() {
  if (!root.value) return;
  const current = root.value.id;
  const open = [...expanded.value].sort(
    (a, b) => a.split('/').length - b.split('/').length,
  );
  selectionVersion++;
  listingVersion++;
  inspecting.value = false;
  pending.value = new Set();
  error.value = '';
  children.value = new Map();
  await load('', true);
  if (root.value?.id !== current) return;
  for (const folder of open) {
    if (root.value?.id !== current) return;
    if (rows.value.some((row) => row.path === folder)) await load(folder, true);
    else expanded.value.delete(folder);
  }
  const row = rows.value.find((row) => row.path === selected.value);
  if (row) await activate(row);
  else {
    selectionVersion++;
    details.value = null;
    selected.value = '';
    inspecting.value = false;
  }
}
async function reveal(path: string) {
  if (!root.value) return;
  try {
    await window.foxwatch.reveal(root.value.id, path);
  } catch (cause) {
    error.value = message(cause);
  }
}
async function showContext(path: string) {
  if (!root.value) return;
  try {
    await window.foxwatch.contextMenu(root.value.id, path);
  } catch (cause) {
    error.value = message(cause);
  }
}
function focusRow(path: string) {
  focused.value = path;
  const index = rows.value.findIndex((row) => row.path === path);
  if (index < 0 || !tree.value) return;
  const row = rows.value[index]!;
  if (!row.directory && selected.value !== path) void activate(row);
  const top = index * rowHeight;
  if (top < tree.value.scrollTop) tree.value.scrollTop = top;
  else if (top + rowHeight > tree.value.scrollTop + tree.value.clientHeight)
    tree.value.scrollTop = top + rowHeight - tree.value.clientHeight;
}
async function navigate(event: KeyboardEvent) {
  if (!rows.value.length) return;
  const index = Math.max(
    0,
    rows.value.findIndex((row) => row.path === focused.value),
  );
  const row = rows.value[index]!;
  const key = event.key;
  if (
    ![
      'ArrowDown',
      'ArrowUp',
      'ArrowLeft',
      'ArrowRight',
      'Home',
      'End',
      'Enter',
      ' ',
    ].includes(key)
  )
    return;
  event.preventDefault();
  if (key === 'ArrowDown')
    focusRow(rows.value[Math.min(index + 1, rows.value.length - 1)]!.path);
  if (key === 'ArrowUp') focusRow(rows.value[Math.max(index - 1, 0)]!.path);
  if (key === 'Home') focusRow(rows.value[0]!.path);
  if (key === 'End') focusRow(rows.value.at(-1)!.path);
  if (key === 'Enter' || key === ' ') await activate(row);
  if (key === 'ArrowRight' && row.directory) {
    if (!expanded.value.has(row.path)) await activate(row);
    else if (rows.value[index + 1]?.depth === row.depth + 1)
      focusRow(rows.value[index + 1]!.path);
  }
  if (key === 'ArrowLeft') {
    if (row.directory && expanded.value.has(row.path))
      expanded.value.delete(row.path);
    else if (row.depth) focusRow(row.path.slice(0, row.path.lastIndexOf('/')));
  }
}
function resize(event: PointerEvent) {
  const element = event.currentTarget as HTMLElement;
  element.setPointerCapture(event.pointerId);
  const move = (pointer: PointerEvent) => {
    sidebarWidth.value = Math.max(
      220,
      Math.min(Math.min(520, window.innerWidth - 360), pointer.clientX),
    );
  };
  const stop = () => {
    element.removeEventListener('pointermove', move);
    localStorage.setItem('foxwatch.sidebarWidth', String(sidebarWidth.value));
  };
  element.addEventListener('pointermove', move);
  element.addEventListener('lostpointercapture', stop, { once: true });
}
function resizeByKey(event: KeyboardEvent) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  sidebarWidth.value = Math.max(
    220,
    Math.min(520, sidebarWidth.value + (event.key === 'ArrowLeft' ? -20 : 20)),
  );
  localStorage.setItem('foxwatch.sidebarWidth', String(sidebarWidth.value));
}
onMounted(async () => {
  unsubscribe.push(
    window.foxwatch.onRootChanged((value) => void setRoot(value)),
    window.foxwatch.onRefresh(() => void refresh()),
    window.foxwatch.onToggleSidebar(() => {
      sidebar.value = !sidebar.value;
    }),
  );
  try {
    const value = await window.foxwatch.getRoot();
    if (value) await setRoot(value);
  } catch (cause) {
    error.value = message(cause);
  }
  await nextTick();
  observer = new ResizeObserver((entries) => {
    viewportHeight.value = entries[0]?.contentRect.height ?? 600;
  });
  if (tree.value) observer.observe(tree.value);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  unsubscribe.forEach((stop) => stop());
});
</script>

<template>
  <main class="workspace" :style="{ '--sidebar-width': `${sidebarWidth}px` }">
    <div class="panes">
      <aside v-show="sidebar" class="sidebar" aria-label="Assets">
        <header class="sidebar-header">
          <span>Assets</span>
          <div class="toolbar">
            <button
              title="Open Assets Directory (Ctrl+O)"
              aria-label="Open Assets Directory"
              @click="chooseRoot"
            >
              <Icon name="folder-open" />
            </button>
            <button
              title="Refresh Assets (Ctrl+R)"
              aria-label="Refresh Assets"
              :disabled="!root"
              @click="refresh"
            >
              <Icon name="refresh" />
            </button>
            <button
              title="Collapse Folders"
              aria-label="Collapse Folders"
              :disabled="!expanded.size"
              @click="expanded.clear()"
            >
              <Icon name="collapse" />
            </button>
          </div>
        </header>
        <button
          v-if="root"
          class="root-row"
          :title="root.path"
          @contextmenu.prevent="showContext('')"
          @click="showContext('')"
        >
          <Icon name="folder" /><strong>{{ root.name }}</strong>
        </button>
        <div
          ref="tree"
          class="tree"
          role="tree"
          aria-label="Asset Files"
          tabindex="0"
          :aria-activedescendant="
            focused ? `entry-${encodeURIComponent(focused)}` : undefined
          "
          @keydown="navigate"
          @scroll="scrollTop = ($event.target as HTMLElement).scrollTop"
          @focus="focused ||= rows[0]?.path ?? ''"
        >
          <div
            class="tree-content"
            :style="{ height: `${rows.length * rowHeight}px` }"
          >
            <div
              v-for="(row, index) in visibleRows"
              :id="`entry-${encodeURIComponent(row.path)}`"
              :key="row.path"
              class="tree-row"
              :class="{
                selected: selected === row.path,
                focused: focused === row.path,
                directory: row.directory,
              }"
              role="treeitem"
              :aria-level="row.depth + 1"
              :aria-selected="selected === row.path"
              :aria-expanded="
                row.directory ? expanded.has(row.path) : undefined
              "
              :style="{
                top: `${(firstRow + index) * rowHeight}px`,
                paddingLeft: `${10 + row.depth * 16}px`,
              }"
              :title="
                row.label === row.name ? row.path : `${row.label}\n${row.path}`
              "
              @click="
                tree?.focus();
                activate(row);
              "
              @contextmenu.prevent="
                focused = row.path;
                showContext(row.path);
              "
            >
              <Icon
                v-if="row.directory"
                name="chevron"
                :size="12"
                class="chevron"
                :class="{ expanded: expanded.has(row.path) }"
              /><span v-else class="chevron-space" />
              <Icon
                :name="
                  row.directory
                    ? expanded.has(row.path)
                      ? 'folder-open'
                      : 'folder'
                    : row.kind
                "
                class="entry-icon"
              />
              <span class="entry-label">{{ row.label }}</span
              ><span
                v-if="pending.has(row.path)"
                class="loading-dot"
                aria-label="Loading"
              />
            </div>
          </div>
          <p v-if="pending.has('')" class="tree-message">Loading assets…</p>
          <p v-else-if="root && !rows.length" class="tree-message">
            This folder is empty.
          </p>
          <div v-else-if="!root" class="tree-empty">
            <p>No directory open.</p>
            <button class="text-button" @click="chooseRoot">
              Open Assets Directory
            </button>
          </div>
        </div>
      </aside>
      <div
        v-if="sidebar"
        class="separator"
        role="separator"
        aria-label="Sidebar Width"
        aria-orientation="vertical"
        :aria-valuenow="sidebarWidth"
        aria-valuemin="220"
        aria-valuemax="520"
        tabindex="0"
        @pointerdown="resize"
        @keydown="resizeByKey"
      />
      <section class="inspector" aria-label="Asset Inspector">
        <header class="inspector-header">
          <div v-if="selected" class="file-heading">
            <Icon :name="details?.kind ?? 'file'" /><span>{{
              selectedLabel
            }}</span>
          </div>
          <span v-else class="muted">Asset Inspector</span>
          <span v-if="details" class="format-tag">{{ details.extension }}</span>
        </header>
        <div v-if="error" class="error-banner" role="alert">
          <span>{{ error }}</span
          ><button aria-label="Dismiss Error" @click="error = ''">
            <Icon name="close" :size="14" />
          </button>
        </div>
        <div v-if="details" class="file-inspector">
          <div class="breadcrumbs" :title="details.path">
            {{ root?.name }}<span>/</span
            >{{ details.path.split('/').slice(0, -1).join(' / ')
            }}<span v-if="details.path.includes('/')">/</span
            ><strong>{{ details.label }}</strong>
          </div>
          <div class="preview-placeholder">
            <div class="placeholder-icon">
              <Icon :name="details.kind" :size="48" />
            </div>
            <h1>{{ details.label }}</h1>
            <p>{{ kindLabels[details.kind] }} preview</p>
            <span class="preview-note"
              >Preview support is coming in a future update.</span
            >
          </div>
          <div class="file-properties">
            <dl>
              <div>
                <dt>File Type</dt>
                <dd>
                  {{ kindLabels[details.kind] }} · {{ details.extension }}
                </dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd :title="`${details.bytes.toLocaleString()} bytes`">
                  {{ formatBytes(details.bytes) }}
                </dd>
              </div>
              <div>
                <dt>Modified</dt>
                <dd>{{ modifiedDate }}</dd>
              </div>
            </dl>
            <div class="path-row">
              <span>Location</span
              ><span class="file-path" :title="details.absolutePath">{{
                details.absolutePath
              }}</span
              ><button class="text-button" @click="reveal(details.path)">
                Show in Explorer
              </button>
            </div>
          </div>
        </div>
        <div v-else class="empty-inspector">
          <Icon :name="inspecting ? 'file' : 'folder-open'" :size="44" />
          <h1>{{ inspecting ? 'Opening Asset…' : 'Select an Asset' }}</h1>
          <p>
            {{
              inspecting ? selected : 'Browse the directory to inspect a file.'
            }}
          </p>
          <button v-if="!root" class="primary-button" @click="chooseRoot">
            Open Assets Directory
          </button>
        </div>
      </section>
    </div>
    <footer class="status-bar">
      <span :title="root?.path">{{
        root ? root.path : 'No directory open'
      }}</span
      ><span
        >{{ root ? `${rows.length.toLocaleString()} visible entries` : ''
        }}<span class="status-divider" />Read Only</span
      >
    </footer>
  </main>
</template>
