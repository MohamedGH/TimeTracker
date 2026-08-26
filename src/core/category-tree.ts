import type { Category } from '../types';

export function createCategory({
  id,
  label,
  color = null,
  parentId = null,
  builtin = false,
}: {
  id: string;
  label: string;
  color?: string | null;
  parentId?: string | null;
  builtin?: boolean;
}): Category {
  if (!id || !label) throw new Error('Une catégorie doit avoir un identifiant et un nom.');
  return { id, label: label.trim(), color, parentId, builtin };
}

export function getChildren(nodes: Category[], parentId: string | null = null): Category[] {
  return nodes.filter(node => (node.parentId ?? null) === parentId);
}

export function getRoots(nodes: Category[]): Category[] {
  return getChildren(nodes, null);
}

export function getAncestors(nodes: Category[], nodeId: string): Category[] {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const result: Category[] = [];
  const visited = new Set<string>();
  let current = byId.get(nodeId);
  while (current?.parentId && !visited.has(current.parentId)) {
    visited.add(current.parentId);
    current = byId.get(current.parentId);
    if (!current) break;
    result.unshift(current);
  }
  return result;
}

export function getDescendants(nodes: Category[], nodeId: string): Category[] {
  const result: Category[] = [];
  const queue = [nodeId];
  const childrenByParent = new Map<string | null, Category[]>();
  for (const node of nodes) {
    const key = node.parentId ?? null;
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key)!.push(node);
  }
  while (queue.length) {
    const parentId = queue.shift()!;
    for (const child of childrenByParent.get(parentId) ?? []) {
      result.push(child);
      queue.push(child.id);
    }
  }
  return result;
}

export function wouldCreateCycle(nodes: Category[], nodeId: string, newParentId: string | null): boolean {
  if (!newParentId || nodeId === newParentId) return true;
  return getDescendants(nodes, nodeId).some(node => node.id === newParentId);
}

export function getCategoryPath(nodes: Category[], nodeId: string): Category[] {
  return [...getAncestors(nodes, nodeId), ...nodes.filter(node => node.id === nodeId)];
}

export function formatCategoryPath(nodes: Category[], nodeId: string, separator = ' > '): string {
  return getCategoryPath(nodes, nodeId).map(node => node.label).join(separator);
}

export function validateCategoryTree(nodes: Category[]): boolean {
  const ids = new Set<string>();
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
