/**
 * Saved activities reference a category node at any depth.
 */

export function normalizeSavedActivity(activity, categories = []) {
  if (!activity || typeof activity !== 'object') return null;

  const categoryId = activity.categoryId
    ?? activity.subCategoryId
    ?? activity.cat
    ?? null;

  if (categoryId && !categories.some(category => category.id === categoryId)) {
    return null;
  }

  return {
    id: String(activity.id ?? crypto.randomUUID()),
    label: String(activity.label ?? activity.activity ?? '').trim(),
    categoryId,
  };
}

export function migrateSavedActivities(activities = [], categories = [], subCategories = []) {
  const subByLegacyPair = new Map(
    subCategories
      .filter(item => item?.id && item?.catId)
      .map(item => [`${item.catId}::${item.label}`, item.id]),
  );

  return activities
    .map(activity => {
      if (activity?.categoryId) return activity;

      const legacySubId = activity?.sub
        ? subByLegacyPair.get(`${activity.cat}::${activity.sub}`)
        : null;

      return {
        ...activity,
        categoryId: legacySubId ?? activity?.cat ?? null,
      };
    })
    .map(activity => normalizeSavedActivity(activity, categories))
    .filter(Boolean);
}
