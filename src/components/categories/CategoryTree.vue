<script setup lang="ts">
import { computed } from 'vue';
import { useCategoriesStore } from '../../stores/categories';
import CategoryTreeNode from './CategoryTreeNode.vue';

const props = defineProps<{ selectedId: string | null }>();
const emit = defineEmits<{
  select: [id: string];
  add: [parentId: string | null];
  rename: [id: string];
  move: [id: string];
  remove: [id: string];
}>();

const store = useCategoriesStore();
const roots = computed(() => store.roots);
</script>

<template>
  <ul class="category-tree">
    <CategoryTreeNode
      v-for="category in roots"
      :key="category.id"
      :category="category"
      :selected-id="props.selectedId"
      @select="emit('select', $event)"
      @add="emit('add', $event)"
      @rename="emit('rename', $event)"
      @move="emit('move', $event)"
      @remove="emit('remove', $event)"
    />
  </ul>
</template>
