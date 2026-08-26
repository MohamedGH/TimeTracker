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

  return activities.map(activity => {
    if (!activity || typeof activity !== 'object') return null;
    const categoryId = activity.categoryId
      ?? (activity.sub ? subByLegacyPair.get(`${activity.cat}::${activity.sub}`) : null)
      ?? (activity.cat && categories.some(category => category.id === activity.cat) ? activity.cat : null)
      ?? null;
    const { cat: _cat, sub: _sub, subCategoryId: _subCategoryId, ...rest } = activity;
    return normalizeSavedActivity({ ...rest, categoryId }, categories);
  }).filter(Boolean);
}
