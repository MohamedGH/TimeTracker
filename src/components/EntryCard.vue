<template>
  <section class="card">
    <h2 class="card-title">{{ isEditing ? 'Modifier une entrée' : 'Nouvelle entrée' }}</h2>
    <form class="entry-form" @submit.prevent="handleSubmit">
      <div class="field">
        <label>Activité</label>
        <input v-model="activity" type="text" required />
      </div>

      <div class="field">
        <label>Catégorie</label>
        <select v-model="categoryId">
          <option v-for="c in store.categories" :key="c.id" :value="c.id">
            {{ formatCategoryPath(store.categories, c.id) }}
          </option>
        </select>
      </div>

      <div class="row">
        <div class="field">
          <label>Date</label>
          <input v-model="date" type="date" required />
        </div>
        <div class="field">
          <label>Début</label>
          <input v-model="start" type="time" required />
        </div>
        <div class="field">
          <label>Fin</label>
          <input v-model="end" type="time" required />
        </div>
      </div>

      <button type="submit" class="btn">
        {{ isEditing ? 'Enregistrer les modifications' : 'Enregistrer' }}
      </button>

      <button type="button" class="btn secondary" @click="handleStartTimer">
        Démarrer le timer
      </button>

      <button v-if="isEditing" type="button" class="btn secondary" @click="cancelEdit">
        Annuler
      </button>
    </form>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useAppStore } from '../stores/appStore';
import { formatCategoryPath } from '../core/category-tree';
import { today } from '../core/time';

const store = useAppStore();

const activity = ref('');
const categoryId = ref<string | null>(null);

watch(() => store.categories, (cats) => {
  if (!categoryId.value && cats.length) {
    categoryId.value = cats[0].id;
  }
}, { immediate: true });
const date = ref(today());
const start = ref('09:00');
const end = ref('10:00');

const isEditing = computed(() => Boolean(store.editingEntryId));

watch(() => store.editingEntryId, (id) => {
  if (id) {
    const old = store.entries.find(e => e.id === id);
    if (old) {
      activity.value = old.activity;
      categoryId.value = old.categoryId;
      date.value = old.date;
      start.value = old.start;
      end.value = old.end;
    }
  } else {
    resetForm();
  }
}, { immediate: true });

function resetForm() {
  activity.value = '';
  categoryId.value = store.categories[0]?.id || null;
  date.value = today();
  start.value = '09:00';
  end.value = '10:00';
}

function cancelEdit() {
  store.editingEntryId = null;
  resetForm();
}

async function handleSubmit() {
  try {
    await store.addTimeEntry({
      id: store.editingEntryId || undefined,
      activity: activity.value,
      categoryId: categoryId.value,
      date: date.value,
      start: start.value,
      end: end.value,
    });
    resetForm();
  } catch (e: any) {
    alert(e.message || 'Erreur lors de l’enregistrement');
  }
}

async function handleStartTimer() {
  await store.startTimer(activity.value, categoryId.value, date.value, start.value);
}
</script>
