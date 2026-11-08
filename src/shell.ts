import {
  TEMPLATE_BRAND,
  filterFurniture,
  galleryBrands,
  galleryCategories,
  galleryItems,
  type FurnitureCategory,
  type GalleryItem,
} from './catalog/gallery';
import { furnitureThumbnail, productThumbnail } from './models/thumbnail';

export type Page = 'home' | 'scan' | 'view' | 'room';
const PAGES: Page[] = ['home', 'scan', 'view', 'room'];
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/**
 * App shell: Home gallery (brand row, search dropdown, cards with rendered thumbnails), page
 * switching via the URL hash, and the bottom navigation. refresh() rebuilds the gallery when the
 * catalogue changes (e.g. a new My furniture item).
 */
export function initShell(onSelect: (item: GalleryItem) => void) {
  const toggle = $<HTMLButtonElement>('search-toggle');
  const dropdown = $('search-dropdown');
  const search = $<HTMLInputElement>('furniture-search');
  const grid = $('furniture-grid');
  const shopArea = $('shop-area');
  const shopBrands = $('shop-brands');
  const filters = $('furniture-filters');

  let items: GalleryItem[] = [];
  let categories: FurnitureCategory[] = [];
  let openBrand: string | null = null;
  let selectedBrand = '';
  const selectedTypes = new Set<FurnitureCategory>();
  const brandPanels = new Map<string, HTMLElement>();
  const brandButtons = new Map<string, HTMLButtonElement>();
  const categoryButtons: Array<{ brand: string; category: FurnitureCategory | ''; button: HTMLButtonElement }> = [];
  const categoryInputs: HTMLInputElement[] = [];
  const cards = new Map<string, HTMLButtonElement>();
  const thumbnails = new Map<string, string>(); // survives rebuilds

  function closeSearch(restoreFocus = false) {
    dropdown.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toggle.focus();
  }
  function closeShop(restoreFocus = false) {
    const previous = openBrand;
    for (const [brand, panel] of brandPanels) {
      panel.hidden = true;
      brandButtons.get(brand)?.setAttribute('aria-expanded', 'false');
    }
    openBrand = null;
    if (restoreFocus && previous) brandButtons.get(previous)?.focus();
  }
  function openSearch() {
    closeShop();
    navigate('home');
    dropdown.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    search.focus();
  }
  function positionBrandDropdown() {
    if (!openBrand) return;
    const area = shopArea.getBoundingClientRect();
    const trigger = brandButtons.get(openBrand)!.getBoundingClientRect();
    const panel = brandPanels.get(openBrand)!;
    panel.style.left = `${Math.max(12, Math.min(trigger.left - area.left, area.width - panel.offsetWidth - 12))}px`;
  }

  // ---------- brand row ----------

  function buildBrands() {
    for (const panel of brandPanels.values()) panel.remove();
    brandPanels.clear();
    brandButtons.clear();
    categoryButtons.length = 0;
    shopBrands.replaceChildren();

    const allButton = document.createElement('button');
    allButton.type = 'button';
    allButton.className = 'brand-option';
    allButton.dataset.brand = '';
    allButton.textContent = 'All items';
    allButton.addEventListener('click', () => {
      closeShop();
      navigate('home');
      reset();
    });
    brandButtons.set('', allButton);
    shopBrands.append(allButton);

    galleryBrands(items).forEach((brand, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'brand-option';
      button.dataset.brand = brand;
      const label = document.createElement('span');
      label.textContent = brand;
      const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      arrow.classList.add('icon');
      arrow.setAttribute('viewBox', '0 0 24 24');
      arrow.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'm6 9 6 6 6-6');
      arrow.append(path);
      button.append(label, arrow);
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-controls', `brand-dropdown-${index}`);

      const panel = document.createElement('div');
      panel.id = `brand-dropdown-${index}`;
      panel.className = 'brand-dropdown';
      panel.hidden = true;
      const heading = document.createElement('p');
      heading.className = 'brand-dropdown-title';
      heading.textContent = brand;
      panel.append(heading);
      const brandItems = items.filter((item) => item.brand === brand);
      for (const category of ['', ...galleryCategories(brandItems)] as const) {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'category-option';
        const count = brandItems.filter((item) => !category || item.category === category).length;
        option.textContent = `${category || `All ${brand} items`} (${count})`;
        option.addEventListener('click', () => {
          selectedBrand = brand;
          selectedTypes.clear();
          if (category) selectedTypes.add(category);
          else categories.forEach((type) => selectedTypes.add(type));
          render();
          closeShop(true);
        });
        categoryButtons.push({ brand, category, button: option });
        panel.append(option);
      }
      button.addEventListener('click', () => {
        if (openBrand === brand) {
          closeShop();
          return;
        }
        closeSearch();
        closeShop();
        navigate('home');
        selectedBrand = brand;
        selectedTypes.clear();
        categories.forEach((type) => selectedTypes.add(type));
        render();
        openBrand = brand;
        panel.hidden = false;
        button.setAttribute('aria-expanded', 'true');
        positionBrandDropdown();
      });
      button.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          if (openBrand !== brand) button.click();
          panel.querySelector<HTMLButtonElement>('button')?.focus();
        }
      });
      brandButtons.set(brand, button);
      brandPanels.set(brand, panel);
      shopBrands.append(button);
      shopArea.append(panel);
    });
  }

  // ---------- type checkboxes in the search dropdown ----------

  function buildFilters() {
    filters.replaceChildren();
    categoryInputs.length = 0;
    for (const category of categories) {
      const option = document.createElement('label');
      option.className = 'filter-option';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = category;
      input.checked = selectedTypes.has(category);
      input.addEventListener('change', () => {
        if (input.checked) selectedTypes.add(category);
        else selectedTypes.delete(category);
        render();
      });
      option.append(input, document.createTextNode(category));
      categoryInputs.push(input);
      filters.append(option);
    }
  }

  // ---------- cards and thumbnails ----------

  // Keep model parsing bounded and defer off-screen thumbnails until they are near the viewport.
  const thumbnailQueue: Array<() => Promise<void>> = [];
  let activeThumbnails = 0;
  function processThumbnails() {
    while (activeThumbnails < 2 && thumbnailQueue.length) {
      const task = thumbnailQueue.shift()!;
      activeThumbnails++;
      void task().finally(() => {
        activeThumbnails--;
        processThumbnails();
      });
    }
  }
  const loadThumbnail = async (item: GalleryItem, img: HTMLImageElement) => {
    try {
      const cached = thumbnails.get(item.id);
      const src = cached ?? (item.source.kind === 'template' ? furnitureThumbnail(item.source.templateId) : await productThumbnail(item.source.glbUrl));
      thumbnails.set(item.id, src);
      img.src = src;
      img.dataset.loaded = 'true';
    } catch {
      img.alt = `Preview unavailable for ${item.name}. Open to view its 3D model.`;
      img.dataset.loaded = 'failed';
    }
  };
  const observer: IntersectionObserver | null =
    'IntersectionObserver' in window
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              observer!.unobserve(entry.target);
              const card = entry.target as HTMLButtonElement;
              const item = items.find((i) => i.id === card.dataset.itemId);
              if (item) thumbnailQueue.push(() => loadThumbnail(item, card.querySelector('img')!));
            }
            processThumbnails();
          },
          { rootMargin: '160px' },
        )
      : null;

  const PLACEHOLDER =
    'data:image/svg+xml,' +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><rect width="320" height="320" fill="#dadad8"/></svg>');

  function buildCards() {
    observer?.disconnect();
    cards.clear();
    grid.replaceChildren();
    for (const item of items) {
      const card = document.createElement('button');
      card.className = 'furniture-card';
      card.type = 'button';
      card.dataset.itemId = item.id;
      card.setAttribute('aria-label', `View ${item.name}${item.brand === TEMPLATE_BRAND ? '' : `, ${item.brand}`}`);
      const img = document.createElement('img');
      img.className = 'furniture-photo';
      img.width = 320;
      img.height = 320;
      img.alt = item.name;
      img.src = thumbnails.get(item.id) ?? PLACEHOLDER;
      const name = document.createElement('span');
      name.className = 'furniture-name';
      name.textContent = item.name;
      const brand = document.createElement('span');
      brand.className = 'furniture-brand';
      brand.textContent = item.brand;
      card.append(img, name, brand);
      card.addEventListener('click', () => {
        onSelect(item);
        navigate('view');
      });
      cards.set(item.id, card);
      grid.append(card);
      if (thumbnails.has(item.id)) continue;
      if (observer) observer.observe(card);
      else thumbnailQueue.push(() => loadThumbnail(item, img));
    }
    if (!observer) processThumbnails();
  }

  function render() {
    const results = filterFurniture(items, search.value, selectedTypes, selectedBrand);
    const shown = new Set(results.map((item) => item.id));
    for (const [id, card] of cards) card.hidden = !shown.has(id);
    for (const input of categoryInputs) input.checked = selectedTypes.has(input.value as FurnitureCategory);
    for (const [brand, button] of brandButtons) button.setAttribute('aria-pressed', String(brand === selectedBrand));
    for (const { brand, category, button } of categoryButtons) {
      button.setAttribute(
        'aria-pressed',
        String(
          brand === selectedBrand &&
            (category === '' ? selectedTypes.size === categories.length : selectedTypes.size !== categories.length && selectedTypes.has(category)),
        ),
      );
    }
    const active = search.value.trim() !== '' || selectedTypes.size !== categories.length || selectedBrand !== '';
    $('gallery-empty').hidden = results.length > 0;
    const count = `${results.length} ${results.length === 1 ? 'piece' : 'pieces'}`;
    $('search-count').textContent = `${count} found`;
    $('gallery-count').textContent = count;
    $('gallery-title').textContent = selectedBrand || 'All furniture';
    $('clear-shop-filters').hidden = !active;
    document.querySelector<HTMLElement>('.filter-dot')!.hidden = !active;
  }

  function reset() {
    search.value = '';
    selectedBrand = '';
    categories.forEach((category) => selectedTypes.add(category));
    render();
  }

  /** Rebuild everything from the current catalogue, keeping the user's search and filters. */
  function refresh() {
    const previousCategories = new Set(categories);
    items = galleryItems();
    categories = galleryCategories(items);
    // Newly appearing types start checked; types that vanished are dropped.
    for (const c of categories) if (!previousCategories.has(c)) selectedTypes.add(c);
    for (const c of [...selectedTypes]) if (!categories.includes(c)) selectedTypes.delete(c);
    if (selectedBrand && !galleryBrands(items).includes(selectedBrand)) selectedBrand = '';
    closeShop();
    buildBrands();
    buildFilters();
    buildCards();
    render();
  }

  toggle.addEventListener('click', () => (dropdown.hidden ? openSearch() : closeSearch()));
  $('search-close').addEventListener('click', () => closeSearch(true));
  for (const id of ['reset-filters', 'empty-reset', 'clear-shop-filters']) $(id).addEventListener('click', reset);
  search.addEventListener('input', render);
  shopBrands.addEventListener('scroll', positionBrandDropdown);
  window.addEventListener('resize', positionBrandDropdown);
  document.addEventListener('pointerdown', (event) => {
    if (!(event.target instanceof Node)) return;
    if (!$('search-area').contains(event.target)) closeSearch();
    if (!shopArea.contains(event.target)) closeShop();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!dropdown.hidden) closeSearch(true);
    if (openBrand) closeShop(true);
  });

  // ---------- pages ----------

  const pageListeners: Array<(page: Page) => void> = [];

  function currentPage(): Page {
    const requested = location.hash.slice(1) as Page;
    return PAGES.includes(requested) ? requested : 'home';
  }
  function showPage() {
    const page = currentPage();
    for (const id of PAGES) $(`${id}-page`).hidden = id !== page;
    for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-page]')) {
      if (link.dataset.page === page) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    document.title = `${page[0].toUpperCase()}${page.slice(1)} · Fit Check AR`;
    if (page !== 'home') {
      closeSearch();
      closeShop();
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
    pageListeners.forEach((fn) => fn(page));
  }
  function navigate(page: Page) {
    if (location.hash !== `#${page}`) location.hash = page;
    showPage();
  }
  window.addEventListener('hashchange', showPage);

  refresh();
  showPage();
  return { navigate, refresh, currentPage, onPage: (fn: (page: Page) => void) => pageListeners.push(fn) };
}
