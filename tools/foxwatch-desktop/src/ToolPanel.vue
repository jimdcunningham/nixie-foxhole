<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import type { AppView, RunStatus, ToolInfo, ToolSettings, CredentialInput, RunOperation } from '../shared/monitor';
const props = defineProps<{ view: AppView; status: RunStatus | null }>();
const api = window.foxwatch.monitor;
const info = ref<ToolInfo | null>(null);
const settings = ref<ToolSettings | null>(null);
const credentials = ref<CredentialInput>({});
const busy = ref(false), error = ref(''), notice = ref('');
async function perform(task: () => Promise<unknown>, message = '') {
  if (busy.value) return;
  busy.value = true; error.value = ''; notice.value = '';
  try { await task(); await load(); notice.value = message; }
  catch (cause) { error.value = String(cause instanceof Error ? cause.message : cause).replace(/^Error invoking remote method '[^']+': Error: /, ''); }
  finally { busy.value = false; }
}
function refreshInfo() { return perform(async () => {}); }
async function load() { info.value = await api.info(); settings.value = { ...info.value.settings }; }
function action(value: RunOperation | 'start' | 'pause' | 'cancel' | 'logs' | 'output') {
  void perform(() => api.action(value));
}
async function saveCredentials() {
  await perform(async () => { await api.credentials({ ...credentials.value }); credentials.value = {}; }, 'Credentials saved with Windows user encryption.');
}
watch(() => props.view, () => { if (props.view !== 'inspector') void refreshInfo(); });
watch(() => props.status?.running, (running, previous) => { if (previous && !running) void refreshInfo(); });
onMounted(() => void refreshInfo());
const bytes = (value: number) => (value / 1_000_000_000).toFixed(2) + ' GB';
</script>

<template>
  <section class="tool-panel" :aria-label="view === 'settings' ? 'Settings' : view === 'workers' ? 'Workers and Logs' : 'Dashboard'">
    <header class="tool-heading">
      <div><h1>{{ view === 'settings' ? 'Settings' : view === 'workers' ? 'Workers & Logs' : 'Dashboard' }}</h1>
      <p>{{ view === 'settings' ? 'Local configuration, credentials, and explicit asset publishing.' : 'Steam build monitoring and asset generation.' }}</p></div>
      <button class="tool-button" :disabled="busy" @click="refreshInfo">Refresh Status</button>
    </header>
    <p v-if="error" class="tool-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="tool-notice" role="status">{{ notice }}</p>
    <p v-if="info && !info.windows" class="tool-notice">Steam monitoring and generation require Windows. Asset inspection and published-library downloads are available on this platform.</p>

    <template v-if="view === 'dashboard'">
      <div class="tool-cards">
        <article><h2>Latest Steam Build</h2><strong>{{ info?.latestBuild ?? 'Loading…' }}</strong></article>
        <article><h2>Last Successful Build</h2><strong>{{ info?.successfulBuild ?? '—' }}</strong></article>
        <article><h2>Polling</h2><strong>{{ status?.polling ? 'Enabled' : 'Paused' }}</strong><p>{{ status?.running ? `${settings?.intervalMinutes ?? 10} minutes after this run finishes` : status?.nextPollAt ? `Next poll: ${new Date(status.nextPollAt).toLocaleTimeString()}` : 'No poll scheduled' }}</p></article>
      </div>
      <article class="tool-card">
        <h2>{{ status?.running ? 'Active Run' : 'Last Run' }}</h2>
        <h3>{{ status?.stage ?? 'Stopped' }}</h3><p>{{ status?.detail }}</p>
        <progress max="100" :value="status?.percent ?? 0" aria-label="Overall Run Progress" />
        <p class="muted">{{ Math.round(status?.percent ?? 0) }}% · Stage-based estimate</p>
        <div class="tool-actions">
          <button class="tool-button" :disabled="busy || !info?.windows" @click="action(status?.polling ? 'pause' : 'start')">{{ status?.polling ? 'Pause Polling' : 'Start Polling' }}</button>
          <button class="tool-button" :disabled="busy || status?.running || !info?.windows" @click="action('poll')">Poll Now</button>
          <button class="tool-button" :disabled="busy || status?.running || !info?.windows" @click="action('refresh')">Refresh Latest Build</button>
          <button v-if="status?.running" class="tool-button danger" :disabled="busy" @click="action('cancel')">Cancel Run</button>
          <button class="tool-button" @click="action('logs')">Open Logs</button>
        </div>
        <p class="muted">Polling checks the latest public/devbranch build and generates assets when needed. The next poll waits for the full run to finish. R2 uploads are manual.</p>
      </article>
      <article v-if="info?.lastError" class="tool-card"><h2>Last Recorded Pipeline Error</h2><p class="tool-error">{{ info.lastError }}</p></article>
    </template>

    <template v-if="view === 'workers'">
      <div class="tool-cards"><article><h2>2D Rendering</h2><strong>{{ status?.rendered.toLocaleString() }} / {{ status?.renderTotal.toLocaleString() }} Scenes</strong></article>
      <article><h2>3D Export</h2><strong>{{ status?.exported.toLocaleString() }} / {{ status?.exportTotal.toLocaleString() }} Assets</strong></article></div>
      <article class="tool-card"><h2>Workers</h2><p v-if="!status?.workers.length" class="muted">No worker activity recorded for this run.</p>
      <table v-else class="workers-table"><thead><tr><th>Worker</th><th>Activity</th><th>Progress</th></tr></thead><tbody>
        <tr v-for="worker in status.workers" :key="worker.type + worker.id"><td>{{ worker.type }} {{ worker.id }}</td><td>{{ worker.detail }}</td><td>{{ worker.total ? `${worker.completed} / ${worker.total}` : '—' }}</td></tr>
      </tbody></table><p v-if="!status?.running && status?.workers.length" class="muted">Activity from the last run.</p></article>
      <article class="tool-card"><div class="tool-heading"><h2>Run Output</h2><button class="tool-button" @click="action('logs')">Open Logs</button></div>
      <pre class="run-output" tabindex="0">{{ status?.logs.join('\n') || 'Run output will appear here. Full run logs are saved locally.' }}</pre><p class="muted">Latest 300 lines. The full log is saved in the FoxWatch logs directory.</p></article>
    </template>

    <template v-if="view === 'settings' && settings && info">
      <fieldset :disabled="busy || !!status?.running || !info.windows">
        <legend>Background & Startup</legend>
        <p>Closing the window hides FoxWatch in the tray. Quit waits for active work to finish.</p>
        <label class="tool-check"><input v-model="settings.startWithWindows" type="checkbox">Start With Windows</label>
        <label class="tool-check"><input v-model="settings.startMinimized" type="checkbox">Start Minimized at Login</label>
        <p class="muted">Polling is paused on first adoption. Start it on the Dashboard; later launches remember that choice.</p>
      </fieldset>
      <fieldset :disabled="busy || !!status?.running || !info.windows"><legend>Steam & Generation</legend>
        <div class="settings-grid">
          <label>Node Executable<input v-model="settings.nodePath" spellcheck="false"></label>
          <label>Blender Executable<input v-model="settings.blenderPath" spellcheck="false"></label>
          <label>Steam Username<input v-model="settings.steamUsername" autocomplete="off"></label>
          <label>Poll Interval (Minutes)<input v-model.number="settings.intervalMinutes" type="number" min="5" max="1440"></label>
          <label>Minimum Free Memory (GiB)<input v-model.number="settings.minimumAvailableMemoryGiB" type="number" min="0" max="1024"></label>
        </div><label class="tool-check"><input v-model="settings.nixieEnabled" type="checkbox">Nixie Checkpoint Notifications</label>
      </fieldset>
      <fieldset :disabled="busy || !!status?.running || !info.windows"><legend>Asset Publishing</legend>
        <div class="settings-grid">
          <label>Assets Directory<input v-model="settings.assetsRoot" spellcheck="false"></label><label>Prepared Output Directory<input v-model="settings.outputRoot" spellcheck="false"></label>
          <label>S3 Endpoint<input v-model="settings.endpoint" spellcheck="false"></label><label>Bucket<input v-model="settings.bucket" spellcheck="false"></label>
          <label>Public Asset URL<input v-model="settings.publicBaseUrl" spellcheck="false"></label><label>Object Prefix<input v-model="settings.prefix" spellcheck="false"></label>
          <label>Upload Concurrency<input v-model.number="settings.concurrency" type="number" min="1" max="16"></label>
        </div>
      </fieldset>
      <div class="tool-actions"><button class="primary-button" :disabled="busy || !!status?.running || !info.windows" @click="perform(() => api.save({ ...settings! }), 'Settings saved.')">Save Settings</button><span class="muted">Save changes before starting an operation.</span></div>
      <fieldset :disabled="busy || !!status?.running || !info.windows"><legend>Credentials</legend>
        <p>Existing Windows-encrypted credentials are reused and never displayed. Leave fields blank to keep them.</p>
        <div class="settings-grid">
          <label>Steam Password · {{ info.steamCredentials ? 'Saved' : 'Not Saved' }}<input v-model="credentials.steamPassword" type="password" autocomplete="new-password"></label>
          <label>Nixie Webhook · {{ info.notificationCredentials ? 'Saved' : 'Not Saved' }}<input v-model="credentials.webhook" type="password" autocomplete="new-password"></label>
          <label>R2 Access Key ID · {{ info.assetCredentials ? 'Saved' : 'Not Saved' }}<input v-model="credentials.accessKeyId" type="password" autocomplete="new-password"></label>
          <label>R2 Secret Access Key<input v-model="credentials.secretAccessKey" type="password" autocomplete="new-password"></label>
        </div><button class="tool-button" :disabled="!Object.values(credentials).some(Boolean)" @click="saveCredentials">Save Credentials</button>
      </fieldset>
      <fieldset :disabled="busy || !!status?.running || !info.windows"><legend>Publish a Release</legend>
        <p>Prepare snapshots local files. Inspect and approve them before publishing. Check Upload verifies the prepared snapshot without uploading. Publish explicitly uploads it and updates the public stable channel after verification.</p>
        <p v-if="info.prepared" class="prepared-release">{{ info.prepared.files.toLocaleString() }} source files · {{ bytes(info.prepared.bytes) }}<br>{{ info.prepared.releaseUrl }}</p>
        <p v-else class="muted">No prepared release.</p>
        <div class="tool-actions"><button class="tool-button" @click="action('prepare')">Prepare Assets</button><button class="tool-button" :disabled="!info.prepared" @click="action('check')">Check Upload</button><button class="tool-button" :disabled="!info.prepared" @click="action('publish')">Publish Assets…</button><button class="tool-button" @click="action('output')">Open Output</button></div>
        <p class="muted">Generation does not upload. Publishing does not approve the inspector baseline or update Nixie's checked-in asset pin.</p>
      </fieldset>
      <fieldset :disabled="busy || !!status?.running || !info.windows"><legend>Maintenance</legend><button class="tool-button danger" @click="action('clear-cache')">Clear Generation Cache…</button><button class="tool-button" @click="action('logs')">Open Logs</button></fieldset>
    </template>
  </section>
</template>
