<template>
  <div class="category-node">
    <div class="category-head">
      <strong>{{ category.label }}</strong>
      <span class="muted">{{ categoryPath }}</span>
    </div>

    <div class="category-actions">
      <button type="button" class="btn small" @click="$emit('addChild', category.id)">
        Sous-catégorie
      </button>
      <button type="button" class="btn small" @click="$emit('rename', category.id)">
        Renommer
      </button>
      <button type="button" class="btn small" @click="$emit('move', category.id)">
        Déplacer
      </button>
      <button
        type="button"
        class="btn small danger"
        :disabled="category.builtin"
        @click="$emit('delete', category.id)"
      >
        Supprimer
      </button>
    </div>

    <div v-if="children.length" class="category-children">
      <CategoryNode
        v-for="child in children"
        :key="child.id"
        :category="child"
        @add-child="$emit('addChild', $event)"
        @rename="$emit('rename', $event)"
        @move="$emit('move', $event)"
        @delete="$emit('delete', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Category } from '../types';
import { useAppStore } from '../stores/appStore';
import { getChildren, formatCategoryPath } from '../core/category-tree';

const props = defineProps<{
  category: Category;
}>();

defineEmits<{
  (e: 'addChild', id: string): void;
  (e: 'rename', id: string): void;
  (e: 'move', id: string): void;
  (e: 'delete', id: string): void;
}>();

const store = useAppStore();

const children = computed(() => getChildren(store.categories, props.category.id));
const categoryPath = computed(() => formatCategoryPath(store.categories, props.category.id));
</script>
