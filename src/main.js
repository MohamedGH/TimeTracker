import { createAppState } from './app-state.js';
import { createUI } from './ui.js';
import { installCategorySelectors } from './category-selector.js';

async function bootstrap() {
  const root = document.getElementById('app');
  if (!root) throw new Error('Conteneur #app introuvable.');
  try {
    const { state, persist } = await createAppState();
    createUI({ root, state, persist });
    installCategorySelectors(root);
  } catch (error) {
    root.replaceChildren();
    const box = document.createElement('div');
    box.className = 'startup-error';
    const title = document.createElement('h1');
    title.textContent = 'TimeTracker ne peut pas démarrer';
    const message = document.createElement('p');
    message.textContent = error?.message || 'Une erreur inattendue est survenue.';
    box.append(title, message);
    root.appendChild(box);
    console.error(error);
  }
}

bootstrap();
