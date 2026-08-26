import { createCategory, getChildren, getRoots, getDescendants, formatCategoryPath, wouldCreateCycle } from './core/category-tree.js';
import { addCategory, deleteCategory, moveCategory, renameCategory } from './state/category-actions.js';
import { createTimeEntry } from './core/time-entry.js';
import { createActiveTimer, elapsedSeconds } from './core/timer.js';
import { today, formatTime, splitEntryByDay } from './core/time.js';
import { buildExportPayload, parseImportPayload } from './core/import-export.js';
import { renderCharts, destroyCharts } from './charts/dashboard.js';

export function createUI({ root, state, persist, onChange }) {
  let timerInterval;

  function rerender() { render(); onChange?.(); }

  function render() {
    root.replaceChildren();
    root.appendChild(header());
    const content = document.createElement('main');
    content.className = 'content';
    if (state.tab === 'entry') content.appendChild(entryPage());
    if (state.tab === 'dashboard') content.appendChild(dashboardPage());
    if (state.tab === 'categories') content.appendChild(categoriesPage());
    root.appendChild(content);
    if (state.modal) root.appendChild(modal());
    if (state.activeTimer) startTicker(); else stopTicker();
    if (state.tab === 'dashboard') requestAnimationFrame(drawCharts);
  }

  function header() {
    const wrap = el('header', 'app-header');
    const title = el('h1', 'lt-title', 'Carnet du temps');
    wrap.appendChild(title);
    const tabs = el('nav', 'tabs');
    for (const [id, label] of [['entry', 'Saisie'], ['dashboard', 'Tableau de bord'], ['categories', 'Catégories']]) {
      const b = el('button', `tab-btn${state.tab === id ? ' active' : ''}`, label);
      b.type = 'button'; b.addEventListener('click', () => { state.tab = id; state.modal = null; rerender(); });
      tabs.appendChild(b);
    }
    wrap.appendChild(tabs);
    return wrap;
  }

  function entryPage() {
    const page = document.createDocumentFragment();
    const timer = timerCard();
    page.appendChild(timer);
    page.appendChild(entryCard());
    page.appendChild(savedActivitiesCard());
    page.appendChild(recentEntriesCard());
    page.appendChild(dataActions());
    return page;
  }

  function timerCard() {
    const card = el('section', 'card');
    card.appendChild(el('h2', 'card-title', 'Timer'));
    if (state.activeTimer) {
      const box = el('div', 'timer-active');
      const label = el('div', 'timer-label'); label.textContent = `${state.activeTimer.activity} · ${categoryPath(state.activeTimer.categoryId)}`;
      const clock = el('div', 't-clock'); clock.dataset.timerClock = '1'; clock.textContent = clockText();
      const stop = button('Arrêter le timer', 'danger'); stop.addEventListener('click', stopTimer);
      box.append(label, clock, stop); card.appendChild(box);
    } else {
      card.appendChild(el('p', 'muted', 'Aucun timer actif. Lancez-le depuis le formulaire ou une activité enregistrée.'));
    }
    return card;
  }

  function entryCard() {
    const card = el('section', 'card'); card.appendChild(el('h2', 'card-title', state.editingEntryId ? 'Modifier une entrée' : 'Nouvelle entrée'));
    const entry = state.editingEntryId ? state.entries.find(x => x.id === state.editingEntryId) : null;
    const form = el('form', 'entry-form');
    const activity = inputField('Activité', 'text', entry?.activity || '', true);
    const category = categoryField(entry?.categoryId || state.categories[0]?.id || null);
    const date = inputField('Date', 'date', entry?.date || today(), true);
    const start = inputField('Début', 'time', entry?.start || '09:00', true);
    const end = inputField('Fin', 'time', entry?.end || '10:00', true);
    const row = el('div', 'row'); row.append(date.wrap, start.wrap, end.wrap);
    const submit = button(entry ? 'Enregistrer les modifications' : 'Enregistrer'); submit.type = 'submit';
    const timerButton = button('Démarrer le timer', 'secondary'); timerButton.type = 'button';
    timerButton.addEventListener('click', () => startTimer(activity.input.value.trim(), category.select.value, date.input.value, start.input.value));
    form.append(activity.wrap, category.wrap, row, submit, timerButton);
    if (entry) { const cancel = button('Annuler', 'secondary'); cancel.type = 'button'; cancel.addEventListener('click', () => { state.editingEntryId = null; rerender(); }); form.appendChild(cancel); }
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const value = createTimeEntry({ id: entry?.id || crypto.randomUUID(), activity: activity.input.value, categoryId: category.select.value || null, date: date.input.value, start: start.input.value, end: end.input.value });
      if (!value.activity || !date.input.value || value.mins <= 0) return showError(card, 'Vérifiez l’activité, la date et les horaires.');
      if (entry) state.entries = state.entries.map(x => x.id === entry.id ? value : x); else state.entries = [value, ...state.entries];
      state.editingEntryId = null; await persist(); rerender();
    });
    card.appendChild(form); return card;
  }

  function savedActivitiesCard() {
    const card = el('section', 'card'); card.appendChild(el('h2', 'card-title', 'Activités enregistrées'));
    const add = button('Ajouter une activité', 'secondary'); add.addEventListener('click', () => { state.modal = { type: 'activity' }; rerender(); }); card.appendChild(add);
    const list = el('div');
    for (const activity of state.activities) {
      const row = el('div', 'entry-row');
      const label = el('div'); label.textContent = `${activity.label || activity.activity || ''} · ${categoryPath(activity.categoryId)}`;
      const start = button('Démarrer', 'small'); start.addEventListener('click', () => startTimer(activity.label || activity.activity, activity.categoryId, today(), currentTime()));
      const del = button('×', 'small danger'); del.title = 'Supprimer'; del.addEventListener('click', async () => { state.activities = state.activities.filter(x => x.id !== activity.id); await persist(); rerender(); });
      row.append(label, start, del); list.appendChild(row);
    }
    card.appendChild(list); return card;
  }

  function recentEntriesCard() {
    const card = el('section', 'card'); card.appendChild(el('h2', 'card-title', 'Dernières entrées'));
    for (const entry of state.entries.slice(0, 10)) card.appendChild(entryRow(entry));
    if (!state.entries.length) card.appendChild(el('p', 'empty', 'Aucune entrée.'));
    return card;
  }

  function entryRow(entry) {
    const row = el('div', 'entry-row');
    const info = el('div'); const title = el('strong'); title.textContent = entry.activity;
    const meta = el('div', 'entry-meta'); meta.textContent = `${entry.date} · ${entry.start}–${entry.end} · ${entry.mins} min · ${categoryPath(entry.categoryId)}`;
    info.append(title, meta);
    const edit = button('Modifier', 'small'); edit.addEventListener('click', () => { state.editingEntryId = entry.id; state.tab = 'entry'; rerender(); });
    const del = button('Supprimer', 'small danger'); del.addEventListener('click', async () => { state.entries = state.entries.filter(x => x.id !== entry.id); await persist(); rerender(); });
    row.append(info, edit, del); return row;
  }

  function dashboardPage() {
    const page = document.createDocumentFragment();
    const periods = el('div', 'period-tabs');
    for (const p of ['7','14','30','90']) { const b = button(`${p} jours`, state.period === p ? 'active' : 'secondary'); b.addEventListener('click', () => { state.period = p; rerender(); }); periods.appendChild(b); }
    page.appendChild(periods);
    const data = dashboardEntries();
    const total = data.reduce((n, e) => n + e.mins, 0);
    const days = new Set(data.map(e => e.date)).size;
    const metrics = el('div', 'metric-grid'); metrics.append(metric('Temps total', `${Math.floor(total/60)}h ${total%60}m`), metric('Entrées', String(data.length)), metric('Jours actifs', String(days))); page.appendChild(metrics);
    const charts = el('section', 'card'); charts.appendChild(el('h2', 'card-title', 'Statistiques')); const dc = document.createElement('canvas'); dc.id='day-chart'; const hc=document.createElement('canvas'); hc.id='hour-chart'; charts.append(el('h3','chart-title','Temps par jour'),dc,el('h3','chart-title','Répartition par heure'),hc); page.appendChild(charts);
    const cats = el('section', 'card'); cats.appendChild(el('h2','card-title','Par catégorie')); const totals = new Map(); for (const e of data) totals.set(e.categoryId,(totals.get(e.categoryId)||0)+e.mins); for (const [id, mins] of totals) { const r=el('div','entry-row'); const n=el('span'); n.textContent=categoryPath(id); const v=el('strong'); v.textContent=`${Math.floor(mins/60)}h ${mins%60}m`; r.append(n,v); cats.appendChild(r); } page.appendChild(cats); return page;
  }

  function categoriesPage() {
    const page = document.createDocumentFragment(); const card=el('section','card'); card.appendChild(el('h2','card-title','Arbre des catégories'));
    const add=button('Nouvelle catégorie racine'); add.addEventListener('click',()=>{state.modal={type:'category',parentId:null};rerender();}); card.appendChild(add);
    const tree=el('div','category-tree'); for(const c of getRoots(state.categories)) tree.appendChild(categoryNode(c)); card.appendChild(tree); page.appendChild(card); return page;
  }

  function categoryNode(category) {
    const wrap=el('div','category-node'); const head=el('div','category-head'); const label=el('strong'); label.textContent=category.label; const path=el('span','muted'); path.textContent=categoryPath(category.id); head.append(label,path); wrap.appendChild(head);
    const actions=el('div','category-actions');
    const child=button('Sous-catégorie','small'); child.disabled=false; child.addEventListener('click',()=>{state.modal={type:'category',parentId:category.id};rerender();});
    const rename=button('Renommer','small'); rename.addEventListener('click',()=>{state.modal={type:'rename',id:category.id};rerender();});
    const del=button('Supprimer','small danger'); del.disabled=category.builtin; del.addEventListener('click',async()=>{if(category.builtin)return;state.categories=deleteCategory(state.categories,category.id,{deleteDescendants:true});await persist();rerender();});
    actions.append(child,rename,del); wrap.appendChild(actions);
    const children=el('div','category-children'); for(const c of getChildren(state.categories,category.id)) children.appendChild(categoryNode(c)); wrap.appendChild(children); return wrap;
  }

  function modal() {
    const overlay=el('div','modal-overlay'); const box=el('div','modal-box'); const close=button('×','modal-close'); close.addEventListener('click',()=>{state.modal=null;rerender();}); const head=el('div','modal-head'); head.append(el('h2','card-title',modalTitle()),close); box.appendChild(head);
    const form=el('form'); const m=state.modal;
    if(m.type==='activity') { const a=inputField('Nom','text','',true); const c=categoryField(state.categories[0]?.id); form.append(a.wrap,c.wrap,button('Enregistrer')); form.addEventListener('submit',async e=>{e.preventDefault();state.activities.push({id:crypto.randomUUID(),label:a.input.value.trim(),categoryId:c.select.value});state.modal=null;await persist();rerender();}); }
    else { const existing=m.type==='rename'?state.categories.find(c=>c.id===m.id):null; const name=inputField('Nom','text',existing?.label||'',true); const color=inputField('Couleur','color',existing?.color||'#5C7A5E',false); form.append(name.wrap,color.wrap,button(existing?'Renommer':'Créer')); form.addEventListener('submit',async e=>{e.preventDefault();const label=name.input.value.trim();if(!label)return; if(existing) state.categories=renameCategory(state.categories,m.id,label); else {const id=uniqueCategoryId(label);state.categories=addCategory(state.categories,{...createCategory({id,label,color:color.input.value,parentId:m.parentId}),builtin:false});} state.modal=null;await persist();rerender();}); }
    box.appendChild(form); overlay.appendChild(box); return overlay;
  }

  function modalTitle(){if(state.modal.type==='activity')return'Activité enregistrée';if(state.modal.type==='rename')return'Renommer la catégorie';return state.modal.parentId?'Nouvelle sous-catégorie':'Nouvelle catégorie';}
  function categoryField(selected){const wrap=el('div','field');wrap.appendChild(labelNode('Catégorie'));const select=document.createElement('select');select.required=true;for(const c of state.categories){const o=document.createElement('option');o.value=c.id;o.textContent=formatCategoryPath(state.categories,c.id);o.selected=c.id===selected;select.appendChild(o);}wrap.appendChild(select);return {wrap,select};}
  function inputField(label,type,value,required){const wrap=el('div','field');wrap.appendChild(labelNode(label));const input=document.createElement('input');input.type=type;input.value=value??'';input.required=required;wrap.appendChild(input);return {wrap,input};}
  function labelNode(text){const l=document.createElement('label');l.textContent=text;return l;}

  function dataActions(){const card=el('section','card');card.appendChild(el('h2','card-title','Données'));const row=el('div','action-row');const exp=button('Exporter');exp.addEventListener('click',exportData);const imp=button('Importer');imp.addEventListener('click',()=>{const f=document.createElement('input');f.type='file';f.accept='.json,application/json';f.addEventListener('change',()=>importFile(f));f.click();});row.append(exp,imp);card.appendChild(row);return card;}

  function exportData(){const payload=buildExportPayload({entries:state.entries,savedActivities:state.activities,categories:state.categories});const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`time-tracker-${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),0);}
  async function importFile(input){const file=input.files?.[0];if(!file)return;try{const data=parseImportPayload(await file.text());state.entries=data.entries;state.activities=data.savedActivities;state.categories=mergeCategoriesForImport(data.categories);await persist();state.error=null;rerender();}catch(e){state.error=e.message;rerender();}}
  function mergeCategoriesForImport(imported){const defaults=state.categories.filter(c=>c.builtin);const ids=new Set(defaults.map(c=>c.id));return [...defaults,...imported.filter(c=>c?.id&&!ids.has(c.id))];}

  async function startTimer(activity,categoryId,date,startTime){if(!activity||!categoryId)return;state.activeTimer=createActiveTimer({activity,cat:categoryId,startTs:Date.now(),startTime,date});await persist();rerender();}
  async function stopTimer(){if(!state.activeTimer)return;const end=currentTime();const timer=state.activeTimer;const entry=createTimeEntry({id:crypto.randomUUID(),activity:timer.activity,categoryId:timer.cat,date:timer.date,start:timer.startTime,end,mins:elapsedSeconds(timer)/60});state.entries=[entry,...state.entries];state.activeTimer=null;await persist();rerender();}
  function clockText(){return formatClock(elapsedSeconds(state.activeTimer));}
  function startTicker(){stopTicker();timerInterval=setInterval(()=>{const clock=root.querySelector('[data-timer-clock]');if(clock)clock.textContent=clockText();},1000);}
  function stopTicker(){if(timerInterval){clearInterval(timerInterval);timerInterval=undefined;}}
  function dashboardEntries(){const end=new Date();const days=Number(state.period)||7;const start=new Date(end);start.setDate(start.getDate()-days+1);const min=start.toISOString().slice(0,10),max=end.toISOString().slice(0,10);return state.entries.flatMap(splitEntryByDay).filter(e=>e.date>=min&&e.date<=max);}
  function drawCharts(){const d=root.querySelector('#day-chart'),h=root.querySelector('#hour-chart');if(d&&h)renderCharts({dayCanvas:d,hourCanvas:h,entries:dashboardEntries()});}
  function categoryPath(id){return id?formatCategoryPath(state.categories,id):'Sans catégorie';}
  function currentTime(){const d=new Date();return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;}
  function uniqueCategoryId(label){let base=label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'')||'category';let id=base,n=2;while(state.categories.some(c=>c.id===id))id=`${base}-${n++}`;return id;}
  function showError(card,message){const e=el('div','error',message);card.insertBefore(e,card.querySelector('form'));}
  function metric(label,value){const m=el('div','metric');m.append(el('div','label',label),el('div','value',value));return m;}
  function formatClock(seconds){const h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;}
  function button(text,kind=''){const b=document.createElement('button');b.type='button';b.className=kind?`btn ${kind}`:'btn';b.textContent=text;return b;}
  function el(tag,className,text){const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;}

  render();
  return { render, destroy: () => { stopTicker(); destroyCharts(); } };
}
