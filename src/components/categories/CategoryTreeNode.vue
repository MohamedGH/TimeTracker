<script setup lang="ts">
import { computed } from 'vue';
import type { Category } from '../../types/category';
import { useCategoriesStore } from '../../stores/categories';

defineOptions({ name: 'CategoryTreeNode' });

const props = defineProps<{
  category: Category;
  selectedId: string | null;
}>();

const emit = defineEmits<{
  select: [id: string];
  add: [parentId: string];
  rename: [id: string];
  move: [id: string];
  remove: [id: string];
}>();

const store = useCategoriesStore();
const children = computed(() => store.children(props.category.id));
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
        <span
          class="category-tree__color-dot"
          :style="{ backgroundColor: category.color || '#5C7A5E' }"
        ></span>
        {{ category.label }}
      </button>

      <button type="button" @click="emit('add', category.id)">+</button>
      <button type="button" @click="emit('rename', category.id)">Modifier</button>
      <button type="button" @click="emit('move', category.id)">Déplacer</button>
      <button type="button" @click="emit('remove', category.id)">Supprimer</button>
    </div>

    <ul v-if="children.length" class="category-tree__children">
      <CategoryTreeNode
        v-for="child in children"
        :key="child.id"
        :category="child"
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
