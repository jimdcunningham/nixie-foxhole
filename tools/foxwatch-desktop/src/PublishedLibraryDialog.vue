<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import type { PublishedScope, PublishedStatus } from '../shared/contracts';
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement>();
const scope = ref<PublishedScope>('all');
const state = shallowRef<PublishedStatus>({
  phase: 'idle',
  current: null,
  candidate: null,
  completed: 0,
  reused: 0,
  message: '',
});
const busy = computed(
  () => state.value.phase === 'checking' || state.value.phase === 'downloading',
);
let unsubscribe: (() => void) | undefined;
async function run(action: 'check' | 'download' | 'cancel' | 'open') {
  try {
    state.value = await window.foxwatch.published(action, scope.value);
  } catch (cause) {
    state.value = {
      ...state.value,
      phase: 'error',
      message: String(cause instanceof Error ? cause.message : cause).replace(
        /^Error invoking remote method '[^']+': Error: /,
        '',
      ),
    };
  }
}
onMounted(async () => {
  dialog.value?.showModal();
  unsubscribe = window.foxwatch.onPublishedProgress((value) => {
    state.value = value;
  });
  state.value = await window.foxwatch.published('info', scope.value);
  if (state.value.candidate) scope.value = state.value.candidate.scope;
});
onBeforeUnmount(() => unsubscribe?.());
</script>
<template>
  <dialog
    ref="dialog"
    class="library-dialog"
    @close="emit('close')"
    @cancel="emit('close')"
  >
    <header>
      <h2>Published Assets</h2>
      <button aria-label="Close Published Assets" @click="emit('close')">
        ×
      </button>
    </header>
    <p>
      Download a published library for local inspection. Generation tools and
      publishing credentials are not required.
    </p>
    <label class="library-scope"
      >Library
      <select v-model="scope" :disabled="busy">
        <option value="all">Entire Library</option>
        <option value="catalog">Catalog &amp; Models</option>
      </select></label
    >
    <div class="library-release">
      <template v-if="state.candidate"
        ><strong>Available Release</strong
        ><code>{{ state.candidate.release.sha256.slice(0, 12) }}</code
        ><span>{{ state.candidate.files.toLocaleString() }} files</span
        ><small v-if="state.candidate.source === 'bundled'"
          >Pinned release; the update channel is not available yet.</small
        ></template
      >
      <template v-else
        ><strong>Available Release</strong
        ><span>Check for updates to read the published library.</span></template
      >
      <template v-if="state.current"
        ><strong>Downloaded Release</strong
        ><code>{{ state.current.release.sha256.slice(0, 12) }}</code
        ><span
          >{{
            state.current.scope === 'all'
              ? 'Entire library'
              : 'Catalog and models'
          }}
          · {{ state.current.files.toLocaleString() }} files</span
        ></template
      >
    </div>
    <div
      v-if="state.message"
      class="library-message"
      :role="state.phase === 'error' ? 'alert' : 'status'"
    >
      {{ state.message }}
    </div>
    <progress
      v-if="state.phase === 'downloading'"
      :value="state.completed"
      :max="state.candidate?.files || 1"
    />
    <footer>
      <button :disabled="busy" @click="run('check')">Check for Updates</button
      ><button v-if="state.current" :disabled="busy" @click="run('open')">
        Open Downloaded Assets</button
      ><button v-if="busy" @click="run('cancel')">Cancel</button
      ><button
        v-else
        class="primary-button"
        :disabled="!state.candidate || state.candidate.scope !== scope"
        @click="run('download')"
      >
        Download &amp; Open
      </button>
    </footer>
  </dialog>
</template>
