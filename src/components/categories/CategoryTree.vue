<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useCategoriesStore } from '../../stores/categories';
import type { Category } from '../../types/category';
import CategoryTreeNode from './CategoryTreeNode.vue';

const store = useCategoriesStore();
const selectedId = ref<string | null>(null);
const error = ref('');

onMounted(() => store.load().catch((err: unknown) => {
  error.value = err instanceof Error ? err.message : 'Impossible de charger les catégories.';
}));

const roots = computed(() => store.roots);
const children = (category: Category) => store.children(category.id);

function select(id: string) { selectedId.value = id; }

async function add(parentId: string | null = null) {
  const label = window.prompt(parentId ? 'Nom de la sous-catégorie :' : 'Nom de la catégorie :');
  if (!label?.trim()) return;
  try {
    await store.add({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, label: label.trim(), parentId });
  } catch (err: unknown) { error.value = err instanceof Error ? err.message : 'Création impossible.'; }
}

async function rename(id: string) {
  const category = store.categories.find(item => item.id === id);
  if (!category) return;
  const label = window.prompt('Nouveau nom :', category.label);
  if (!label?.trim()) return;
  try { await store.rename(id, label.trim()); }
  catch (err: unknown) { error.value = err instanceof Error ? err.message : 'Renommage impossible.'; }
}

async function move(id: string) {
  const parentId = window.prompt('ID de la nouvelle catégorie parente (vide = racine) :', '');
  if (parentId === null) return;
  try { await store.move(id, parentId.trim() || null); }
  catch (err: unknown) { error.value = err instanceof Error ? err.message : 'Déplacement impossible.'; }
}

async function remove(id: string) {
  const category = store.categories.find(item => item.id === id);
  if (!category || !window.confirm(`Supprimer « ${category.label} » ?`)) return;
  try { await store.remove(id); }
  catch (err: unknown) { error.value = err instanceof Error ? err.message : 'Suppression impossible.'; }
}
</script>

<template>
  <section class="category-tree-panel" aria-label="Catégories">
    <header><h2>Catégories</h2><button type="button" @click="add()">+ Catégorie</button></header>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="store.loading">Chargement…</p>
    <ul v-else-if="roots.length" class="category-tree">
      <CategoryTreeNode
        v-for="category in roots" :key="category.id"
        :category="category" :children="children(category)" :selected-id="selectedId"
        @select="select" @add="add" @rename="rename" @move="move" @remove="remove"
      />
    </ul>
    <p v-else>Aucune catégorie.</p>
  </section>
</template>
