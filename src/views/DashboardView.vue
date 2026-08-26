<template>
  <div class="dashboard-view">
    <div class="period-tabs">
      <button
        v-for="p in periods"
        :key="p.id"
        class="btn"
        :class="{ active: store.period === p.id, secondary: store.period !== p.id }"
        @click="store.period = p.id"
      >
        {{ p.label }}
      </button>
    </div>

    <section v-if="store.period === 'custom'" class="card">
      <h2 class="card-title">Plage personnalisée</h2>
      <div class="row">
        <div class="field">
          <label>Date de début</label>
          <input v-model="store.customStart" type="date" />
        </div>
        <div class="field">
          <label>Date de fin</label>
          <input v-model="store.customEnd" type="date" />
        </div>
      </div>
    </section>

    <div class="metric-grid">
      <div class="metric">Temps total: {{ formatTotalTime(totalMinutes) }}</div>
      <div class="metric">Entrées: {{ dashboardEntries.length }}</div>
      <div class="metric">Jours actifs: {{ activeDaysCount }}</div>
    </div>

    <section class="card">
      <h2 class="card-title">Statistiques</h2>
      <h3 class="chart-title">Temps par jour</h3>
      <canvas ref="dayCanvas"></canvas>

      <h3 class="chart-title">Répartition par heure</h3>
      <canvas ref="hourCanvas"></canvas>

      <h3 class="chart-title">Répartition du temps par catégorie / sous-catégorie</h3>
      <div ref="categoryContainer"></div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useAppStore } from '../stores/appStore';
import { today, addDays, splitEntryByDay } from '../core/time';
import { renderCharts, destroyCharts } from '../charts/dashboard';

const store = useAppStore();

const dayCanvas = ref<HTMLCanvasElement | null>(null);
const hourCanvas = ref<HTMLCanvasElement | null>(null);
const categoryContainer = ref<HTMLDivElement | null>(null);

const periods = [
  { id: '7', label: '7 jours' },
  { id: '14', label: '14 jours' },
  { id: '30', label: '30 jours' },
  { id: '90', label: '90 jours' },
  { id: 'custom', label: 'Personnalisé' },
];

const dashboardEntries = computed(() => {
  let min: string, max: string;
  if (store.period === 'custom') {
    min = store.customStart || addDays(today(), -7);
    max = store.customEnd || today();
  } else {
    const end = new Date();
    const days = Number(store.period) || 7;
    const start = new Date(end);
    start.setDate(start.getDate() - days + 1);
    min = start.toISOString().slice(0, 10);
    max = end.toISOString().slice(0, 10);
  }
  return store.entries.flatMap(splitEntryByDay).filter(e => e.date >= min && e.date <= max);
});

const totalMinutes = computed(() => dashboardEntries.value.reduce((s, e) => s + e.mins, 0));
const activeDaysCount = computed(() => new Set(dashboardEntries.value.map(e => e.date)).size);

function formatTotalTime(mins: number) {
  return `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m`;
}

function updateCharts() {
  if (dayCanvas.value && hourCanvas.value) {
    renderCharts({
      dayCanvas: dayCanvas.value,
      hourCanvas: hourCanvas.value,
      categoryCanvas: categoryContainer.value,
      entries: dashboardEntries.value,
    });
  }
}

onMounted(() => {
  updateCharts();
});

watch([dashboardEntries, () => store.period], () => {
  updateCharts();
});
</script>
