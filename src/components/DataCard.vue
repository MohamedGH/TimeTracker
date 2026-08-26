<template>
  <section class="card">
    <h2 class="card-title">Données</h2>
    <div class="action-row">
      <button type="button" class="btn" @click="exportData">Exporter</button>
      <button type="button" class="btn" @click="triggerImport">Importer</button>
      <button type="button" class="btn danger" @click="confirmClear">Effacer toutes les données</button>
    </div>
    <input ref="fileInput" type="file" accept=".json,application/json" style="display: none" @change="importData" />
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useAppStore } from '../stores/appStore';
import { buildExportPayload, parseImportPayload } from '../core/import-export';
import { today } from '../core/time';

const store = useAppStore();
const fileInput = ref<HTMLInputElement | null>(null);

function exportData() {
  const payload = buildExportPayload({
    entries: store.entries,
    savedActivities: store.activities,
    categories: store.categories,
  });
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `time-tracker-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
}

function triggerImport() {
  fileInput.value?.click();
}

async function importData(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = parseImportPayload(text);
    const builtins = store.categories.filter(c => c.builtin);
    const ids = new Set(builtins.map(c => c.id));
    store.entries = data.entries;
    store.activities = data.savedActivities;
    store.categories = [...builtins, ...data.categories.filter(c => !ids.has(c.id))];
    await store.persist();
  } catch (e: any) {
    alert(e.message || 'Impossible d’importer ce fichier JSON.');
  }
}

async function confirmClear() {
  if (confirm('Effacer toutes les données locales ? Cette action est irréversible.')) {
    await store.clearAll();
  }
}
</script>
