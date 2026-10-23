<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue';
import type {
  AssetDetails,
  AssetEntry,
  AssetRoot,
  ReviewSummary,
} from '../shared/contracts';
import Icon from './Icon.vue';
import ToolPanel from './ToolPanel.vue';
import type { AppView, RunStatus } from '../shared/monitor';
const view = ref<AppView>('inspector');
const runStatus = shallowRef<RunStatus | null>(null);
const now = ref(Date.now());
const elapsed = computed(() => runStatus.value?.startedAt ? Math.max(0, Math.floor(((runStatus.value.finishedAt ?? now.value) - runStatus.value.startedAt) / 1000)) : 0);
let clock: ReturnType<typeof setInterval>;

import AssetPreview from './AssetPreview.vue';
import PublishedLibraryDialog from './PublishedLibraryDialog.vue';
const showPublished = ref(false);
const compareAsset = ref(false);
const fileManagerName = window.foxwatch.fileManagerName;

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
const reviewSummary = shallowRef<ReviewSummary | null>(null);
const reviewBusy = ref(false),
  changesOnly = ref(false),
  reviewProgress = ref('');
const changeCount = computed(
  () =>
    (reviewSummary.value?.added ?? 0) +
    (reviewSummary.value?.modified ?? 0) +
    (reviewSummary.value?.deleted ?? 0),
);
async function runReview(action: 'approve' | 'compare' | 'discard') {
  const current = root.value;
  if (!current || reviewBusy.value) return;
  reviewBusy.value = true;
  reviewProgress.value =
    action === 'approve' ? 'Saving baseline…' : action === 'discard' ? 'Preparing to return to baseline…' : 'Comparing assets…';
  try {
    const result = await window.foxwatch.review(current.id, action);
    if (root.value?.id !== current.id) return;
    reviewSummary.value = result;
    if (action === 'discard' && !result.added && !result.modified && !result.deleted) {
      changesOnly.value = false;
      compareAsset.value = false;
    }
    await refresh(false);
  } catch (cause) {
    if (root.value?.id === current.id) error.value = message(cause);
  } finally {
    reviewBusy.value = false;
    reviewProgress.value = '';
  }
}
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
      if (changesOnly.value && !entry.change) continue;
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
    (details.value?.path === selected.value
      ? details.value.label
      : undefined) ??
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
  reviewSummary.value = null;
  compareAsset.value = false;
  changesOnly.value = false;
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
  const summary = await window.foxwatch.review(value.id, 'summary');
  if (root.value?.id === value.id) reviewSummary.value = summary;
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
async function refresh(recompare = true) {
  if (!root.value) return;
  const current = root.value.id;
  if (recompare && reviewSummary.value?.approvedAt) {
    await runReview('compare');
    return;
  }
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
  if (
    !root.value ||
    rows.value.some(
      (row) => row.path === path && row.fromBaseline && row.directory,
    )
  )
    return;
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
watch(changesOnly, () => {
  scrollTop.value = 0;
  if (tree.value) tree.value.scrollTop = 0;
  focused.value = rows.value[0]?.path ?? '';
});
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
  clock = setInterval(() => now.value = Date.now(), 1000);
  runStatus.value = await window.foxwatch.monitor.status();
  unsubscribe.push(
    window.foxwatch.monitor.onStatus(status => runStatus.value = status),
    window.foxwatch.monitor.onView(value => view.value = value),
    window.foxwatch.onPublished(() => {
      showPublished.value = true;
    }),
    window.foxwatch.onReview((action) => void runReview(action)),
    window.foxwatch.onReviewProgress((progress) => {
      reviewProgress.value = `${progress.phase} · ${progress.completed.toLocaleString()} / ${progress.total.toLocaleString()}`;
    }),
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
  clearInterval(clock);
  observer?.disconnect();
  unsubscribe.forEach((stop) => stop());
});
</script>

<template>
  <main class="workspace" :style="{ '--sidebar-width': `${sidebarWidth}px` }">
    <nav class="workspace-nav" aria-label="Workspace Views">
      <button v-for="item in ([['inspector','Assets'],['dashboard','Dashboard'],['workers','Workers & Logs']] as const)" :key="item[0]" :aria-pressed="view === item[0]" @click="view = item[0]">{{ item[1] }}</button>
      <span class="nav-spacer"/><button :aria-pressed="view === 'settings'" @click="view = 'settings'">Settings</button>
    </nav>
    <div v-show="view === 'inspector'" class="panes">
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
              title="Download Published Assets"
              aria-label="Download Published Assets"
              @click="showPublished = true"
            >
              <Icon name="download" />
            </button>
            <button
              title="Refresh Assets (Ctrl+R)"
              aria-label="Refresh Assets"
              :disabled="!root"
              @click="refresh()"
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
        <div v-if="root" class="review-controls">
          <button
            :disabled="!reviewSummary?.approvedAt || reviewBusy"
            :aria-pressed="changesOnly"
            @click="changesOnly = !changesOnly"
          >
            Changes Only
          </button>
          <button
            :disabled="!reviewSummary?.approvedAt || reviewBusy"
            title="Compare With Approved Baseline"
            @click="runReview('compare')"
          >
            <Icon name="refresh" :size="13" />
          </button>
          <span v-if="reviewBusy" role="status">{{ reviewProgress }}</span>
          <span
            v-else-if="reviewSummary?.comparedAt"
            :title="`${reviewSummary.added} added, ${reviewSummary.modified} modified, ${reviewSummary.deleted} deleted`"
            >{{ changeCount }} Changes</span
          >
          <span
            v-else
            :title="
              reviewSummary?.approvedAt
                ? 'Use Review → Compare With Approved Baseline.'
                : 'Use Review → Approve Current Assets as Baseline.'
            "
            >{{
              reviewSummary?.approvedAt ? 'Not Compared' : 'No Baseline'
            }}</span
          >
        </div>
        <div v-if="root" class="discard-controls">
          <button :disabled="!reviewSummary?.approvedAt || reviewBusy || !!runStatus?.running" @click="runReview('discard')">Return to Baseline…</button>
        </div>
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
              <span
                class="entry-label"
                :class="{
                  'deleted-name': row.change === 'deleted' && !row.directory,
                }"
                >{{ row.label }}</span
              ><span
                v-if="row.change"
                class="change-badge"
                :class="row.change"
                :title="
                  row.change.charAt(0).toUpperCase() + row.change.slice(1)
                "
                :aria-label="
                  row.change.charAt(0).toUpperCase() + row.change.slice(1)
                "
                >{{
                  { added: 'A', modified: 'M', deleted: 'D' }[row.change]
                }}</span
              ><span
                v-if="pending.has(row.path)"
                class="loading-dot"
                aria-label="Loading"
              />
            </div>
          </div>
          <p v-if="pending.has('')" class="tree-message">Loading assets…</p>
          <p v-else-if="root && !rows.length" class="tree-message">
            {{ changesOnly ? 'No changed assets.' : 'This folder is empty.' }}
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
            <Icon :name="details?.kind ?? 'file'" />
            <h1>{{ selectedLabel }}</h1>
          </div>
          <span v-else class="muted">Asset Inspector</span>
          <div v-if="selected" class="inspector-mode" role="group" aria-label="Inspector Mode">
            <button :aria-pressed="!compareAsset" @click="compareAsset = false">Preview</button>
            <button :aria-pressed="compareAsset" :disabled="!reviewSummary?.approvedAt" :title="reviewSummary?.approvedAt ? 'Compare with the approved local baseline' : 'Approve a baseline from the Review menu first'" @click="compareAsset = true">Compare</button>
          </div>
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
          <div v-if="details.fromBaseline" class="baseline-notice">
            Deleted from working files · Showing the approved version
          </div>
          <AssetPreview
            :root-id="root?.id ?? ''"
            :asset="details"
            :requested-path="selected"
            :inspecting="inspecting"
            :compare="compareAsset"
            :approved-at="reviewSummary?.approvedAt ?? null"
          />
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
                {{
                  details.fromBaseline
                    ? `Show Baseline in ${fileManagerName}`
                    : `Show in ${fileManagerName}`
                }}
              </button>
            </div>
          </div>
        </div>
        <div v-else-if="selected" class="file-inspector" aria-busy="true" />
        <div v-else class="empty-inspector">
          <Icon name="folder-open" :size="44" />
          <h1>Select an Asset</h1>
          <p>Browse the directory to inspect a file.</p>
          <button v-if="!root" class="primary-button" @click="chooseRoot">
            Open Assets Directory
          </button>
          <button
            v-if="!root"
            class="text-button"
            @click="showPublished = true"
          >
            Download Published Assets
          </button>
        </div>
      </section>
    </div>
    <ToolPanel v-show="view !== 'inspector'" :view="view" :status="runStatus" />
    <button v-if="runStatus" class="run-strip" :class="{ 'run-failed': runStatus.stage === 'Failed' }" @click="view = 'dashboard'" aria-label="Show Run Dashboard">
      <span class="run-stage">{{ runStatus.running ? runStatus.stage : runStatus.stage === 'Failed' ? 'Run Failed' : runStatus.polling ? 'Polling Enabled' : 'Polling Paused' }}</span>
      <progress v-if="runStatus.running" max="100" :value="runStatus.percent" aria-label="Run Progress" />
      <span class="run-detail">{{ runStatus.detail }}</span>
      <span v-if="runStatus.startedAt">{{ Math.round(runStatus.percent) }}% · {{ Math.floor(elapsed / 60) }}m {{ elapsed % 60 }}s</span>
      <span v-if="runStatus.polling">{{ runStatus.running ? 'Next poll after run' : runStatus.nextPollAt ? 'Next poll ' + new Date(runStatus.nextPollAt).toLocaleTimeString() : '' }}</span>
    </button>
    <PublishedLibraryDialog
      v-if="showPublished"
      @close="showPublished = false"
    />
    <footer v-show="view === 'inspector'" class="status-bar">
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
