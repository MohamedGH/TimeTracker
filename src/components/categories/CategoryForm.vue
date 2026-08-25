<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Category } from '../../types/category';
import { useCategoriesStore } from '../../stores/categories';

const props = withDefaults(defineProps<{ category?: Category | null }>(), { category: null });
const emit = defineEmits<{ saved: []; cancel: [] }>();
const store = useCategoriesStore();
const label = ref(props.category?.label ?? '');
const parentId = ref<string | null>(props.category?.parentId ?? null);
const error = ref('');
const saving = ref(false);

const candidates = computed(() => store.categories.filter(c => c.id !== props.category?.id));

async function submit() {
  error.value = '';
  if (!label.value.trim()) { error.value = 'Le nom est obligatoire.'; return; }
  saving.value = true;
  try {
    if (props.category) await store.rename(props.category.id, label.value.trim());
    else await store.add({ id: crypto.randomUUID(), label: label.value.trim(), parentId: parentId.value });
    emit('saved');
  } catch (err) { error.value = err instanceof Error ? err.message : 'Enregistrement impossible.'; }
  finally { saving.value = false; }
}
</script>

<template>
  <form @submit.prevent="submit">
    <label>Nom <input v-model="label" maxlength="120" autocomplete="off" /></label>
    <label v-if="!category">Parent
      <select v-model="parentId">
        <option :value="null">Racine</option>
        <option v-for="item in candidates" :key="item.id" :value="item.id">{{ store.path(item.id) }}</option>
      </select>
    </label>
    <p v-if="error" role="alert">{{ error }}</p>
    <button type="submit" :disabled="saving">{{ saving ? 'Enregistrement…' : 'Enregistrer' }}</button>
    <button type="button" @click="emit('cancel')">Annuler</button>
  </form>
</template>
