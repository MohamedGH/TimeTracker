<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Category } from '../../types/category';
import { useCategoriesStore } from '../../stores/categories';

const props = defineProps<{ category: Category }>();
const emit = defineEmits<{ saved: []; cancel: [] }>();
const store = useCategoriesStore();
const parentId = ref<string | null>(props.category.parentId);
const error = ref('');

const descendants = computed(() => new Set(store.descendants(props.category.id).map(c => c.id)));
const candidates = computed(() => store.categories.filter(c => c.id !== props.category.id && !descendants.value.has(c.id)));

async function submit() {
  error.value = '';
  try { await store.move(props.category.id, parentId.value); emit('saved'); }
  catch (err) { error.value = err instanceof Error ? err.message : 'Déplacement impossible.'; }
}
</script>

<template>
  <form @submit.prevent="submit">
    <label>Nouvelle catégorie parente
      <select v-model="parentId">
        <option :value="null">Racine</option>
        <option v-for="item in candidates" :key="item.id" :value="item.id">{{ store.path(item.id) }}</option>
      </select>
    </label>
    <p v-if="error" role="alert">{{ error }}</p>
    <button type="submit">Déplacer</button>
    <button type="button" @click="emit('cancel')">Annuler</button>
  </form>
</template>
