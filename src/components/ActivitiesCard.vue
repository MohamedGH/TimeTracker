<template>
  <section class="card">
    <h2 class="card-title">Activités enregistrées</h2>
    <button type="button" class="btn secondary" @click="showAddModal = true">
      Ajouter une activité
    </button>

    <div v-for="a in store.activities" :key="a.id" class="entry-row">
      <div>{{ a.label || a.activity }} · {{ getCategoryPath(a.categoryId) }}</div>
      <button type="button" class="btn small" @click="startActivity(a)">Démarrer</button>
      <button type="button" class="btn small danger" @click="store.removeSavedActivity(a.id)">×</button>
    </div>

    <!-- Modal Ajouter une activité -->
    <div v-if="showAddModal" class="modal-overlay" @click.self="showAddModal = false">
      <div class="modal-box">
        <div class="modal-head">
          <h2 class="card-title">Activité enregistrée</h2>
          <button type="button" class="btn modal-close" @click="showAddModal = false">×</button>
        </div>
        <form @submit.prevent="handleAddActivity">
          <div class="field">
            <label>Nom</label>
            <input v-model="newLabel" type="text" required />
          </div>
          <div class="field">
            <label>Catégorie</label>
            <select v-model="newCategoryId">
              <option v-for="c in store.categories" :key="c.id" :value="c.id">
                {{ formatCategoryPath(store.categories, c.id) }}
              </option>
            </select>
          </div>
          <button type="submit" class="btn">Enregistrer</button>
        </form>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useAppStore } from '../stores/appStore';
import { formatCategoryPath } from '../core/category-tree';
import { today } from '../core/time';

const store = useAppStore();

const showAddModal = ref(false);
const newLabel = ref('');
const newCategoryId = ref<string | null>(store.categories[0]?.id || null);

function getCategoryPath(id: string | null) {
  return id ? formatCategoryPath(store.categories, id) : 'Sans catégorie';
}

function startActivity(a: any) {
  const now = new Date();
  const startTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  store.startTimer(a.label || a.activity, a.categoryId, today(), startTime);
}

async function handleAddActivity() {
  await store.addSavedActivity(newLabel.value, newCategoryId.value);
  newLabel.value = '';
  showAddModal.value = false;
}
</script>
