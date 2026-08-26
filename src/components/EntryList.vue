<template>
  <section class="card">
    <h2 class="card-title">Dernières entrées</h2>
    <p v-if="!store.entries.length" class="empty">Aucune entrée.</p>

    <div v-for="e in recentEntries" :key="e.id" class="entry-row">
      <div>
        <strong>{{ e.activity }}</strong>
        <div class="entry-meta">
          {{ e.date }} · {{ e.start }}–{{ e.end }} · {{ Math.round(e.mins) }} min · {{ getCategoryPath(e.categoryId) }}
        </div>
      </div>
      <button type="button" class="btn small" @click="store.editingEntryId = e.id">Modifier</button>
      <button type="button" class="btn small danger" @click="store.removeEntry(e.id)">Supprimer</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useAppStore } from '../stores/appStore';
import { formatCategoryPath } from '../core/category-tree';

const store = useAppStore();

const recentEntries = computed(() => store.entries.slice(0, 15));

function getCategoryPath(id: string | null) {
  return id ? formatCategoryPath(store.categories, id) : 'Sans catégorie';
}
</script>
