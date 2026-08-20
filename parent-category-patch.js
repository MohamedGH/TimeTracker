/*
 * TimeTracker — parent reassignment patch
 *
 * Add this script AFTER the main application script in index.html.
 * It extends the existing category editor so an already-created category
 * can be moved under another existing category (or back to the root).
 */
(function () {
  const originalCategoryModal = window.categoryModal;
  if (typeof originalCategoryModal !== 'function') return;

  function descendants(id) {
    const out = [];
    const walk = (parentId) => {
      (window.data?.categories || []).filter(c => (c.parentId ?? null) === parentId).forEach(c => {
        out.push(c.id);
        walk(c.id);
      });
    };
    walk(id);
    return out;
  }

  window.categoryModal = function (parentId = null, editId = null) {
    const data = window.data;
    if (!data || !Array.isArray(data.categories)) return originalCategoryModal(parentId, editId);

    const c = editId ? data.categories.find(x => x.id === editId) : null;
    if (!c) return originalCategoryModal(parentId, editId);

    const blocked = new Set([c.id, ...descendants(c.id)]);
    const options = data.categories
      .filter(x => !blocked.has(x.id))
      .map(x => {
        const path = typeof window.categoryPath === 'function'
          ? window.categoryPath(x.id).map(y => y.name).join(' › ')
          : x.name;
        const selected = (c.parentId ?? null) === x.id ? ' selected' : '';
        return `<option value="${x.id}"${selected}>${window.esc(path)}</option>`;
      }).join('');

    window.openModal(
      'Modifier la catégorie',
      `<div class="form">
        <label>Nom</label>
        <input id="catName" value="${window.esc(c.name)}">
        <label>Catégorie parente</label>
        <select id="catParent">
          <option value="">— Racine —</option>
          ${options}
        </select>
        <div class="notice">
          Vous pouvez déplacer cette catégorie sous une autre catégorie déjà créée.
          Les descendants restent attachés à cette catégorie.
        </div>
        <div class="actions">
          <button class="btn secondary" id="cancelCat">Annuler</button>
          <button class="btn" id="saveCat">Enregistrer</button>
        </div>
      </div>`
    );

    document.getElementById('cancelCat').onclick = window.closeModal;
    document.getElementById('saveCat').onclick = () => {
      const name = document.getElementById('catName').value.trim();
      const newParent = document.getElementById('catParent').value || null;
      if (!name) return;
      if (newParent && blocked.has(newParent)) {
        alert('Une catégorie ne peut pas être placée sous elle-même ou sous un de ses descendants.');
        return;
      }
      c.name = name;
      c.parentId = newParent;
      window.closeModal();
      window.save();
    };
  };
})();
