import './style.css';
import type { ModelViewerElement } from '@google/model-viewer';
import {
  DIMENSION_KEYS,
  formatLength,
  fromMeters,
  parseLength,
  toMeters,
  type DimensionKey,
  type DimensionsM,
  type RangeM,
  type Unit,
} from './domain/dimensions';
import { checkFit } from './domain/fit';
import { TEMPLATES, TEMPLATE_IDS, type TemplateId } from './catalog/templates';
import { buildTemplate, disposeGroup } from './models/buildTemplate';
import { exportGlb, ObjectUrlPool } from './models/exportGlb';
import { SCANS, resolveScan, type ScanAsset } from './models/scanCatalog';
import {
  BRANDS,
  FURNITURE_TYPES,
  MY_FURNITURE,
  allProducts,
  describeColors,
  filterProducts,
  getProduct,
  resolveColors,
  setCustomProducts,
  type ColorChoices,
  type Product,
} from './models/productCatalog';
import { ScanFlow } from './scan/scanFlow';
import { FurnitureViewer } from './viewer/furnitureViewer';

type FurnitureSource =
  | { kind: 'template'; templateId: TemplateId; size: DimensionsM }
  | { kind: 'product'; productId: string; size: DimensionsM }
  | { kind: 'scan'; assetId: string; measuredSize: DimensionsM };

type Mode = 'template' | 'product' | 'scan';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const viewer = new FurnitureViewer($<ModelViewerElement>('viewer'));
const urls = new ObjectUrlPool();

const els = {
  arButton: $<HTMLButtonElement>('ar-button'),
  arNote: $('ar-note'),
  status: $('status'),
  dimsBadge: $('dims-badge'),
  templatePanel: $('template-panel'),
  templateSelect: $<HTMLSelectElement>('template-select'),
  dimsFields: $('dims-fields'),
  resetDims: $<HTMLButtonElement>('reset-dims'),
  resetView: $<HTMLButtonElement>('reset-view'),
  productPanel: $('product-panel'),
  productSearch: $<HTMLInputElement>('product-search'),
  addOwn: $<HTMLButtonElement>('add-own'),
  brandFilter: $<HTMLSelectElement>('brand-filter'),
  typeFilter: $<HTMLSelectElement>('type-filter'),
  productCount: $('product-count'),
  productList: $('product-list'),
  productInfo: $('product-info'),
  productColors: $('product-colors'),
  scanPanel: $('scan-panel'),
  scanInfo: $('scan-info'),
  gapFields: $('gap-fields'),
  gapRotate: $<HTMLInputElement>('gap-rotate'),
  fitResult: $('fit-result'),
};

const LABELS: Record<DimensionKey, string> = { width: 'Width', depth: 'Depth', height: 'Height' };
const GAP_RANGE: RangeM = { min: 0.01, max: 20 };
const DEBOUNCE_MS = 350;

const state = {
  mode: 'template' as Mode,
  templateId: 'table' as TemplateId,
  productId: allProducts()[0].id,
  /** Chosen colour option per product and part. */
  colorChoices: {} as Record<string, ColorChoices>,
  unit: 'cm' as Unit,
  /** Incremented for every preview request; older results are ignored. */
  revision: 0,
  busy: false,
  /** False while the size inputs contain an error. */
  inputsValid: true,
  /** What the viewer is currently displaying (always a valid model). */
  shown: null as FurnitureSource | null,
  scan: null as ScanAsset | null,
};

// ---------- Form fields ----------

type Field = { input: HTMLInputElement; error: HTMLElement; unit: HTMLElement };

function makeField(container: HTMLElement, id: string, label: string): Field {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  wrap.innerHTML = `
    <label class="field-label" for="${id}">${label}</label>
    <div class="input-row">
      <input type="text" inputmode="decimal" autocomplete="off" id="${id}" aria-describedby="${id}-error" />
      <span class="unit"></span>
    </div>
    <p class="field-error" id="${id}-error"></p>`;
  container.append(wrap);
  return {
    input: wrap.querySelector('input')!,
    error: wrap.querySelector('.field-error')!,
    unit: wrap.querySelector('.unit')!,
  };
}

const dimFields = Object.fromEntries(
  DIMENSION_KEYS.map((k) => [k, makeField(els.dimsFields, `dim-${k}`, LABELS[k])]),
) as Record<DimensionKey, Field>;

const gapFields = {
  width: makeField(els.gapFields, 'gap-width', 'Gap width (side to side)'),
  depth: makeField(els.gapFields, 'gap-depth', 'Gap depth (front to back)'),
};

const allFields = [...Object.values(dimFields), ...Object.values(gapFields)];

/** Value for an input box: 0.1 cm or 0.01 in precision. */
function inputValue(meters: number, unit: Unit): string {
  const step = unit === 'cm' ? 10 : 100;
  return String(Math.round(fromMeters(meters, unit) * step) / step);
}

function setFieldError(f: Field, message: string | null) {
  f.error.textContent = message ?? '';
  f.input.setAttribute('aria-invalid', message ? 'true' : 'false');
}

function fillDims(size: DimensionsM) {
  for (const k of DIMENSION_KEYS) {
    dimFields[k].input.value = inputValue(size[k], state.unit);
    setFieldError(dimFields[k], null);
  }
}

/** Validate all size inputs, showing inline errors. Returns meters, or null if any field is invalid. */
function readDims(): DimensionsM | null {
  const ranges = TEMPLATES[state.templateId].ranges;
  const out: Partial<DimensionsM> = {};
  let ok = true;
  for (const k of DIMENSION_KEYS) {
    const r = parseLength(dimFields[k].input.value, state.unit, ranges[k], LABELS[k]);
    setFieldError(dimFields[k], r.ok ? null : r.error);
    if (r.ok) out[k] = r.meters;
    else ok = false;
  }
  return ok ? (out as DimensionsM) : null;
}

// ---------- Status and AR availability ----------

function setStatus(text: string, kind: 'info' | 'error' = 'info') {
  els.status.textContent = text;
  els.status.classList.toggle('error', kind === 'error');
}

function shownSize(): DimensionsM | null {
  const s = state.shown;
  if (!s) return null;
  return s.kind === 'scan' ? s.measuredSize : s.size;
}

/** AR may launch only when the loaded model is exactly what the user selected. */
function updateArAvailability() {
  const s = state.shown;
  const matches =
    !!s &&
    (state.mode === 'template'
      ? s.kind === 'template' && s.templateId === state.templateId && state.inputsValid
      : state.mode === 'product'
        ? s.kind === 'product' && s.productId === state.productId
        : s.kind === 'scan');
  els.arButton.disabled = state.busy || !matches;
  els.arButton.hidden = !viewer.canActivateAR;
  els.arNote.hidden = state.shown === null || viewer.canActivateAR;
}

function setBusy(busy: boolean, text?: string) {
  state.busy = busy;
  viewer.el.setAttribute('aria-busy', String(busy));
  if (text) setStatus(text);
  updateArAvailability();
}

function renderShown() {
  const size = shownSize();
  if (!size) {
    els.dimsBadge.textContent = '';
    return;
  }
  const u = state.unit;
  const shown = state.shown;
  const prefix =
    shown?.kind === 'scan'
      ? 'Measured: '
      : shown?.kind === 'product'
        ? getProduct(shown.productId)?.custom
          ? 'Your measurements: '
          : 'Sized like product: '
        : '';
  els.dimsBadge.textContent = `${prefix}W ${formatLength(size.width, u)} × D ${formatLength(size.depth, u)} × H ${formatLength(size.height, u)}`;
  updateFit();
}

// ---------- Preview pipeline ----------

async function showTemplate(templateId: TemplateId, size: DimensionsM) {
  const rev = ++state.revision;
  setBusy(true, 'Rebuilding preview…');

  let blob: Blob;
  try {
    const group = buildTemplate(TEMPLATES[templateId], size);
    try {
      blob = await exportGlb(group);
    } finally {
      disposeGroup(group);
    }
  } catch (err) {
    console.error(err);
    if (rev === state.revision) {
      setBusy(false);
      setStatus('Could not build this model. Try a different size.', 'error');
    }
    return;
  }
  if (rev !== state.revision) return; // A newer edit already started.

  const glbUrl = urls.create(blob);
  const result = await viewer.show({ glbUrl, revision: rev });
  if (result !== 'loaded') {
    urls.revoke(glbUrl);
    if (result === 'error') {
      setBusy(false);
      setStatus('The preview failed to load. Edit a size to try again.', 'error');
    }
    return;
  }
  urls.revokeAllExcept(glbUrl);
  state.shown = { kind: 'template', templateId, size };
  setBusy(false, state.inputsValid ? 'Ready.' : undefined);
  renderShown();
}

/** Show a pre-built model file (a popular product or a scan). */
async function showFile(file: { glbUrl: string; usdzUrl?: string }, source: FurnitureSource, what: string) {
  const rev = ++state.revision;
  setBusy(true, `Loading ${what}…`);
  const result = await viewer.show({ glbUrl: file.glbUrl, usdzUrl: file.usdzUrl, revision: rev });
  if (result === 'superseded') return;
  if (result === 'error') {
    setBusy(false);
    setStatus(`The ${what} failed to load.`, 'error');
    return;
  }
  urls.revokeAllExcept(null);
  state.shown = source;
  setBusy(false, 'Ready.');
  renderShown();
}

function showScan(scan: ScanAsset) {
  return showFile(scan, { kind: 'scan', assetId: scan.id, measuredSize: scan.measuredSize }, 'sample scan');
}

async function showProduct(p: Product) {
  renderProductColors();
  renderProductInfo();
  await showFile(p, { kind: 'product', productId: p.id, size: p.size }, 'model');
  applyProductColors();
}

function choicesFor(id: string): ColorChoices {
  return (state.colorChoices[id] ??= {});
}

/** Recolour the shown product. Safe to call any time: it only acts when that product is loaded. */
function applyProductColors() {
  const s = state.shown;
  const p = getProduct(state.productId);
  if (s?.kind !== 'product' || !p || s.productId !== p.id) return;
  viewer.setMaterialColors(resolveColors(p, choicesFor(p.id)));
}

function renderProductColors() {
  const p = getProduct(state.productId);
  els.productColors.innerHTML = '';
  if (!p) return;
  const choices = choicesFor(p.id);
  for (const part of p.colorParts) {
    const id = `color-${part.label.toLowerCase()}`;
    const field = document.createElement('div');
    field.className = 'field';
    const label = document.createElement('label');
    label.className = 'field-label';
    label.htmlFor = id;
    label.textContent = p.colorParts.length > 1 ? `${part.label} colour` : 'Colour';
    const row = document.createElement('div');
    row.className = 'color-row';
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.setAttribute('aria-hidden', 'true');
    const select = document.createElement('select');
    select.id = id;
    part.options.forEach((o, i) => select.add(new Option(o.name, String(i))));
    select.value = String(choices[part.label] ?? 0);
    const paint = () => {
      const o = part.options[Number(select.value)];
      const tone = o.overrides ? Object.values(o.overrides)[0] : o.hex;
      swatch.style.background = o.overrides ? `linear-gradient(135deg, ${tone} 50%, ${o.hex} 50%)` : o.hex;
    };
    paint();
    select.addEventListener('change', () => {
      choices[part.label] = Number(select.value);
      paint();
      applyProductColors();
      renderProductInfo();
    });
    row.append(swatch, select);
    field.append(label, row);
    els.productColors.append(field);
  }
}

function renderProductInfo() {
  const p = getProduct(state.productId);
  if (!p) return;
  const u = state.unit;
  els.productInfo.innerHTML = '';
  if (p.custom) {
    const text = document.createElement('span');
    text.textContent =
      `Built from your photos in ${describeColors(p, choicesFor(p.id))}, scaled to your measurements: ` +
      `${formatLength(p.size.width, u)} wide, ${formatLength(p.size.depth, u)} deep, ${formatLength(p.size.height, u)} high. ` +
      (p.custom.notes ? `${p.custom.notes} ` : '');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'link-button';
    remove.textContent = 'Remove from My furniture';
    remove.addEventListener('click', () => void removeCustom(p));
    els.productInfo.append(text, remove);
    return;
  }
  const sized = document.createElement('span');
  sized.textContent =
    `Sized like the ${p.sizedLike} in ${describeColors(p, choicesFor(p.id))}: ${formatLength(p.size.width, u)} wide, ` +
    `${formatLength(p.size.depth, u)} deep, ${formatLength(p.size.height, u)} high. Colour names are the retailer's; ` +
    `shades are approximate. A look-alike model for checking size, not the actual product. `;
  const link = document.createElement('a');
  link.href = p.sourceUrl;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'Dimension source';
  els.productInfo.append(sized, link);
}

let debounce: number | undefined;

function applyTemplateNow() {
  window.clearTimeout(debounce);
  const size = readDims();
  state.inputsValid = size !== null;
  if (!size) {
    updateArAvailability();
    setStatus('Fix the highlighted size. The preview still shows the last valid size.', 'error');
    return;
  }
  const s = state.shown;
  if (!state.busy && s?.kind === 'template' && s.templateId === state.templateId && sameSize(s.size, size)) {
    // Already showing exactly this model (e.g. a blur after the debounced rebuild).
    updateArAvailability();
    setStatus('Ready.');
    return;
  }
  void showTemplate(state.templateId, size);
}

function sameSize(a: DimensionsM, b: DimensionsM): boolean {
  return DIMENSION_KEYS.every((k) => Math.abs(a[k] - b[k]) < 1e-9);
}

function scheduleApply() {
  window.clearTimeout(debounce);
  // Block AR immediately: the shown model no longer matches what is typed.
  state.inputsValid = false;
  updateArAvailability();
  debounce = window.setTimeout(applyTemplateNow, DEBOUNCE_MS);
}

// ---------- Fit calculator ----------

function updateFit() {
  const size = shownSize();
  const raw = [gapFields.width.input.value, gapFields.depth.input.value];
  if (!size || raw.some((v) => v.trim() === '')) {
    els.fitResult.textContent = '';
    els.fitResult.className = 'fit-result';
    setFieldError(gapFields.width, null);
    setFieldError(gapFields.depth, null);
    return;
  }
  const w = parseLength(raw[0], state.unit, GAP_RANGE, 'Gap width');
  const d = parseLength(raw[1], state.unit, GAP_RANGE, 'Gap depth');
  setFieldError(gapFields.width, w.ok ? null : w.error);
  setFieldError(gapFields.depth, d.ok ? null : d.error);
  if (!w.ok || !d.ok) {
    els.fitResult.textContent = '';
    return;
  }
  const result = checkFit(size, { width: w.meters, depth: d.meters }, els.gapRotate.checked, state.unit);
  els.fitResult.textContent = result.message;
  els.fitResult.className = `fit-result ${result.status}`;
}

// ---------- Event wiring ----------

for (const id of TEMPLATE_IDS) {
  els.templateSelect.add(new Option(TEMPLATES[id].label, id));
}

els.templateSelect.addEventListener('change', () => {
  state.templateId = els.templateSelect.value as TemplateId;
  fillDims(TEMPLATES[state.templateId].defaults);
  applyTemplateNow();
});

els.resetDims.addEventListener('click', () => {
  fillDims(TEMPLATES[state.templateId].defaults);
  applyTemplateNow();
});

for (const k of DIMENSION_KEYS) {
  dimFields[k].input.addEventListener('input', scheduleApply);
  dimFields[k].input.addEventListener('change', applyTemplateNow);
}
document.getElementById('dims-form')!.addEventListener('submit', (e) => {
  e.preventDefault();
  applyTemplateNow();
});

for (const f of Object.values(gapFields)) f.input.addEventListener('input', updateFit);
els.gapRotate.addEventListener('change', updateFit);

function setUnit(next: Unit) {
  const prev = state.unit;
  if (next === prev) return;
  // Convert whatever is typed so the user does not have to re-enter it.
  for (const f of allFields) {
    const v = Number(f.input.value.trim().replace(',', '.'));
    if (f.input.value.trim() !== '' && Number.isFinite(v)) f.input.value = inputValue(toMeters(v, prev), next);
  }
  state.unit = next;
  for (const f of allFields) f.unit.textContent = next;
  if (state.mode === 'template') applyTemplateNow();
  renderShown();
  renderScanInfo();
  renderProductInfo();
}

document.querySelectorAll<HTMLInputElement>('input[name="unit"]').forEach((r) =>
  r.addEventListener('change', () => r.checked && setUnit(r.value as Unit)),
);

function setMode(mode: Mode) {
  state.mode = mode;
  els.templatePanel.hidden = mode !== 'template';
  els.productPanel.hidden = mode !== 'product';
  els.scanPanel.hidden = mode !== 'scan';
  if (mode === 'template') {
    applyTemplateNow();
  } else if (mode === 'product') {
    void showProduct(getProduct(state.productId)!);
  } else if (state.scan) {
    void showScan(state.scan);
  } else {
    state.revision++; // Drop any in-flight template result.
    setBusy(false);
    setStatus('No sample scan is bundled yet.', 'error');
  }
}

document.querySelectorAll<HTMLInputElement>('input[name="source"]').forEach((r) =>
  r.addEventListener('change', () => r.checked && setMode(r.value as Mode)),
);

els.resetView.addEventListener('click', () => viewer.resetView());

/** Fill a filter <select> with the values present in the catalogue, keeping the current choice. */
function fillFilter(select: HTMLSelectElement, allLabel: string, values: string[]) {
  const current = select.value;
  select.replaceChildren(new Option(allLabel, ''), ...values.map((v) => new Option(v, v)));
  select.value = values.includes(current) ? current : '';
}

function refreshFilters() {
  const present = allProducts();
  const brands = [MY_FURNITURE, ...BRANDS].filter((b) => present.some((p) => p.brand === b));
  const types = FURNITURE_TYPES.filter((t) => present.some((p) => p.type === t));
  fillFilter(els.brandFilter, 'All brands', brands);
  fillFilter(els.typeFilter, 'All types', [...types]);
}
refreshFilters();

/** Rebuild the product list from the search box and filters. Does not load a model by itself. */
function renderProductList() {
  const all = allProducts();
  const results = filterProducts(all, {
    brand: els.brandFilter.value,
    type: els.typeFilter.value,
    query: els.productSearch.value,
  });
  els.productCount.textContent =
    results.length === all.length ? `${results.length} products` : `${results.length} of ${all.length} products`;
  els.productList.innerHTML = '';
  if (!results.length) {
    const li = document.createElement('li');
    li.className = 'product-empty';
    li.textContent = 'No products match. Try another search or clear the filters.';
    els.productList.append(li);
    return;
  }
  for (const p of results) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.id = p.id;
    button.setAttribute('aria-pressed', String(p.id === state.productId));
    const name = document.createElement('span');
    name.className = 'product-name';
    name.textContent = p.label;
    const meta = document.createElement('span');
    meta.className = 'product-meta';
    meta.textContent = p.custom ? `${p.type} · built from your photos` : `${p.type} · sized like ${p.sizedLike}`;
    button.append(name, meta);
    button.addEventListener('click', () => selectProduct(p.id));
    li.append(button);
    els.productList.append(li);
  }
}

function selectProduct(id: string) {
  if (id === state.productId && state.shown?.kind === 'product' && state.shown.productId === id) return;
  state.productId = id;
  for (const b of els.productList.querySelectorAll<HTMLButtonElement>('button[data-id]')) {
    b.setAttribute('aria-pressed', String(b.dataset.id === id));
  }
  void showProduct(getProduct(id)!);
}

// ---------- My furniture (built from photos by the scan server) ----------

async function loadCustomProducts() {
  try {
    const res = await fetch('api/custom-products');
    if (!res.ok) return;
    setCustomProducts((await res.json()) as Product[]);
    refreshFilters();
    renderProductList();
    // A deep link to a My furniture item can only be opened once the list has arrived.
    const q = new URLSearchParams(location.search);
    const linked = getProduct(q.get('product') ?? '');
    if (q.get('source') === 'product' && linked?.custom && state.shown?.kind !== 'product') {
      state.productId = linked.id;
      document.querySelector<HTMLInputElement>('input[name="source"][value="product"]')!.checked = true;
      setMode('product');
      renderProductList();
    }
  } catch {
    /* No scan server (e.g. static hosting): the built-in catalogue still works. */
  }
}

async function removeCustom(p: Product) {
  if (!confirm(`Remove "${p.label}" from My furniture? This deletes its model.`)) return;
  const headers: Record<string, string> = {};
  try {
    headers['x-scan-token'] = localStorage.getItem('scan-token') ?? '';
  } catch {
    /* ignore */
  }
  const res = await fetch(`api/custom-products/${encodeURIComponent(p.id)}`, { method: 'DELETE', headers });
  if (!res.ok && res.status !== 404) {
    setStatus('Could not remove it. Check the scan passcode.', 'error');
    return;
  }
  setCustomProducts(allProducts().filter((x) => x.custom && x.id !== p.id));
  refreshFilters();
  renderProductList();
  selectProduct(allProducts()[0].id);
}

const scanFlow = new ScanFlow({
  unit: () => state.unit,
  onAdded: (product) => {
    setCustomProducts([product, ...allProducts().filter((x) => x.custom && x.id !== product.id)]);
    refreshFilters();
    els.brandFilter.value = '';
    els.typeFilter.value = '';
    els.productSearch.value = '';
    renderProductList();
    if (state.mode !== 'product') {
      document.querySelector<HTMLInputElement>('input[name="source"][value="product"]')!.checked = true;
      state.productId = product.id;
      setMode('product');
    } else {
      selectProduct(product.id);
    }
  },
});
els.addOwn.addEventListener('click', () => void scanFlow.open());
// Opening the app at #add goes straight to the scanner (handy for a QR code).
if (location.hash === '#add') void scanFlow.open();

els.productSearch.addEventListener('input', renderProductList);
els.brandFilter.addEventListener('change', renderProductList);
els.typeFilter.addEventListener('change', renderProductList);
renderProductList();

els.arButton.addEventListener('click', () => {
  if (els.arButton.disabled) return;
  viewer.activateAR().catch((err) => {
    console.error(err);
    setStatus('AR could not start. Try again, or switch to the sample scan.', 'error');
  });
});

viewer.el.addEventListener('ar-status', (e) => {
  const status = (e as CustomEvent<{ status: string }>).detail?.status;
  if (status === 'failed') {
    setStatus('AR could not start. Try again, or switch to the sample scan.', 'error');
  }
});

// ---------- Start ----------

void loadCustomProducts();

for (const f of allFields) f.unit.textContent = state.unit;
fillDims(TEMPLATES[state.templateId].defaults);
// Deep links: ?source=product&product=<id>[&colors=i,j] opens a popular product directly.
const params = new URLSearchParams(location.search);
const linkedProduct = getProduct(params.get('product') ?? '');
if (params.get('source') === 'product' && linkedProduct) {
  state.productId = linkedProduct.id;
  renderProductList();
  // &colors=1,3 picks option indexes for each colour part in order.
  const picks = (params.get('colors') ?? '').split(',').map(Number);
  linkedProduct.colorParts.forEach((part, i) => {
    if (Number.isInteger(picks[i]) && part.options[picks[i]]) choicesFor(linkedProduct.id)[part.label] = picks[i];
  });
  document.querySelector<HTMLInputElement>('input[name="source"][value="product"]')!.checked = true;
  setMode('product');
} else {
  applyTemplateNow();
}

function renderScanInfo() {
  const scan = state.scan;
  if (!scan) {
    els.scanInfo.textContent =
      'No sample scan has been added to this site yet. Add sample-scan.glb (and optionally sample-scan.usdz) to public/models/.';
    return;
  }
  const m = scan.measuredSize;
  const u = state.unit;
  els.scanInfo.textContent =
    `${scan.label}: a real piece captured with a 3D scanner. Checked with a tape measure at ` +
    `${formatLength(m.width, u)} wide, ${formatLength(m.depth, u)} deep and ${formatLength(m.height, u)} high.`;
}

renderScanInfo();
void resolveScan(SCANS[0]).then((scan) => {
  state.scan = scan;
  renderScanInfo();
  if (state.mode === 'scan') setMode('scan');
});
