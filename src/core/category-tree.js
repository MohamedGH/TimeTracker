/**
 * Hierarchical category domain model.
 *
 * A category is a node. `parentId: null` means root. Any node can have
 * children, so the depth is unlimited: category -> subcategory -> ...
 */

export function createCategory({ id, label, color = null, parentId = null, builtin = false }) {
  if (!id || !label) throw new Error('Une catégorie doit avoir un identifiant et un nom.');
  return { id, label: label.trim(), color, parentId, builtin };
}

export function migrateCategoryTree(customCategories = [], subCategories = []) {
  const nodes = [];
  const ids = new Set();

  for (const category of customCategories) {
    if (!category?.id || !category?.label || ids.has(category.id)) continue;
    nodes.push(createCategory({
      id: category.id,
      label: category.label,
      color: category.color ?? null,
      parentId: category.parentId ?? null,
      builtin: Boolean(category.builtin),
    }));
    ids.add(category.id);
  }

  for (const legacy of subCategories) {
    if (!legacy?.id || !legacy?.label) continue;
    const parentId = legacy.parentId ?? legacy.catId ?? null;
    if (parentId && !ids.has(parentId)) continue;

    let id = legacy.id;
    if (ids.has(id)) {
      id = `${parentId || 'root'}::${legacy.id}`;
      let suffix = 2;
      while (ids.has(id)) id = `${parentId || 'root'}::${legacy.id}-${suffix++}`;
    }

    nodes.push(createCategory({
      id,
      label: legacy.label,
      color: legacy.color ?? null,
      parentId,
      builtin: false,
    }));
    ids.add(id);
  }

  const knownIds = new Set(nodes.map(node => node.id));
  return nodes.map(node => ({
    ...node,
    parentId: node.parentId && knownIds.has(node.parentId) ? node.parentId : null,
  }));
}

export function getChildren(nodes, parentId = null) {
  return nodes.filter(node => (node.parentId ?? null) === parentId);
}

export function getRoots(nodes) {
  return getChildren(nodes, null);
}

export function getAncestors(nodes, nodeId) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const result = [];
  const visited = new Set();
  let current = byId.get(nodeId);
  while (current?.parentId && !visited.has(current.parentId)) {
    visited.add(current.parentId);
    current = byId.get(current.parentId);
    if (!current) break;
    result.unshift(current);
  }
  return result;
}

export function getDescendants(nodes, nodeId) {
  const result = [];
  const queue = [nodeId];
  const childrenByParent = new Map();
  for (const node of nodes) {
    const key = node.parentId ?? null;
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(node);
  }
  while (queue.length) {
    const parentId = queue.shift();
    for (const child of childrenByParent.get(parentId) ?? []) {
      result.push(child);
      queue.push(child.id);
    }
  }
  return result;
}

export function wouldCreateCycle(nodes, nodeId, newParentId) {
  if (!newParentId || nodeId === newParentId) return true;
  return getDescendants(nodes, nodeId).some(node => node.id === newParentId);
}

export function getCategoryPath(nodes, nodeId) {
  return [...getAncestors(nodes, nodeId), ...nodes.filter(node => node.id === nodeId)];
}

export function formatCategoryPath(nodes, nodeId, separator = ' > ') {
  return getCategoryPath(nodes, nodeId).map(node => node.label).join(separator);
}

export function validateCategoryTree(nodes) {
  const ids = new Set();
  for (const node of nodes) {
    if (!node?.id || !node?.label || ids.has(node.id)) return false;
    ids.add(node.id);
  }
  for (const node of nodes) {
    if (node.parentId && !ids.has(node.parentId)) return false;
    if (node.parentId && wouldCreateCycle(nodes, node.id, node.parentId)) return false;
  }
  return true;
}
