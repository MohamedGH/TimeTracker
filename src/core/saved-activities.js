/** Canonical saved activities reference a category node at any depth. */
export function normalizeSavedActivity(activity, categories = []) {
  if (!activity || typeof activity !== 'object') return null;
  const categoryId = activity.categoryId ?? null;
  if (categoryId && !categories.some(category => category.id === categoryId)) return null;
  return {
    id: String(activity.id ?? crypto.randomUUID()),
    label: String(activity.label ?? activity.activity ?? '').trim(),
    categoryId,
  };
}

/** One-way compatibility migration for legacy saved activities. */
export function migrateSavedActivities(activities = [], categories = [], subCategories = []) {
  const subByLegacyPair = new Map();
  for (const item of subCategories) {
    if (!item?.catId || !item?.label) continue;
    const migrated = categories.find(category =>
      category.parentId === item.catId && category.label === String(item.label).trim()
    );
    if (migrated) subByLegacyPair.set(`${item.catId}::${item.label}`, migrated.id);
  }

  const categoryIds = new Set(categories.map(category => String(category.id)));
  const categoryLabels = new Set(
    categories
      .map(category => String(category.label || '').trim().toLowerCase())
      .filter(Boolean),
  );

  return activities.map(activity => {
    if (!activity || typeof activity !== 'object') return null;

    const rawLabel = String(activity.label ?? activity.name ?? activity.activity ?? '').trim();
    const legacyId = activity.id == null ? '' : String(activity.id);

    // Legacy exports from older builds could contain category records in
    // savedActivities. Never migrate those records back into the activity list.
    // This is intentionally done during import, so a fresh import cannot
    // recreate the bug after the runtime cleanup has already run.
    if (!rawLabel || rawLabel.toLowerCase() === 'sans catégorie' || categoryIds.has(legacyId) || categoryLabels.has(rawLabel.toLowerCase())) {
      return null;
    }

    const categoryId = activity.categoryId
      ?? (activity.sub ? subByLegacyPair.get(`${activity.cat}::${activity.sub}`) : null)
      ?? (activity.cat && categories.some(category => category.id === activity.cat) ? activity.cat : null)
      ?? null;
    const { cat: _cat, sub: _sub, subCategoryId: _subCategoryId, name: _name, count: _count, ...rest } = activity;
    return normalizeSavedActivity({ ...rest, label: rawLabel, categoryId }, categories);
  }).filter(Boolean);
}