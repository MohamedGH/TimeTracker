<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useCategoriesStore } from '../../stores/categories';
import type { Category } from '../../types/category';
import CategoryTreeNode from './CategoryTreeNode.vue';
import CategoryDialog from './CategoryDialog.vue';

const store = useCategoriesStore();
const selectedId = ref<string | null>(null);
const dialogMode = ref<'create' | 'edit' | 'move' | null>(null);
const dialogCategoryId = ref<string | null>(null);
const createParentId = ref<string | null>(null);
const error = ref('');

onMounted(() => store.load().catch((err: unknown) => {
  error.value = err instanceof Error ? err.message : 'Impossible de charger les catégories.';
}));

const roots = computed(() => store.roots);
const dialogCategory = computed<Category | null>(() =>
  dialogCategoryId.value
    ? store.categories.find(category => category.id === dialogCategoryId.value) ?? null
    : null,
);

function select(id: string) { selectedId.value = id; }
function openCreate(parentId: string | null = null) { createParentId.value = parentId; dialogCategoryId.value = null; dialogMode.value = 'create'; }
function openEdit(id: string) { dialogCategoryId.value = id; dialogMode.value = 'edit'; }
function openMove(id: string) { dialogCategoryId.value = id; dialogMode.value = 'move'; }
function closeDialog() { dialogMode.value = null; dialogCategoryId.value = null; createParentId.value = null; }

async function remove(id: string) {
  const category = store.categories.find(item => item.id === id);
  if (!category || !window.confirm(`Supprimer « ${category.label} » ?`)) return;
  error.value = '';
  try {
    await store.remove(id);
    if (selectedId.value === id) selectedId.value = null;
  } catch (err: unknown) { error.value = err instanceof Error ? err.message : 'Suppression impossible.'; }
}
</script>

<template>
  <section class="category-tree-panel" aria-label="Catégories">
    <header>
      <h2>Catégories</h2>
      <button type="button" @click="openCreate()">+ Catégorie</button>
    </header>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="store.loading">Chargement…</p>
    <ul v-else-if="roots.length" class="category-tree">
      <CategoryTreeNode
        v-for="category in roots"
        :key="category.id"
        :category="category"
        :selected-id="selectedId"
        @select="select"
        @add="openCreate"
        @rename="openEdit"
        @move="openMove"
        @remove="remove"
      />
    </ul>
    <p v-else>Aucune catégorie.</p>

    <CategoryDialog
      v-if="dialogMode"
      :mode="dialogMode"
      :category="dialogMode === 'create' ? ({ id: '', label: '', parentId: createParentId, color: null, builtin: false } as Category) : dialogCategory"
      @close="closeDialog"
      @saved="closeDialog"
    />
  </section>
</template>
