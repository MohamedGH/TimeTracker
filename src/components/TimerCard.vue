<template>
  <section class="card">
    <h2 class="card-title">Timer</h2>
    <p v-if="!store.activeTimer" class="muted">Aucun timer actif.</p>
    <div v-else class="timer-active">
      <div class="muted">
        {{ store.activeTimer.activity }} · {{ getCategoryPath(store.activeTimer.categoryId) }}
      </div>
      <div class="t-clock">{{ clockText }}</div>
      <button type="button" class="btn danger" @click="store.stopTimer()">
        Arrêter le timer
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useAppStore } from '../stores/appStore';
import { elapsedSeconds } from '../core/timer';
import { formatCategoryPath } from '../core/category-tree';

const store = useAppStore();
const seconds = ref(0);
let interval: any = null;

const clockText = computed(() => {
  const s = seconds.value;
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
});

function getCategoryPath(id: string | null) {
  return id ? formatCategoryPath(store.categories, id) : 'Sans catégorie';
}

function updateClock() {
  if (store.activeTimer) {
    seconds.value = elapsedSeconds(store.activeTimer);
  }
}

onMounted(() => {
  updateClock();
  interval = setInterval(updateClock, 1000);
});

onUnmounted(() => {
  clearInterval(interval);
});
</script>
