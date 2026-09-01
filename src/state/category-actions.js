import {
  createCategory,
  getDescendants,
  wouldCreateCycle,
} from '../core/category-tree.js';

export function addCategory(categories, { id, label, color = null, parentId = null, builtin = false }) {
  if (categories.some(category => category.id === id)) {
    throw new Error(`La catégorie "${id}" existe déjà.`);
  }
  if (parentId && !categories.some(category => category.id === parentId)) {
    throw new Error('Catégorie parente introuvable.');
  }
  return [...categories, createCategory({ id, label, color, parentId, builtin })];
}

export function renameCategory(categories, id, label) {
  if (!categories.some(category => category.id === id)) throw new Error('Catégorie introuvable.');
  return categories.map(category => category.id === id ? { ...category, label: label.trim() } : category);
}

export function updateCategory(categories, id, { label, color, parentId } = {}) {
  const category = categories.find(item => item.id === id);
  if (!category) throw new Error('Catégorie introuvable.');

  const nextLabel = label !== undefined ? String(label).trim() : category.label;
  if (!nextLabel) throw new Error('Le nom de la catégorie ne peut pas être vide.');

  const nextParentId = parentId !== undefined ? (parentId || null) : category.parentId;
  if (nextParentId && !categories.some(item => item.id === nextParentId)) {
    throw new Error('Catégorie parente introuvable.');
  }
  if (nextParentId && nextParentId !== category.parentId && wouldCreateCycle(categories, id, nextParentId)) {
    throw new Error('Déplacement impossible : il créerait une boucle.');
  }

  const nextColor = color !== undefined ? (color || null) : category.color;

  return categories.map(item => item.id === id ? {
    ...item,
    label: nextLabel,
    color: nextColor,
    parentId: nextParentId,
  } : item);
}

export function moveCategory(categories, id, parentId = null) {
  const category = categories.find(item => item.id === id);
  if (!category) throw new Error('Catégorie introuvable.');
  if (parentId && !categories.some(item => item.id === parentId)) throw new Error('Catégorie parente introuvable.');
  if (parentId && wouldCreateCycle(categories, id, parentId)) throw new Error('Déplacement impossible : il créerait une boucle.');
  return categories.map(item => item.id === id ? { ...item, parentId } : item);
}

export function deleteCategory(categories, id, { cascade = false, deleteDescendants = false } = {}) {
  const category = categories.find(item => item.id === id);
  if (!category) throw new Error('Catégorie introuvable.');
  const descendants = getDescendants(categories, id);
  const idsToDelete = new Set((cascade || deleteDescendants) ? [id, ...descendants.map(item => item.id)] : [id]);
  if (!cascade && !deleteDescendants && descendants.length) {
    throw new Error('Cette catégorie contient des enfants. Utilisez une suppression en cascade ou déplacez-les d’abord.');
  }
  return categories.filter(item => !idsToDelete.has(item.id));
}
