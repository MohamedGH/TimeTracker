<template>
  <div class="categories-view">
    <section class="card">
      <h2 class="card-title">Arbre des catégories</h2>
      <button type="button" class="btn" @click="openCreateModal(null)">
        Nouvelle catégorie racine
      </button>

      <div class="category-tree">
        <CategoryNode
          v-for="rootCat in rootCategories"
          :key="rootCat.id"
          :category="rootCat"
          @add-child="openCreateModal"
          @rename="openRenameModal"
          @move="openMoveModal"
          @delete="handleDelete"
        />
      </div>
    </section>

    <!-- Modal dynamique Catégories -->
    <div v-if="activeModal" class="modal-overlay" @click.self="closeModal">
      <div class="modal-box">
        <div class="modal-head">
          <h2 class="card-title">{{ modalTitle }}</h2>
          <button type="button" class="btn modal-close" @click="closeModal">×</button>
        </div>

        <form v-if="activeModal.type === 'move'" @submit.prevent="handleMove">
          <div class="field">
            <label>Nouvelle catégorie parente</label>
            <select v-model="targetParentId">
              <option value="">(Racine - Aucun parent)</option>
              <option v-for="cat in availableParents" :key="cat.id" :value="cat.id">
                {{ formatCategoryPath(store.categories, cat.id) }}
              </option>
            </select>
          </div>
          <button type="submit" class="btn">Déplacer</button>
        </form>

        <form v-else @submit.prevent="handleSave">
          <div class="field">
            <label>Nom</label>
            <input v-model="categoryName" type="text" required />
          </div>
          <div class="field">
            <label>Couleur</label>
            <input v-model="categoryColor" type="color" />
          </div>
          <button type="submit" class="btn">
            {{ activeModal.type === 'rename' ? 'Renommer' : 'Créer' }}
          </button>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useAppStore } from '../stores/appStore';
import { getRoots, getDescendants, formatCategoryPath } from '../core/category-tree';
import CategoryNode from '../components/CategoryNode.vue';

const store = useAppStore();

const activeModal = ref<{ type: 'create' | 'rename' | 'move'; id?: string; parentId?: string | null } | null>(null);
const categoryName = ref('');
const categoryColor = ref('#5C7A5E');
const targetParentId = ref<string | null>('');

const rootCategories = computed(() => getRoots(store.categories));

const modalTitle = computed(() => {
  if (!activeModal.value) return '';
  if (activeModal.value.type === 'rename') return 'Renommer la catégorie';
  if (activeModal.value.type === 'move') return 'Déplacer la catégorie';
  return activeModal.value.parentId ? 'Nouvelle sous-catégorie' : 'Nouvelle catégorie';
});

const availableParents = computed(() => {
  if (!activeModal.value?.id) return store.categories;
  const currentId = activeModal.value.id;
  const invalidIds = new Set([currentId, ...getDescendants(store.categories, currentId).map(x => x.id)]);
  return store.categories.filter(c => !invalidIds.has(c.id));
});

function openCreateModal(parentId: string | null = null) {
  categoryName.value = '';
  categoryColor.value = '#5C7A5E';
  activeModal.value = { type: 'create', parentId };
}

function openRenameModal(id: string) {
  const cat = store.categories.find(c => c.id === id);
  if (!cat) return;
  categoryName.value = cat.label;
  categoryColor.value = cat.color || '#5C7A5E';
  activeModal.value = { type: 'rename', id };
}

function openMoveModal(id: string) {
  const cat = store.categories.find(c => c.id === id);
  if (!cat) return;
  targetParentId.value = cat.parentId || '';
  activeModal.value = { type: 'move', id };
}

function closeModal() {
  activeModal.value = null;
}

async function handleSave() {
  if (!activeModal.value) return;
  try {
    if (activeModal.value.type === 'rename' && activeModal.value.id) {
      await store.updateCategoryName(activeModal.value.id, categoryName.value);
    } else if (activeModal.value.type === 'create') {
      await store.addNewCategory(categoryName.value, categoryColor.value, activeModal.value.parentId || null);
    }
    closeModal();
  } catch (e: any) {
    alert(e.message || 'Erreur lors de la sauvegarde de la catégorie.');
  }
}

async function handleMove() {
  if (!activeModal.value?.id) return;
  try {
    await store.moveCategoryParent(activeModal.value.id, targetParentId.value || null);
    closeModal();
  } catch (e: any) {
    alert(e.message || 'Erreur lors du déplacement de la catégorie.');
  }
}

async function handleDelete(id: string) {
  await store.removeCategory(id);
}
</script>
