<script setup lang="ts">
import type { Category } from '../../types/category';

defineOptions({ name: 'CategoryTreeNode' });

defineProps<{
  category: Category;
  children: Category[];
  selectedId: string | null;
}>();

const emit = defineEmits<{
  select: [id: string];
  add: [parentId: string];
  rename: [id: string];
  move: [id: string];
  remove: [id: string];
}>();
</script>

<template>
  <li class="category-tree__item">
    <div class="category-tree__row">
      <button
        type="button"
        class="category-tree__select"
        :aria-current="selectedId === category.id ? 'true' : undefined"
        @click="emit('select', category.id)"
      >
        {{ category.label }}
      </button>

      <button type="button" @click="emit('add', category.id)">+</button>
      <button type="button" @click="emit('rename', category.id)">Renommer</button>
      <button type="button" @click="emit('move', category.id)">Déplacer</button>
      <button type="button" @click="emit('remove', category.id)">Supprimer</button>
    </div>

    <ul v-if="children.length" class="category-tree__children">
      <CategoryTreeNode
        v-for="child in children"
        :key="child.id"
        :category="child"
        :children="[]"
        :selected-id="selectedId"
        @select="emit('select', $event)"
        @add="emit('add', $event)"
        @rename="emit('rename', $event)"
        @move="emit('move', $event)"
        @remove="emit('remove', $event)"
      />
    </ul>
  </li>
</template>
