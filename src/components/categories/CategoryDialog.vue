<script setup lang="ts">
import type { Category } from '../../types/category';
import CategoryForm from './CategoryForm.vue';
import CategoryMoveForm from './CategoryMoveForm.vue';

defineProps<{
  mode: 'create' | 'edit' | 'move';
  category?: Category | null;
}>();

const emit = defineEmits<{ close: []; saved: [] }>();
</script>

<template>
  <div class="category-dialog-backdrop" role="presentation" @click.self="emit('close')">
    <section class="category-dialog" role="dialog" aria-modal="true" aria-label="Gestion de catégorie">
      <button type="button" aria-label="Fermer" @click="emit('close')">×</button>

      <CategoryForm
        v-if="mode !== 'move'"
        :category="mode === 'edit' ? category : null"
        @saved="emit('saved')"
        @cancel="emit('close')"
      />

      <CategoryMoveForm
        v-else-if="category"
        :category="category"
        @saved="emit('saved')"
        @cancel="emit('close')"
      />
    </section>
  </div>
</template>
