<template>
  <div class="app-container">
    <header class="app-header">
      <h1 class="lt-title">Carnet du temps</h1>
      <nav class="tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="btn tab-btn"
          :class="{ active: store.tab === tab.id, secondary: store.tab !== tab.id }"
          @click="store.tab = tab.id"
        >
          {{ tab.label }}
        </button>
      </nav>
    </header>

    <main class="content">
      <div v-if="store.error" class="error">{{ store.error }}</div>

      <EntryView v-if="store.tab === 'entry'" />
      <DashboardView v-else-if="store.tab === 'dashboard'" />
      <CategoriesView v-else-if="store.tab === 'categories'" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useAppStore } from './stores/appStore';
import EntryView from './views/EntryView.vue';
import DashboardView from './views/DashboardView.vue';
import CategoriesView from './views/CategoriesView.vue';

const store = useAppStore();

const tabs = [
  { id: 'entry' as const, label: 'Saisie' },
  { id: 'dashboard' as const, label: 'Tableau de bord' },
  { id: 'categories' as const, label: 'Catégories' },
];

onMounted(() => {
  store.init();
});
</script>
