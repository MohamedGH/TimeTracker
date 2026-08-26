import type { Category } from '../types';
import { createCategory, getDescendants, wouldCreateCycle } from '../core/category-tree';

export function addCategory(
  categories: Category[],
  { id, label, color = null, parentId = null, builtin = false }: { id: string; label: string; color?: string | null; parentId?: string | null; builtin?: boolean }
): Category[] {
  if (categories.some(category => category.id === id)) {
    throw new Error(`La catégorie "${id}" existe déjà.`);
  }
  if (parentId && !categories.some(category => category.id === parentId)) {
    throw new Error('Catégorie parente introuvable.');
  }
  return [...categories, createCategory({ id, label, color, parentId, builtin })];
}

export function renameCategory(categories: Category[], id: string, label: string): Category[] {
  if (!categories.some(category => category.id === id)) throw new Error('Catégorie introuvable.');
  return categories.map(category => category.id === id ? { ...category, label: label.trim() } : category);
}

export function moveCategory(categories: Category[], id: string, parentId: string | null = null): Category[] {
  const category = categories.find(item => item.id === id);
  if (!category) throw new Error('Catégorie introuvable.');
  if (parentId && !categories.some(item => item.id === parentId)) throw new Error('Catégorie parente introuvable.');
  if (parentId && wouldCreateCycle(categories, id, parentId)) throw new Error('Déplacement impossible : il créerait une boucle.');
  return categories.map(item => item.id === id ? { ...item, parentId } : item);
}

export function deleteCategory(categories: Category[], id: string, { cascade = false }: { cascade?: boolean } = {}): Category[] {
  const category = categories.find(item => item.id === id);
  if (!category) throw new Error('Catégorie introuvable.');
  const descendants = getDescendants(categories, id);
  const idsToDelete = new Set(cascade ? [id, ...descendants.map(item => item.id)] : [id]);
  if (!cascade && descendants.length) {
    throw new Error('Cette catégorie contient des enfants. Utilisez une suppression en cascade ou déplacez-les d’abord.');
  }
  return categories.filter(item => !idsToDelete.has(item.id));
}
