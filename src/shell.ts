import { FURNITURE_TYPES, GALLERY, filterFurniture } from './catalog/gallery';
import type { TemplateId } from './catalog/templates';
import { furnitureThumbnail } from './models/thumbnail';

export type Page = 'home' | 'scan' | 'view';

export function initShell(onSelect: (id: TemplateId) => void) {
  const toggle = document.querySelector<HTMLButtonElement>('#search-toggle')!;
  const dropdown = document.querySelector<HTMLElement>('#search-dropdown')!;
  const search = document.querySelector<HTMLInputElement>('#furniture-search')!;
  const filters = document.querySelector<HTMLElement>('#furniture-filters')!;
  const grid = document.querySelector<HTMLElement>('#furniture-grid')!;
  const cards = new Map<TemplateId, HTMLButtonElement>();
  const selectedTypes = new Set(Object.keys(FURNITURE_TYPES) as TemplateId[]);

  function setSearchOpen(open: boolean, restoreFocus = false) {
    dropdown.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      navigate('home');
      search.focus();
    } else if (restoreFocus) toggle.focus();
  }

  for (const [id, label] of Object.entries(FURNITURE_TYPES)) {
    const option = document.createElement('label');
    option.className = 'filter-option';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = id;
    input.checked = true;
    input.addEventListener('change', () => {
      if (input.checked) selectedTypes.add(id as TemplateId);
      else selectedTypes.delete(id as TemplateId);
      render();
    });
    option.append(input, document.createTextNode(label));
    filters.append(option);
  }

  for (const item of GALLERY) {
    const card = document.createElement('button');
    card.className = 'furniture-card';
    card.type = 'button';
    card.setAttribute('aria-label', `View ${item.name}`);
    const img = document.createElement('img');
    img.className = 'furniture-photo';
    img.width = 320;
    img.height = 320;
    img.alt = item.name;
    img.src = furnitureThumbnail(item.id);
    const name = document.createElement('span');
    name.className = 'furniture-name';
    name.textContent = item.name;
    card.append(img, name);
    card.addEventListener('click', () => { onSelect(item.id); navigate('view'); });
    cards.set(item.id, card);
    grid.append(card);
  }

  function render() {
    const results = filterFurniture(GALLERY, search.value, selectedTypes);
    const shown = new Set(results.map(item => item.id));
    for (const [id, card] of cards) card.hidden = !shown.has(id);
    document.querySelector<HTMLElement>('#gallery-empty')!.hidden = results.length > 0;
    document.querySelector('#search-count')!.textContent = `${results.length} ${results.length === 1 ? 'piece' : 'pieces'} found`;
    document.querySelector<HTMLElement>('.filter-dot')!.hidden = search.value.trim() === '' && selectedTypes.size === GALLERY.length;
  }

  function reset() {
    search.value = '';
    for (const input of filters.querySelectorAll<HTMLInputElement>('input')) {
      input.checked = true;
      selectedTypes.add(input.value as TemplateId);
    }
    render();
  }

  toggle.addEventListener('click', () => setSearchOpen(dropdown.hasAttribute('hidden')));
  document.querySelector('#search-close')!.addEventListener('click', () => setSearchOpen(false, true));
  document.querySelector('#reset-filters')!.addEventListener('click', reset);
  document.querySelector('#empty-reset')!.addEventListener('click', reset);
  search.addEventListener('input', render);
  document.addEventListener('pointerdown', event => {
    if (!(event.target instanceof Node) || !document.querySelector('#search-area')!.contains(event.target)) setSearchOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !dropdown.hidden) setSearchOpen(false, true);
  });

  function showPage() {
    const requested = location.hash.slice(1);
    const page: Page = requested === 'scan' || requested === 'view' ? requested : 'home';
    for (const id of ['home', 'scan', 'view']) document.getElementById(`${id}-page`)!.hidden = id !== page;
    for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-page]')) {
      if (link.dataset.page === page) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    document.title = `${page[0].toUpperCase()}${page.slice(1)} · Fit Check AR`;
    if (page !== 'home') setSearchOpen(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function navigate(page: Page) {
    if (location.hash !== `#${page}`) location.hash = page;
    // Update immediately so focus and the displayed panel agree within this event.
    showPage();
  }

  window.addEventListener('hashchange', showPage);
  showPage();
  render();
  return { navigate };
}
