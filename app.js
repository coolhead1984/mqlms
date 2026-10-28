'use strict';

const STORAGE_KEY = 'la-casa-quote-studio-v1';
const PACKAGE_PRESETS = [
  { id: 'silver', name: 'Silver', description: 'VS Neem Ply\nEbco Hardware' },
  { id: 'gold', name: 'Gold', description: 'Greenply\nHettich Hardware' },
  { id: 'platinum', name: 'Platinum', description: 'Century Ply\nHettich Hardware' }
];

const STARTER_ITEMS = [
  ['PVC Oaks', 'sft', 400],
  ['Foyer Area', 'sft', 900],
  ['TV Unit', 'sft', 900],
  ['POP with Wood', 'sft', 200],
  ['Entrance covering', 'sft', 1000],
  ['Bottom Unit', 'sft', 1400],
  ['Pooja Gopura', 'sft', 600],
  ['Storage Unit', 'sft', 1100],
  ['Wash Basin', 'sft', 1100],
  ['Kitchen Bottom Unit', 'sft', 1300],
  ['Kitchen Wall Unit', 'sft', 1300],
  ['Kitchen Loft', 'sft', 1050],
  ['Crockery Unit', 'sft', 1300],
  ['Breakfast Counter', 'sft', 1300],
  ['Kitchen accessories', 'sft', 69000],
  ['Wall unit', 'sft', 1400],
  ['Ceiling panels', 'pcs', 15000],
  ['Wardrobe', 'sft', 1050],
  ['Loft', 'sft', 900],
  ['Folding Table', 'sft', 1100],
  ['King Size Cot [With Hydraulic]', 'sft', 1200],
  ['Dressing Unit', 'sft', 1300]
];

const DEFAULT_TERMS = [
  'This quotation is valid through the expiry date shown in the quotation header.',
  'Work will begin after quotation acceptance and confirmation of the agreed advance payment.',
  'Pricing is based on the scope, quantities and material selections detailed in this quotation.',
  'Changes to the approved design or scope may change the final price and schedule; any changes will be agreed before work proceeds.',
  'Final measurements and site conditions will be confirmed before production begins.',
  'The delivery and installation schedule will be confirmed after design approval and site readiness.',
  'Payment milestones and any applicable taxes will be confirmed with the client before work begins.'
];

const CURRENCY_OPTIONS = [
  ['INR', 'Indian Rupee (INR ₹)'],
  ['USD', 'US Dollar (USD $)'],
  ['GBP', 'British Pound (GBP £)'],
  ['AED', 'UAE Dirham (AED)']
];

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
})[character]);

const makeId = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`;

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function mergeDriveData(local, remote) {
  const localIsNewer = String(local.settings.updatedAt || '') > String(remote.settings.updatedAt || '');
  const settings = localIsNewer
    ? { ...remote.settings, ...local.settings }
    : { ...local.settings, ...remote.settings };
  const itemsById = new Map();
  for (const item of [...remote.settings.items, ...local.settings.items]) {
    if ((local.deletedCatalogItemIds || []).includes(item.id)
      || (remote.deletedCatalogItemIds || []).includes(item.id)) continue;
    const previous = itemsById.get(item.id);
    if (!previous || String(item.updatedAt || '') > String(previous.updatedAt || '')) {
      itemsById.set(item.id, item);
    }
  }
  settings.items = [...itemsById.values()].map((item) => ({
    ...item,
    rates: Object.fromEntries(settings.packages.map((entry) => [
      entry.id,
      Math.max(0, Number(item.rates?.[entry.id]) || 0)
    ]))
  }));

  const deletedQuoteIds = [...new Set([
    ...(remote.deletedQuoteIds || []),
    ...(local.deletedQuoteIds || [])
  ])];
  const quotesById = new Map();
  for (const quote of [...remote.quotes, ...local.quotes]) {
    if (deletedQuoteIds.includes(quote.id)) continue;
    const previous = quotesById.get(quote.id);
    if (!previous || String(quote.updatedAt || '') > String(previous.updatedAt || '')) {
      quotesById.set(quote.id, quote);
    }
  }
  const quotes = [...quotesById.values()].sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
  return {
    ...local,
    currentQuoteId: quotes.some((quote) => quote.id === local.currentQuoteId) ? local.currentQuoteId : '',
    nextSequence: Math.max(local.nextSequence, remote.nextSequence),
    deletedQuoteIds,
    deletedCatalogItemIds: [...new Set([
      ...(remote.deletedCatalogItemIds || []),
      ...(local.deletedCatalogItemIds || [])
    ])],
    quotes,
    settings
  };
}

function makeDefaultState() {
  const packages = PACKAGE_PRESETS.map((entry) => ({ ...entry }));
  return {
    version: 1,
    currentView: 'dashboard',
    nextSequence: 23,
    currentQuoteId: '',
    quotes: [],
    deletedQuoteIds: [],
    deletedCatalogItemIds: [],
    settings: {
      companyName: 'LA CASA INTERIORS',
      companyEmail: 'info@lacasa-decores.com',
      companyPhone: '',
      companyAddress: 'Bengaluru, Karnataka 560091',
      currency: 'INR',
      defaultValidity: 30,
      defaultTax: 0,
      googleDriveClientId: '',
      updatedAt: '',
      terms: DEFAULT_TERMS.join('\n'),
      packages,
      items: STARTER_ITEMS.map(([name, unit, silverRate], index) => ({
        id: `catalog-starter-${index + 1}`,
        name,
        description: '',
        unit,
        rates: { silver: silverRate, gold: 0, platinum: 0 },
        updatedAt: ''
      }))
    }
  };
}

let storageUnavailable = false;
let storageMessage = '';
let state = makeDefaultState();
let currentView = 'dashboard';
let toastTimer = 0;
let quoteSearch = '';
let driveAccountEmail = '';
let driveFolderUrl = '';

function hydrateState(value) {
  if (!value || value.version !== 1 || !value.settings || !Array.isArray(value.quotes)) {
    throw new Error('This backup is not a compatible Quote Studio data file.');
  }

  const defaults = makeDefaultState();
  const packages = Array.isArray(value.settings.packages) && value.settings.packages.length
    ? value.settings.packages
        .filter((entry) => entry && typeof entry.id === 'string' && typeof entry.name === 'string')
        .map((entry) => ({
          id: entry.id,
          name: entry.name,
          description: String(entry.description || '')
        }))
    : defaults.settings.packages;
  const catalogIdMap = new Map();
  const itemsById = new Map();
  if (Array.isArray(value.settings.items)) {
    for (const entry of value.settings.items.filter((item) => item && typeof item.name === 'string')) {
      const starterIndex = STARTER_ITEMS.findIndex(([name, unit]) => name === entry.name && unit === entry.unit);
      const itemId = starterIndex >= 0
        ? `catalog-starter-${starterIndex + 1}`
        : typeof entry.id === 'string' ? entry.id : makeId('catalog');
      if (typeof entry.id === 'string') catalogIdMap.set(entry.id, itemId);
      const item = {
        id: itemId,
        name: entry.name,
        description: String(entry.description || ''),
        unit: String(entry.unit || 'unit'),
        updatedAt: String(entry.updatedAt || ''),
        rates: Object.fromEntries(
          packages.map((entryPackage) => [
            entryPackage.id,
            Math.max(0, Number(entry.rates?.[entryPackage.id]) || 0)
          ])
        )
      };
      const previous = itemsById.get(itemId);
      if (!previous || item.updatedAt >= previous.updatedAt) itemsById.set(itemId, item);
    }
  }
  const items = Array.isArray(value.settings.items) ? [...itemsById.values()] : defaults.settings.items;
  const quotes = value.quotes
    .filter((quote) => quote && typeof quote.id === 'string')
    .map((quote) => ({
      id: quote.id,
      number: String(quote.number || ''),
      issueDate: String(quote.issueDate || localDateString()),
      validityDays: Math.max(1, Number(quote.validityDays) || 30),
      clientName: String(quote.clientName || ''),
      clientPhone: String(quote.clientPhone || ''),
      clientEmail: String(quote.clientEmail || ''),
      clientAddress: String(quote.clientAddress || ''),
      projectName: String(quote.projectName || ''),
      packageId: packages.some((entry) => entry.id === quote.packageId) ? quote.packageId : packages[0].id,
      discountPercent: Math.min(100, Math.max(0, Number(quote.discountPercent) || 0)),
      taxRate: Math.min(100, Math.max(0, Number(quote.taxRate) || 0)),
      terms: String(quote.terms ?? defaults.settings.terms),
      status: quote.status === 'saved' ? 'saved' : 'draft',
      updatedAt: String(quote.updatedAt || new Date().toISOString()),
      items: Array.isArray(quote.items)
        ? quote.items
            .filter((item) => item && (item.type === 'header' || item.type === 'item'))
            .map((item) => item.type === 'header'
              ? { id: String(item.id || makeId('heading')), type: 'header', title: String(item.title || '') }
              : {
                  id: String(item.id || makeId('line')),
                  type: 'item',
                  catalogId: typeof item.catalogId === 'string'
                    ? catalogIdMap.get(item.catalogId) || item.catalogId
                    : '',
                  name: String(item.name || ''),
                  description: String(item.description || ''),
                  unit: String(item.unit || 'unit'),
                  quantity: Math.max(0, Number(item.quantity) || 0),
                  rate: Math.max(0, Number(item.rate) || 0),
                  rates: Object.fromEntries(packages.map((entryPackage) => {
                    const hasSavedRate = item.rates && Object.hasOwn(item.rates, entryPackage.id);
                    const savedRate = hasSavedRate
                      ? item.rates[entryPackage.id]
                      : entryPackage.id === quote.packageId
                        ? item.rate
                        : items.find((catalogItem) =>
                          catalogItem.id === (catalogIdMap.get(item.catalogId) || item.catalogId)
                        )?.rates?.[entryPackage.id];
                    return [entryPackage.id, Math.max(0, Number(savedRate) || 0)];
                  }))
                })
        : []
    }));
  const sequence = Number(value.nextSequence);

  return {
    version: 1,
    currentView: ['dashboard', 'quotes', 'builder', 'catalog', 'settings'].includes(value.currentView)
      ? value.currentView
      : 'dashboard',
    nextSequence: Number.isInteger(sequence) && sequence > 0 ? sequence : 23,
    currentQuoteId: quotes.some((quote) => quote.id === value.currentQuoteId) ? value.currentQuoteId : '',
    quotes,
    deletedQuoteIds: Array.isArray(value.deletedQuoteIds)
      ? value.deletedQuoteIds.filter((id) => typeof id === 'string')
      : [],
    deletedCatalogItemIds: Array.isArray(value.deletedCatalogItemIds)
      ? value.deletedCatalogItemIds.filter((id) => typeof id === 'string')
      : [],
    settings: {
      companyName: String(value.settings.companyName || defaults.settings.companyName),
      companyEmail: String(value.settings.companyEmail || ''),
      companyPhone: String(value.settings.companyPhone || ''),
      companyAddress: String(value.settings.companyAddress || ''),
      currency: CURRENCY_OPTIONS.some(([code]) => code === value.settings.currency)
        ? value.settings.currency
        : 'INR',
      defaultValidity: Math.min(365, Math.max(1, Number(value.settings.defaultValidity) || 30)),
      defaultTax: Math.min(100, Math.max(0, Number(value.settings.defaultTax) || 0)),
      googleDriveClientId: String(value.settings.googleDriveClientId || ''),
      updatedAt: String(value.settings.updatedAt || ''),
      terms: String(value.settings.terms ?? defaults.settings.terms),
      packages,
      items
    }
  };
}

function loadStoredState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return makeDefaultState();
    return hydrateState(JSON.parse(stored));
  } catch (error) {
    storageUnavailable = true;
    storageMessage = error instanceof Error ? error.message : 'The browser could not read saved quotation data.';
    return makeDefaultState();
  }
}

state = loadStoredState();
currentView = state.currentView;

const pageContent = document.getElementById('pageContent');
const breadcrumb = document.getElementById('breadcrumb');
const quoteCount = document.getElementById('quoteCount');
const toast = document.getElementById('toast');

function showToast(message, isError = false) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle('is-error', isError);
  toast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 3800);
}

function saveState() {
  if (storageUnavailable) {
    showToast(`Saved data is unavailable, so changes remain temporary. Export a valid backup or restore saved data in Settings. ${storageMessage}`, true);
    return false;
  }

  try {
    state.currentView = currentView;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Storage is unavailable.';
    showToast(`Could not save changes on this computer. Export a backup and check available browser storage. ${detail}`, true);
    return false;
  }
}

function findQuote(quoteId = state.currentQuoteId) {
  return state.quotes.find((quote) => quote.id === quoteId) || null;
}

function findPackage(packageId) {
  return state.settings.packages.find((entry) => entry.id === packageId) || state.settings.packages[0];
}

function currentPackage(quote = findQuote()) {
  return quote ? findPackage(quote.packageId) : state.settings.packages[0];
}

function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return formatZeroMoney();
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: state.settings.currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  }).format(amount);
}

function formatZeroMoney() {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: state.settings.currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  }).format(0);
}

function formatDate(dateString) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString || ''));
  if (!parts) return '—';
  return `${parts[3]}/${parts[2]}/${parts[1]}`;
}

function quoteTotals(quote) {
  return packageQuoteTotals(quote, quote.packageId);
}

function packageQuoteTotals(quote, packageId) {
  const subtotal = quote.items.reduce((total, item) => {
    if (item.type !== 'item') return total;
    const rate = item.rates && Object.hasOwn(item.rates, packageId)
      ? item.rates[packageId]
      : item.rate;
    return total + Math.max(0, Number(item.quantity) || 0) * Math.max(0, Number(rate) || 0);
  }, 0);
  const discount = subtotal * Math.min(100, Math.max(0, Number(quote.discountPercent) || 0)) / 100;
  const taxableAmount = Math.max(0, subtotal - discount);
  const tax = taxableAmount * Math.min(100, Math.max(0, Number(quote.taxRate) || 0)) / 100;
  return { subtotal, discount, taxableAmount, tax, grandTotal: taxableAmount + tax };
}

function quotePageStatus(quote) {
  return quote.status === 'saved' ? 'Saved' : 'Draft';
}

function breadcrumbMarkup(title) {
  const homeLabel = currentView === 'dashboard' ? '' : '<span>Workspace</span><span class="breadcrumb-separator">/</span>';
  breadcrumb.innerHTML = `${homeLabel}<span>${escapeHtml(title)}</span>`;
}

function updateNavigation() {
  document.querySelectorAll('[data-nav]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.nav === currentView);
    if (button.dataset.nav === 'quotes') quoteCount.textContent = String(state.quotes.length);
  });
}

function showView(view, { preserveSearch = false } = {}) {
  const validViews = ['dashboard', 'quotes', 'builder', 'catalog', 'settings'];
  currentView = validViews.includes(view) ? view : 'dashboard';
  if (!preserveSearch && currentView !== 'quotes') quoteSearch = '';
  state.currentView = currentView;
  updateNavigation();

  const quote = findQuote();
  const viewTitle = {
    dashboard: 'Overview',
    quotes: 'Quotations',
    builder: quote ? `Quotation ${quote.number}` : 'New quotation',
    catalog: 'Line item library',
    settings: 'Settings'
  }[currentView];
  breadcrumbMarkup(viewTitle);

  if (currentView === 'dashboard') pageContent.innerHTML = renderDashboard();
  else if (currentView === 'quotes') pageContent.innerHTML = renderQuotes();
  else if (currentView === 'builder' && quote) pageContent.innerHTML = renderBuilder(quote);
  else if (currentView === 'builder') {
    currentView = 'dashboard';
    state.currentView = currentView;
    breadcrumbMarkup('Overview');
    pageContent.innerHTML = renderDashboard();
    updateNavigation();
  } else if (currentView === 'catalog') pageContent.innerHTML = renderCatalog();
  else pageContent.innerHTML = renderSettings();

  saveState();
}

function renderDashboard() {
  const quotes = state.quotes;
  const itemCount = state.settings.items.length;
  const savedCount = quotes.filter((quote) => quote.status === 'saved').length;
  const totalQuoted = quotes
    .filter((quote) => quote.status === 'saved')
    .reduce((sum, quote) => sum + quoteTotals(quote).grandTotal, 0);
  const recent = quotes.slice(0, 5);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return `
    <div class="page-heading">
      <div>
        <p class="eyebrow">A warmer way to work</p>
        <h1>${greeting}, La Casa.</h1>
        <p>Your design conversations, thoughtfully put into quotation.</p>
      </div>
      <button class="button button-primary" type="button" data-action="new-quote"><span class="plus-sign" aria-hidden="true">+</span> Create a quotation</button>
    </div>

    <div class="stat-grid" aria-label="Workspace summary">
      <div class="stat-card">
        <span class="stat-icon" aria-hidden="true">▤</span>
        <div class="stat-copy"><div class="stat-label">All quotations</div><div class="stat-value">${quotes.length}</div></div>
      </div>
      <div class="stat-card">
        <span class="stat-icon green" aria-hidden="true">✓</span>
        <div class="stat-copy"><div class="stat-label">Saved quotations</div><div class="stat-value">${savedCount}</div></div>
      </div>
      <div class="stat-card">
        <span class="stat-icon" aria-hidden="true">✳</span>
        <div class="stat-copy"><div class="stat-label">Library line items</div><div class="stat-value">${itemCount}</div></div>
      </div>
    </div>

    <section class="panel">
      <div class="panel-heading">
        <div><h2>A little progress</h2><div class="panel-subtitle">${quotes.length ? `${savedCount} saved quotations · ${money(totalQuoted)} total saved` : 'Your first quotation is just around the corner.'}</div></div>
        ${quotes.length ? '<button class="button button-quiet" type="button" data-nav="quotes">All quotations <span aria-hidden="true">→</span></button>' : ''}
      </div>
      ${recent.length ? `<div class="quote-table-wrap"><table class="list-table"><thead><tr><th>Client / Project</th><th>Quote</th><th>Package</th><th>Status</th><th class="text-right">Total</th><th></th></tr></thead><tbody>${recent.map((quote) => renderQuoteTableRow(quote)).join('')}</tbody></table></div>`
        : `<div class="empty-state"><span class="empty-icon" aria-hidden="true">✧</span><h3>Make room for a great idea.</h3><p>Create your first interior design quotation. Your Silver, Gold and Platinum finishes are already waiting.</p><button class="button button-primary" type="button" data-action="new-quote">Create your first quotation</button></div>`}
    </section>
  `;
}

function renderQuoteTableRow(quote) {
  const totals = quoteTotals(quote);
  const packageEntry = findPackage(quote.packageId);
  const label = quote.clientName || 'New client';
  const project = quote.projectName ? `<span class="field-help">${escapeHtml(quote.projectName)}</span>` : '';

  return `
    <tr>
      <td>${escapeHtml(label)}${project}</td>
      <td>${escapeHtml(quote.number)}</td>
      <td>${escapeHtml(packageEntry?.name || '—')}</td>
      <td><span class="status-pill ${quote.status === 'draft' ? 'status-draft' : ''}">${quotePageStatus(quote)}</span></td>
      <td class="text-right">${money(totals.grandTotal)}</td>
      <td><div class="table-actions"><button class="table-action" type="button" data-action="edit-quote" data-quote-id="${escapeHtml(quote.id)}" aria-label="Edit quotation ${escapeHtml(quote.number)}">Open</button></div></td>
    </tr>
  `;
}

function renderQuotes() {
  const matches = state.quotes
    .filter((quote) => {
      const searchText = `${quote.number} ${quote.clientName} ${quote.clientPhone} ${quote.projectName}`.toLowerCase();
      return searchText.includes(quoteSearch.toLowerCase());
    })
    .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));

  return `
    <div class="page-heading">
      <div><p class="eyebrow">Your client book</p><h1>Quotations</h1><p>Every thoughtful proposal, all in one place.</p></div>
      <button class="button button-primary" type="button" data-action="new-quote"><span class="plus-sign" aria-hidden="true">+</span> New quotation</button>
    </div>
    <div class="toolbar">
      <label class="search-field"><span class="field-label" hidden>Search quotations</span><input class="form-control" id="quoteSearch" type="search" placeholder="Search a client or quotation…" value="${escapeHtml(quoteSearch)}" aria-label="Search quotations" autocomplete="off"></label>
      <span class="field-help">${matches.length} ${matches.length === 1 ? 'quotation' : 'quotations'}</span>
    </div>
    <section class="panel"><div class="quote-table-wrap" id="quoteListTable">
      ${matches.length ? `<table class="list-table"><thead><tr><th>Client / Project</th><th>Quote</th><th>Date</th><th>Package</th><th>Status</th><th class="text-right">Total</th><th></th></tr></thead><tbody>${matches.map((quote) => {
        const totals = quoteTotals(quote);
        return `<tr>
          <td>${escapeHtml(quote.clientName || 'New client')}${quote.projectName ? `<span class="field-help">${escapeHtml(quote.projectName)}</span>` : ''}</td>
          <td>${escapeHtml(quote.number)}</td>
          <td>${formatDate(quote.issueDate)}</td>
          <td>${escapeHtml(findPackage(quote.packageId)?.name || '—')}</td>
          <td><span class="status-pill ${quote.status === 'draft' ? 'status-draft' : ''}">${quotePageStatus(quote)}</span></td>
          <td class="text-right">${money(totals.grandTotal)}</td>
          <td><div class="table-actions">
            <button class="table-action" type="button" data-action="edit-quote" data-quote-id="${escapeHtml(quote.id)}">Open</button>
            <button class="table-action" type="button" data-action="duplicate-quote" data-quote-id="${escapeHtml(quote.id)}">Copy</button>
            <button class="table-action table-action-danger" type="button" data-action="delete-quote" data-quote-id="${escapeHtml(quote.id)}" aria-label="Delete quotation ${escapeHtml(quote.number)}">Remove</button>
          </div></td>
        </tr>`;
      }).join('')}</tbody></table>`
        : `<div class="search-empty">${state.quotes.length ? 'No quotations match that search.' : 'No quotations yet. When you create one, it will feel right at home here.'}</div>`}
    </div></section>
  `;
}

function renderPackageChoices(quote, preview = false) {
  return state.settings.packages.map((entry) => {
    const description = entry.description.split(/\r?\n/).filter(Boolean).map((part) => escapeHtml(part)).join(' · ');
    const selected = entry.id === quote.packageId;
    return preview
      ? `<div class="quote-package ${selected ? 'is-selected' : ''}"><span class="quote-package-name">${escapeHtml(entry.name)}</span><p>${description || 'Finish selection can be agreed with your designer.'}</p></div>`
      : `<button class="package-choice ${selected ? 'is-selected' : ''}" type="button" data-package-id="${escapeHtml(entry.id)}" aria-pressed="${selected}"><span class="package-check" aria-hidden="true">${selected ? '✓' : ''}</span><span class="package-name">${escapeHtml(entry.name)}</span><span class="package-description">${description || 'Add your material options in Settings.'}</span></button>`;
  }).join('');
}

function catalogOptions(selectedId) {
  return `<option value="">Choose a catalogue line item…</option>${state.settings.items.map((item) =>
    `<option value="${escapeHtml(item.id)}" ${item.id === selectedId ? 'selected' : ''}>${escapeHtml(item.name)}</option>`
  ).join('')}`;
}

function renderLineEditor(line, quote, index) {
  const lineIsHeader = line.type === 'header';
  if (lineIsHeader) {
    return `
      <article class="line-card" data-line-id="${escapeHtml(line.id)}">
        <div class="line-fields">
          <label class="field-label" for="line-heading-${escapeHtml(line.id)}">Section heading <span class="line-hint">A simple floor or room label · no charge</span></label>
          <input class="form-control" id="line-heading-${escapeHtml(line.id)}" data-item-field="title" data-item-id="${escapeHtml(line.id)}" value="${escapeHtml(line.title)}" placeholder="e.g. Ground Floor, First Floor, Living Room" maxlength="100">
        </div>
        <div class="item-actions">
          <button class="icon-button" type="button" data-action="move-line" data-line-id="${escapeHtml(line.id)}" data-direction="-1" aria-label="Move heading up" title="Move up" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button class="icon-button" type="button" data-action="move-line" data-line-id="${escapeHtml(line.id)}" data-direction="1" aria-label="Move heading down" title="Move down" ${index === quote.items.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="icon-button icon-button-danger" type="button" data-action="remove-line" data-line-id="${escapeHtml(line.id)}" aria-label="Remove heading" title="Remove heading">×</button>
        </div>
      </article>
    `;
  }

  const packageEntry = currentPackage(quote);
  const amount = Math.max(0, Number(line.quantity) || 0) * Math.max(0, Number(line.rate) || 0);
  const packageRates = state.settings.packages.map((entry) => `
    <label class="field-group">
      <span class="field-label">${escapeHtml(entry.name)} rate</span>
      <input class="form-control line-detail-control" type="number" data-item-package-rate="${escapeHtml(entry.id)}" data-item-id="${escapeHtml(line.id)}" min="0" step="any" value="${escapeHtml(line.rates?.[entry.id] ?? 0)}" inputmode="decimal" aria-label="${escapeHtml(entry.name)} price for ${escapeHtml(line.name || 'line item')}">
    </label>
  `).join('');

  return `
    <article class="line-card" data-line-id="${escapeHtml(line.id)}">
      <div class="line-fields">
        <div class="line-title-controls">
          <label class="field-group">
            <span class="field-label">Select from library</span>
            <select class="form-control line-detail-control" data-select-catalog="${escapeHtml(line.id)}" aria-label="Select a library item">${catalogOptions(line.catalogId)}</select>
          </label>
          <label class="field-group">
            <span class="field-label">Line item name</span>
            <input class="form-control line-detail-control" data-item-field="name" data-item-id="${escapeHtml(line.id)}" value="${escapeHtml(line.name)}" placeholder="e.g. Custom kitchen cabinetry" maxlength="120">
          </label>
        </div>
        <label class="field-group"><span class="field-label">Description or room</span>
          <input class="form-control line-detail-control" data-item-field="description" data-item-id="${escapeHtml(line.id)}" value="${escapeHtml(line.description)}" placeholder="e.g. Kitchen, living area or material notes" maxlength="160">
        </label>
        <div class="line-cost-controls">
          <label class="field-group"><span class="field-label">Quantity</span><input class="form-control line-detail-control" type="number" data-item-field="quantity" data-item-id="${escapeHtml(line.id)}" min="0" step="any" value="${escapeHtml(line.quantity)}" inputmode="decimal"></label>
          <label class="field-group"><span class="field-label">Unit</span><input class="form-control line-detail-control" data-item-field="unit" data-item-id="${escapeHtml(line.id)}" value="${escapeHtml(line.unit)}" placeholder="sft" maxlength="15"></label>
          <div class="amount-display"><span>${escapeHtml(packageEntry?.name || 'Selected finish')} amount</span><strong data-line-amount="${escapeHtml(line.id)}">${line.rate > 0 ? money(amount) : 'Enter a rate'}</strong></div>
        </div>
        <div class="line-package-rates">${packageRates}</div>
        <div class="line-footer">
          <span class="line-hint">All package prices are saved to the library and used as defaults next time.</span>
          ${line.rate <= 0 ? `<span class="line-hint">Add a ${escapeHtml(packageEntry?.name || '')} price before printing.</span>` : ''}
        </div>
      </div>
      <div class="item-actions">
        <button class="icon-button" type="button" data-action="move-line" data-line-id="${escapeHtml(line.id)}" data-direction="-1" aria-label="Move line item up" title="Move up" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button class="icon-button" type="button" data-action="move-line" data-line-id="${escapeHtml(line.id)}" data-direction="1" aria-label="Move line item down" title="Move down" ${index === quote.items.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="icon-button icon-button-danger" type="button" data-action="remove-line" data-line-id="${escapeHtml(line.id)}" aria-label="Remove line item" title="Remove line item">×</button>
      </div>
    </article>
  `;
}

function renderBuilder(quote) {
  const packageEntry = currentPackage(quote);
  const lineMarkup = quote.items.length
    ? quote.items.map((line, index) => renderLineEditor(line, quote, index)).join('')
    : '<div class="empty-lines"><strong>Your quote starts with a single detail.</strong><span>Choose a library item, add a floor heading or enter a custom line.</span></div>';
  const totals = quoteTotals(quote);

  return `
    <div class="page-heading builder-heading">
      <div><p class="eyebrow">A considered proposal</p><h1>Quotation ${escapeHtml(quote.number)}</h1><p>${escapeHtml(quote.clientName || 'Add your client details to get started.')}</p></div>
      <div class="print-actions">
        <button class="button" type="button" data-action="save-quote">Save changes</button>
        <button class="button button-primary" type="button" data-action="print-quote">Print / Save PDF</button>
      </div>
    </div>

    <div class="quote-builder">
      <div class="editor-column">
        <section class="section-card">
          <div class="section-card-heading"><div><h2>01 · A little about your client</h2><p>These details will appear at the top of their proposal.</p></div></div>
          <div class="section-card-body">
            <div class="form-grid">
              <label class="field-group"><span class="field-label">Client name <span aria-label="required">*</span></span><input class="form-control" data-quote-field="clientName" value="${escapeHtml(quote.clientName)}" placeholder="Full name" maxlength="120" autocomplete="name" required></label>
              <label class="field-group"><span class="field-label">Phone number</span><input class="form-control" type="tel" data-quote-field="clientPhone" value="${escapeHtml(quote.clientPhone)}" placeholder="Contact number" maxlength="40" autocomplete="tel"></label>
              <label class="field-group"><span class="field-label">Project or home</span><input class="form-control" data-quote-field="projectName" value="${escapeHtml(quote.projectName)}" placeholder="e.g. The Raman Residence" maxlength="120"></label>
              <label class="field-group"><span class="field-label">Email address</span><input class="form-control" type="email" data-quote-field="clientEmail" value="${escapeHtml(quote.clientEmail)}" placeholder="client@example.com" maxlength="180" autocomplete="email"></label>
            </div>
            <div class="form-grid field-grid-gap">
              <label class="field-group form-span-2"><span class="field-label">Property address</span><input class="form-control" data-quote-field="clientAddress" value="${escapeHtml(quote.clientAddress)}" placeholder="Address or neighbourhood" maxlength="260"></label>
            </div>
            <div class="form-grid form-grid-three field-grid-gap">
              <label class="field-group"><span class="field-label">Quote date</span><input class="form-control" type="date" data-quote-field="issueDate" value="${escapeHtml(quote.issueDate)}"></label>
              <label class="field-group"><span class="field-label">Valid for</span><input class="form-control" type="number" data-quote-field="validityDays" min="1" max="365" value="${escapeHtml(quote.validityDays)}"></label>
              <label class="field-group"><span class="field-label">Payment tax (%)</span><input class="form-control" type="number" data-quote-field="taxRate" min="0" max="100" step="any" value="${escapeHtml(quote.taxRate)}" inputmode="decimal"></label>
            </div>
          </div>
        </section>

        <section class="section-card">
          <div class="section-card-heading"><div><h2>02 · Choose a finish</h2><p>Choose a finish to highlight; the PDF compares every package and its price.</p></div><span class="status-pill status-draft">ALL FINISHES IN PDF</span></div>
          <div class="package-grid">${renderPackageChoices(quote)}</div>
        </section>

        <section class="section-card">
          <div class="section-card-heading"><div><h2>03 · Bring the rooms to life</h2><p>Choose a library item or add your own. Enter each finish's price; rates start with the library defaults.</p></div></div>
          <div class="line-items-list">${lineMarkup}</div>
          <div class="editor-add-actions">
            <button class="button button-secondary" type="button" data-action="add-item">+ Add line item</button>
            <button class="button" type="button" data-action="add-heading">+ Add floor heading</button>
          </div>
        </section>

        <section class="section-card">
          <div class="section-card-heading"><div><h2>04 · A fair, clear total</h2><p>Discounts and taxes are itemized for your client.</p></div></div>
          <div class="section-card-body">
            <div class="summary-line"><span>Subtotal</span><strong>${money(totals.subtotal)}</strong></div>
            <div class="summary-line summary-discount">
              <label class="summary-percent">Discount <input class="form-control" type="number" data-quote-field="discountPercent" min="0" max="100" step="any" value="${escapeHtml(quote.discountPercent)}" inputmode="decimal"> %</label>
              <strong>− ${money(totals.discount)}</strong>
            </div>
            <div class="summary-line summary-gap"><span>Tax on balance (${escapeHtml(quote.taxRate)}%)</span><strong>${money(totals.tax)}</strong></div>
            <div class="summary-line summary-line-grand summary-gap"><span>Quote total</span><strong>${money(totals.grandTotal)}</strong></div>
            <p class="field-help field-grid-gap">Set tax to 0% if it does not apply. Confirm rates and tax treatment before sending.</p>
          </div>
        </section>

        <section class="section-card">
          <div class="section-card-heading"><div><h2>05 · Your terms</h2><p>Every line can be tailored to this client.</p></div><button class="text-action" type="button" data-action="reset-quote-terms">↻ Restore from Settings</button></div>
          <div class="section-card-body">
            <label class="field-group"><span class="field-label">Terms and conditions <span class="field-help">One condition per line.</span></span>
              <textarea class="form-control" data-quote-field="terms" rows="6" placeholder="Your client terms…">${escapeHtml(quote.terms)}</textarea>
            </label>
          </div>
        </section>
      </div>

      <aside class="preview-column" aria-label="Live quotation preview">
        <div class="preview-heading"><span>YOUR CLIENT'S VIEW</span><span class="preview-zoom">A4 · live preview</span></div>
        ${renderQuotationPaper(quote)}
      </aside>
    </div>
  `;
}

function quoteLineRate(line, packageId) {
  return Math.max(0, Number(line.rates?.[packageId] ?? line.rate) || 0);
}

function renderPaperRows(quote) {
  let rows = '';
  let previousWasHeader = false;
  const packageCount = state.settings.packages.length;

  for (const line of quote.items) {
    if (line.type === 'header') {
      const title = line.title.trim();
      if (!title) continue;
      previousWasHeader = true;
      rows += `<tr class="quote-floor-row"><td colspan="${packageCount + 2}">${escapeHtml(title)}</td></tr>`;
      continue;
    }

    if (!line.name.trim()) continue;
    const quantity = Number(line.quantity) || 0;
    const detail = line.description ? `<span class="quote-item-detail">${escapeHtml(line.description)}</span>` : '';
    const amounts = state.settings.packages.map((entry) => {
      const rate = quoteLineRate(line, entry.id);
      return `<td>${rate > 0 ? money(quantity * rate) : '—'}</td>`;
    }).join('');
    rows += `<tr><td>${escapeHtml(line.name)}${detail}</td><td>${escapeHtml(quantity)} ${escapeHtml(line.unit)}</td>${amounts}</tr>`;
    previousWasHeader = false;
  }

  if (!rows) return `<tr><td colspan="${packageCount + 2}" class="quote-table-empty">Room for your project, considered in every detail.</td></tr>`;
  if (previousWasHeader) rows += `<tr><td colspan="${packageCount + 2}" class="quote-table-empty">Work details to be confirmed.</td></tr>`;
  return rows;
}

function renderQuotationPaper(quote) {
  const terms = quote.terms.split(/\r?\n/).map((term) => term.trim()).filter(Boolean);
  const packages = state.settings.packages;
  const selectedPackage = currentPackage(quote);
  const packageTotals = packages.map((entry) => ({
    entry,
    totals: packageQuoteTotals(quote, entry.id)
  }));
  const expiryDate = new Date(`${quote.issueDate || localDateString()}T12:00:00`);
  if (Number.isFinite(expiryDate.getTime())) expiryDate.setDate(expiryDate.getDate() + Math.max(1, Number(quote.validityDays) || 30));
  const validityDate = Number.isFinite(expiryDate.getTime()) ? localDateString(expiryDate) : '';
  const issueDateLabel = formatDate(quote.issueDate);

  return `
    <article class="quotation-paper" id="quotationPaper" aria-label="Printable quotation ${escapeHtml(quote.number)}">
      <header class="quote-paper-head">
        <img class="quote-paper-logo" src="assets/la-casa-logo.png" alt="La Casa Interiors">
        <div class="quote-company"><strong>${escapeHtml(state.settings.companyName)}</strong><span>${escapeHtml(state.settings.companyEmail)}${state.settings.companyPhone ? ` · ${escapeHtml(state.settings.companyPhone)}` : ''}</span><span>${escapeHtml(state.settings.companyAddress)}</span></div>
        <div class="quote-paper-code">QUOTATION<br>${escapeHtml(quote.number)}<span>Issued ${issueDateLabel}</span><span>Valid through ${formatDate(validityDate)}</span></div>
      </header>

      <div class="quote-section-label">Prepared for</div>
      <section class="quote-client-grid" aria-label="Client details">
        <div class="quote-client-field"><span>CLIENT NAME</span><strong>${escapeHtml(quote.clientName || 'Your valued client')}</strong></div>
        <div class="quote-client-field"><span>PHONE NUMBER</span><strong>${escapeHtml(quote.clientPhone || '—')}</strong></div>
        <div class="quote-client-field"><span>PROPERTY ADDRESS</span><strong>${escapeHtml(quote.clientAddress || 'Address to be confirmed')}</strong></div>
        <div class="quote-client-field"><span>PROJECT / HOME</span><strong>${escapeHtml(quote.projectName || 'Interior design')}</strong></div>
      </section>

      <div class="quote-section-label">Material finish options</div>
      <section class="quote-package-grid" aria-label="Available finish options">${renderPackageChoices(quote, true)}</section>

      <table class="quote-items-table" aria-label="Quotation line item totals for every finish">
        <thead><tr><th>Item</th><th>Qty</th>${packages.map((entry) => `<th>${escapeHtml(entry.name)} amount</th>`).join('')}</tr></thead>
        <tbody>${renderPaperRows(quote)}</tbody>
      </table>

      <section class="quote-totals-grid" aria-label="Totals by material finish">
        ${packageTotals.map(({ entry, totals: finishTotals }) => `
          <div class="quote-totals ${entry.id === selectedPackage?.id ? 'is-selected' : ''}">
            <strong class="quote-totals-package">${escapeHtml(entry.name)}${entry.id === selectedPackage?.id ? ' · Selected' : ''}</strong>
            <div class="quote-total-line"><span>Subtotal</span><strong>${money(finishTotals.subtotal)}</strong></div>
            ${quote.discountPercent > 0 ? `<div class="quote-total-line"><span>Discount (${escapeHtml(quote.discountPercent)}%)</span><strong>− ${money(finishTotals.discount)}</strong></div>` : ''}
            ${quote.taxRate > 0 ? `<div class="quote-total-line"><span>Tax (${escapeHtml(quote.taxRate)}%)</span><strong>${money(finishTotals.tax)}</strong></div>` : ''}
            <div class="quote-total-line quote-total-grand"><span>Grand total</span><strong>${money(finishTotals.grandTotal)}</strong></div>
          </div>
        `).join('')}
      </section>

      <div class="quote-section-label">Terms and conditions</div>
      ${terms.length ? `<ol class="quote-terms">${terms.map((term) => `<li>${escapeHtml(term)}</li>`).join('')}</ol>` : '<p class="quote-terms-empty">Payment and project terms will be agreed together.</p>'}

      <section class="quote-signatures" aria-label="Quotation acceptance">
        <div class="signature"><span>For ${escapeHtml(state.settings.companyName)}</span></div>
        <div class="signature"><span>Client acceptance &amp; date</span></div>
      </section>
      <footer class="quote-paper-footer">We would be delighted to bring your home to life.</footer>
    </article>
  `;
}

function renderCatalog() {
  const packageHeaders = state.settings.packages.map((entry) => `<span>${escapeHtml(entry.name)} price</span>`).join('');
  const rows = state.settings.items.length
    ? state.settings.items.map((item) => renderCatalogRow(item)).join('')
    : '<div class="search-empty">Your line item library is empty. Add a detail of your own.</div>';

  return `
    <div class="page-heading">
      <div><p class="eyebrow">The details that make a home</p><h1>Line item library</h1><p>Choose a name, description, unit and price for every finish.</p></div>
      <button class="button button-primary" type="button" data-action="add-catalog-item">+ Add a line item</button>
    </div>
    <div class="toolbar"><span class="field-help">${state.settings.items.length} ${state.settings.items.length === 1 ? 'saved item' : 'saved items'} · price for each finish can be changed on a quotation</span></div>
    <section class="panel">
      <div class="panel-heading"><div><h2>Your line items</h2><div class="panel-subtitle">Quotation edits stay with that client; save the updated price here when you want it in the library too.</div></div></div>
      <div class="panel-body">
        <div class="catalog-headings" aria-hidden="true"><span>Line item</span><span>Short description</span><span>Unit</span>${packageHeaders}<span></span></div>
        <div id="catalogRows">${rows}</div>
        <div class="editor-add-actions editor-add-actions-top">
          <button class="button button-secondary" type="button" data-action="add-catalog-item">+ Add to library</button>
        </div>
      </div>
    </section>
  `;
}

function renderCatalogRow(item) {
  const packagePrices = state.settings.packages.map((entry) => `
    <label class="field-group"><span class="field-label" hidden>${escapeHtml(entry.name)} price</span>
      <input class="form-control" type="number" data-library-rate="${escapeHtml(item.id)}" data-package-id="${escapeHtml(entry.id)}" min="0" step="any" value="${escapeHtml(item.rates?.[entry.id] ?? 0)}" aria-label="${escapeHtml(item.name || 'Line item')} ${escapeHtml(entry.name)} rate" inputmode="decimal">
    </label>`).join('');

  return `
    <div class="catalog-item-row" data-catalog-row="${escapeHtml(item.id)}">
      <label class="field-group"><span class="field-label" hidden>Line item name</span><input class="form-control" data-library-field="name" data-library-id="${escapeHtml(item.id)}" value="${escapeHtml(item.name)}" placeholder="Line item name" maxlength="120" aria-label="Line item name"></label>
      <label class="field-group"><span class="field-label" hidden>Description</span><input class="form-control" data-library-field="description" data-library-id="${escapeHtml(item.id)}" value="${escapeHtml(item.description)}" placeholder="Room or detail" maxlength="160" aria-label="Line item description"></label>
      <label class="field-group"><span class="field-label" hidden>Unit</span><input class="form-control" data-library-field="unit" data-library-id="${escapeHtml(item.id)}" value="${escapeHtml(item.unit)}" placeholder="sft" maxlength="15" aria-label="Unit of measure"></label>
      ${packagePrices}
      <button class="icon-button icon-button-danger catalog-remove" type="button" data-action="remove-catalog-item" data-catalog-id="${escapeHtml(item.id)}" aria-label="Remove ${escapeHtml(item.name || 'line item')}">×</button>
    </div>
  `;
}

function renderSettings() {
  const settings = state.settings;
  const currencyOptions = CURRENCY_OPTIONS.map(([code, label]) =>
    `<option value="${code}" ${settings.currency === code ? 'selected' : ''}>${label}</option>`
  ).join('');

  return `
    <div class="page-heading">
      <div><p class="eyebrow">The details behind the design</p><h1>Settings</h1><p>Make every quotation feel like it belongs to La Casa.</p></div>
      <div class="print-actions"><button class="button" type="button" data-action="export-backup">Download backup</button><button class="button" type="button" data-action="import-backup">Restore backup</button></div>
    </div>
    <div class="settings-layout">
      <div class="settings-column">
        <section class="section-card">
          <div class="section-card-heading"><div><h2>Your studio</h2><p>These details are printed on every quotation.</p></div></div>
          <div class="section-card-body">
            <div class="form-grid">
              <label class="field-group form-span-2"><span class="field-label">Business name</span><input class="form-control" data-setting-field="companyName" value="${escapeHtml(settings.companyName)}" maxlength="120"></label>
              <label class="field-group"><span class="field-label">Email</span><input class="form-control" type="email" data-setting-field="companyEmail" value="${escapeHtml(settings.companyEmail)}" maxlength="180"></label>
              <label class="field-group"><span class="field-label">Phone</span><input class="form-control" type="tel" data-setting-field="companyPhone" value="${escapeHtml(settings.companyPhone)}" maxlength="40"></label>
              <label class="field-group form-span-2"><span class="field-label">Studio address</span><input class="form-control" data-setting-field="companyAddress" value="${escapeHtml(settings.companyAddress)}" maxlength="220"></label>
            </div>
          </div>
        </section>

        <section class="section-card">
          <div class="section-card-heading"><div><h2>Material packages</h2><p>Each package can have its own materials and prices.</p></div><button class="button button-secondary button-small" type="button" data-action="add-package">+ Add a package</button></div>
          <div class="section-card-body">
            ${settings.packages.map((entry) => `
              <div class="package-setting-card" data-package-setting="${escapeHtml(entry.id)}">
                <label class="field-group"><span class="field-label">Package name</span><input class="form-control" data-package-field="name" data-package-id="${escapeHtml(entry.id)}" value="${escapeHtml(entry.name)}" maxlength="35" placeholder="e.g. Gold"></label>
                <label class="field-group"><span class="field-label">Materials &amp; finish</span><textarea class="form-control" data-package-field="description" data-package-id="${escapeHtml(entry.id)}" rows="2" maxlength="180" placeholder="Add one finish per line">${escapeHtml(entry.description)}</textarea></label>
                <button class="icon-button icon-button-danger" type="button" data-action="remove-package" data-package-id="${escapeHtml(entry.id)}" aria-label="Remove ${escapeHtml(entry.name)} package" title="Remove package" ${settings.packages.length <= 1 ? 'disabled' : ''}>×</button>
              </div>
            `).join('')}
            <p class="field-help">Each package has independent library rates. New quote lines copy all package rates from the library and remain editable.</p>
          </div>
        </section>

        <section class="section-card">
          <div class="section-card-heading"><div><h2>Terms &amp; conditions</h2><p>These will be offered as the default in new quotations.</p></div></div>
          <div class="section-card-body"><label class="field-group"><span class="field-label">One condition per line</span><textarea class="form-control" data-setting-field="terms" rows="9" maxlength="8000">${escapeHtml(settings.terms)}</textarea><span class="field-help">Changing your studio terms does not alter existing quotations. Use “Restore from Settings” in an existing quote if you want the new wording there too.</span></label></div>
        </section>
      </div>

      <div class="settings-column">
        <section class="section-card">
          <div class="section-card-heading"><div><h2>Quotation defaults</h2><p>A sensible start for each new client.</p></div></div>
          <div class="section-card-body">
            <div class="field-group"><label class="field-label" for="settingCurrency">Currency</label><select class="form-control" id="settingCurrency" data-setting-field="currency">${currencyOptions}</select></div>
            <div class="form-grid field-grid-gap">
              <label class="field-group"><span class="field-label">Valid for (days)</span><input class="form-control" type="number" data-setting-field="defaultValidity" min="1" max="365" value="${escapeHtml(settings.defaultValidity)}"></label>
              <label class="field-group"><span class="field-label">Default tax (%)</span><input class="form-control" type="number" data-setting-field="defaultTax" min="0" max="100" step="any" value="${escapeHtml(settings.defaultTax)}"></label>
            </div>
            <p class="field-help">You can change the validity and tax on each individual quotation before printing.</p>
          </div>
        </section>

        <section class="section-card">
          <div class="section-card-heading"><div><h2>Backup &amp; recovery</h2><p>Keep a copy of your client book somewhere safe.</p></div></div>
          <div class="section-card-body">
            <p class="field-help backup-copy">Quotes and settings are saved privately in this browser on this computer. Export a JSON backup before changing computers, browsers or browser storage.</p>
            <div class="editor-add-actions editor-add-actions-tight">
              <button class="button button-secondary" type="button" data-action="export-backup">Download a backup</button>
              <button class="button" type="button" data-action="import-backup">Restore from a backup</button>
            </div>
          </div>
        </section>

        <section class="section-card">
          <div class="section-card-heading"><div><h2>Google Drive</h2><p>Sync quote history and upload your exported PDFs to a Drive folder.</p></div></div>
          <div class="section-card-body">
            <label class="field-group">
              <span class="field-label">Google OAuth Web Client ID</span>
              <input class="form-control" type="text" data-setting-field="googleDriveClientId" value="${escapeHtml(settings.googleDriveClientId)}" placeholder="000000000000-abc123.apps.googleusercontent.com" maxlength="220" autocomplete="off" spellcheck="false">
              <span class="field-help">Create a Google Cloud Web application OAuth client ID and add http://127.0.0.1:49583 as an authorized JavaScript origin. Enable the Google Drive API. Do not paste an account password or client secret here.</span>
            </label>
            <p class="field-help">${driveAccountEmail ? `Signed in as ${escapeHtml(driveAccountEmail)} for this session.` : 'Not connected. Your files are uploaded only when you choose to sync or upload.'}</p>
            <div class="editor-add-actions editor-add-actions-tight field-grid-gap">
              <button class="button button-secondary" type="button" data-action="sync-drive">${driveAccountEmail ? 'Sync Drive history' : 'Connect Google Drive &amp; sync'}</button>
              <button class="button" type="button" data-action="change-drive-account">Change Google account</button>
              <button class="button" type="button" data-action="upload-drive-pdf">Upload exported PDF</button>
              ${driveFolderUrl ? `<a class="button" href="${escapeHtml(driveFolderUrl)}" target="_blank" rel="noopener noreferrer">Open Drive folder</a>` : ''}
              <input type="file" id="pdfUploadInput" accept="application/pdf,.pdf" multiple hidden>
            </div>
            <p class="field-help">Sync fetches and merges quotation history from your Drive backup. Client details and settings are sent to Google only when you sync. To share files with other people, share the “La Casa Quote Studio” folder in Google Drive.</p>
          </div>
        </section>

        <aside class="tip-card"><strong>Your catalogue has a head start</strong><p>The Silver rates in the supplied sample quotation are preloaded. Gold and Platinum prices are left at ₹0 so you can enter your agreed rates before sending a client quote.</p><p class="disclosure">The sample Silver rates are reference examples, not guarantees or recommended prices. Please verify quantities, rates, tax and terms for every project.</p></aside>
        <p class="field-help">The app works offline. Google Drive sync and PDF upload require an internet connection and your explicit sign-in.</p>
      </div>
    </div>
  `;
}

function createQuote(copyQuote = null) {
  const sequence = state.nextSequence;
  const packageId = state.settings.packages[0].id;
  const quote = {
    id: makeId('quote'),
    number: String(sequence).padStart(3, '0'),
    issueDate: localDateString(),
    validityDays: state.settings.defaultValidity,
    clientName: '',
    clientPhone: '',
    clientEmail: '',
    clientAddress: '',
    projectName: '',
    packageId,
    discountPercent: 0,
    taxRate: state.settings.defaultTax,
    terms: state.settings.terms,
    status: 'draft',
    updatedAt: new Date().toISOString(),
    items: []
  };

  if (copyQuote) {
    quote.clientName = copyQuote.clientName;
    quote.clientPhone = copyQuote.clientPhone;
    quote.clientEmail = copyQuote.clientEmail;
    quote.clientAddress = copyQuote.clientAddress;
    quote.projectName = copyQuote.projectName;
    quote.packageId = state.settings.packages.some((entry) => entry.id === copyQuote.packageId)
      ? copyQuote.packageId
      : packageId;
    quote.discountPercent = copyQuote.discountPercent;
    quote.taxRate = copyQuote.taxRate;
    quote.terms = copyQuote.terms;
    quote.items = copyQuote.items.map((item) => {
      if (item.type === 'header') return { ...item, id: makeId('heading') };
      return { ...item, id: makeId('line') };
    });
  }

  state.nextSequence += 1;
  state.quotes.unshift(quote);
  state.currentQuoteId = quote.id;
  saveState();
  showView('builder');
  const firstInput = pageContent.querySelector('[data-quote-field="clientName"]');
  if (firstInput) firstInput.focus();
}

function updateQuote(quote, key, value) {
  if (key === 'discountPercent' || key === 'taxRate') {
    quote[key] = Math.min(100, Math.max(0, Number(value) || 0));
  } else if (key === 'validityDays') {
    quote[key] = Math.min(365, Math.max(1, Number(value) || 1));
  } else if (key === 'issueDate') {
    quote[key] = String(value || '');
  } else {
    quote[key] = String(value ?? '');
  }
  quote.updatedAt = new Date().toISOString();
  saveState();
}

function renderLivePreview(quote) {
  const preview = pageContent.querySelector('.preview-column');
  if (!preview) return;
  preview.innerHTML = `<div class="preview-heading"><span>YOUR CLIENT'S VIEW</span><span class="preview-zoom">A4 · live preview</span></div>${renderQuotationPaper(quote)}`;
}

function refreshQuoteEditor(quote) {
  if (currentView !== 'builder' || !quote) return;
  const heading = pageContent.querySelector('.builder-heading');
  if (heading) {
    const description = heading.querySelector('p:not(.eyebrow)');
    if (description) description.textContent = quote.clientName || 'Add your client details to get started.';
  }

  const subtotal = quoteTotals(quote);
  const summaryLines = pageContent.querySelectorAll('.section-card:nth-of-type(4) .summary-line');
  if (summaryLines.length >= 4) {
    summaryLines[0].querySelector('strong').textContent = money(subtotal.subtotal);
    summaryLines[1].querySelector('strong').textContent = `− ${money(subtotal.discount)}`;
    summaryLines[2].innerHTML = `<span>Tax on balance (${escapeHtml(quote.taxRate)}%)</span><strong>${money(subtotal.tax)}</strong>`;
    summaryLines[3].querySelector('strong').textContent = money(subtotal.grandTotal);
  }

  quote.items.forEach((item) => {
    if (item.type !== 'item') return;
    const amountElement = pageContent.querySelector(`[data-line-amount="${CSS.escape(item.id)}"]`);
    if (amountElement) amountElement.textContent = Number(item.rate) > 0 ? money(Number(item.quantity) * Number(item.rate)) : 'Enter a rate';
  });

  renderLivePreview(quote);
  updateNavigation();
}

function validateForPrint(quote) {
  const clientName = pageContent.querySelector('[data-quote-field="clientName"]');
  if (!quote.clientName.trim()) {
    showToast('Please add your client’s name before printing the quotation.', true);
    clientName?.focus();
    return false;
  }
  const billableItems = quote.items.filter((item) => item.type === 'item' && item.name.trim());
  if (!billableItems.length) {
    showToast('Add at least one named line item before printing the quotation.', true);
    return false;
  }
  const unpricedItems = billableItems.filter((item) =>
    state.settings.packages.some((entry) => quoteLineRate(item, entry.id) <= 0));
  if (unpricedItems.length) {
    const missingPrices = unpricedItems.reduce((count, item) =>
      count + state.settings.packages.filter((entry) => quoteLineRate(item, entry.id) <= 0).length, 0);
    if (!window.confirm(`${missingPrices} package price${missingPrices === 1 ? '' : 's'} are missing across ${unpricedItems.length} line item${unpricedItems.length === 1 ? '' : 's'}.\n\nPrint all finishes with missing prices shown as dashes?`)) return false;
  }
  return true;
}

function printQuote(quote) {
  if (!validateForPrint(quote)) return;
  quote.status = 'saved';
  quote.updatedAt = new Date().toISOString();
  saveState();
  renderLivePreview(quote);
  const previousTitle = document.title;
  const clientSlug = quote.clientName.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42);
  document.title = `Quote-${quote.number}${clientSlug ? `-${clientSlug}` : ''}`;
  showToast('Your A4 quotation is ready. Choose “Save as PDF” or print it.');
  window.setTimeout(() => {
    window.print();
    window.setTimeout(() => { document.title = previousTitle; }, 1000);
  }, 120);
}

function moveLine(quote, lineId, direction) {
  const oldIndex = quote.items.findIndex((item) => item.id === lineId);
  const newIndex = oldIndex + direction;
  if (oldIndex < 0 || newIndex < 0 || newIndex >= quote.items.length) return;
  const [item] = quote.items.splice(oldIndex, 1);
  quote.items.splice(newIndex, 0, item);
  quote.updatedAt = new Date().toISOString();
  saveState();
  showView('builder');
}

function setPackage(quote, packageId) {
  if (!state.settings.packages.some((entry) => entry.id === packageId)) return;
  quote.packageId = packageId;
  for (const line of quote.items) {
    if (line.type !== 'item') continue;
    line.rate = quoteLineRate(line, packageId);
  }
  quote.updatedAt = new Date().toISOString();
  saveState();
  showView('builder');
}

function addLineItem(quote, type) {
  if (type === 'header') {
    quote.items.push({ id: makeId('heading'), type: 'header', title: 'Ground Floor' });
    quote.updatedAt = new Date().toISOString();
    saveState();
    showView('builder');
    const newHeading = pageContent.querySelector('[data-item-field="title"]:last-of-type');
    newHeading?.focus();
    newHeading?.select();
    return;
  }

  quote.items.push({
    id: makeId('line'),
    type: 'item',
    catalogId: '',
    name: '',
    description: '',
    unit: 'sft',
    quantity: 1,
    rate: 0,
    rates: Object.fromEntries(state.settings.packages.map((entry) => [entry.id, 0]))
  });
  quote.updatedAt = new Date().toISOString();
  saveState();
  showView('builder');
  const dropdowns = pageContent.querySelectorAll('[data-select-catalog]');
  dropdowns[dropdowns.length - 1]?.focus();
}

function syncLineToLibrary(quote, line, changedPackageId = '') {
  if (!line.name.trim()) {
    return false;
  }

  const existing = line.catalogId
    ? state.settings.items.find((entry) => entry.id === line.catalogId)
    : null;
  const libraryItem = existing || {
    id: makeId('catalog'),
    name: '',
    description: '',
    unit: 'unit',
    rates: Object.fromEntries(state.settings.packages.map((entry) => [entry.id, 0]))
  };
  libraryItem.name = line.name.trim();
  libraryItem.description = line.description;
  libraryItem.unit = line.unit || 'unit';
  if (!existing) {
    libraryItem.rates = Object.fromEntries(state.settings.packages.map((entry) => [
      entry.id,
      Math.max(0, Number(line.rates?.[entry.id]) || 0)
    ]));
  } else if (changedPackageId) {
    libraryItem.rates[changedPackageId] = Math.max(0, Number(line.rates?.[changedPackageId]) || 0);
  }
  libraryItem.updatedAt = new Date().toISOString();
  if (!existing) state.settings.items.push(libraryItem);
  line.catalogId = libraryItem.id;
  state.settings.updatedAt = libraryItem.updatedAt;
  return true;
}

function addCatalogItem() {
  const item = {
    id: makeId('catalog'),
    name: 'New line item',
    description: '',
    unit: 'sft',
    rates: Object.fromEntries(state.settings.packages.map((entry) => [entry.id, 0])),
    updatedAt: new Date().toISOString()
  };
  state.settings.items.push(item);
  state.settings.updatedAt = item.updatedAt;
  saveState();
  showView('catalog');
  const itemInput = pageContent.querySelector(`[data-library-id="${CSS.escape(item.id)}"][data-library-field="name"]`);
  itemInput?.focus();
  itemInput?.select();
}

function addPackage() {
  const index = state.settings.packages.length + 1;
  const packageId = makeId('package');
  state.settings.packages.push({
    id: packageId,
    name: `New package ${index}`,
    description: 'Add materials and finish details.'
  });
  for (const item of state.settings.items) item.rates[packageId] = 0;
  state.settings.updatedAt = new Date().toISOString();
  for (const quote of state.quotes) {
    for (const line of quote.items) {
      if (line.type !== 'item') continue;
      line.rates ||= {};
      line.rates[packageId] = 0;
    }
    quote.updatedAt = state.settings.updatedAt;
  }
  saveState();
  showView('settings');
  const input = pageContent.querySelector(`[data-package-id="${CSS.escape(packageId)}"][data-package-field="name"]`);
  input?.focus();
  input?.select();
}

function removePackage(packageId) {
  if (state.settings.packages.length <= 1) {
    showToast('Keep at least one material package.', true);
    return;
  }
  const packageEntry = findPackage(packageId);
  if (!packageEntry || !window.confirm(`Remove the “${packageEntry.name}” package? Existing quotations using this package will switch to the first remaining package.`)) return;

  state.settings.packages = state.settings.packages.filter((entry) => entry.id !== packageId);
  state.settings.updatedAt = new Date().toISOString();
  for (const item of state.settings.items) delete item.rates[packageId];
  for (const quote of state.quotes) {
    for (const line of quote.items) {
      if (line.type === 'item') delete line.rates?.[packageId];
    }
    if (quote.packageId === packageId) {
      quote.packageId = state.settings.packages[0].id;
      for (const line of quote.items) {
        if (line.type !== 'item') continue;
        line.rate = quoteLineRate(line, quote.packageId);
      }
      quote.updatedAt = state.settings.updatedAt;
    }
  }
  saveState();
  showView(currentView);
  showToast(`${packageEntry.name} was removed.`);
}

function downloadFile(fileName, content, contentType) {
  const link = document.createElement('a');
  const downloadUrl = URL.createObjectURL(new Blob([content], { type: contentType }));
  link.href = downloadUrl;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
}

async function getDriveAccessToken(forceAccountChooser = false) {
  const clientId = state.settings.googleDriveClientId.trim();
  if (!clientId) throw new Error('Add your Google OAuth Web Client ID in Settings before connecting Google Drive.');
  if (!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    throw new Error('The Google OAuth Web Client ID format is invalid. It should end in .apps.googleusercontent.com.');
  }
  if (!window.google?.accounts?.oauth2) {
    throw new Error('Google sign-in is not available. Connect to the internet and restart Quote Studio, then try again.');
  }

  return new Promise((resolve, reject) => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email',
      callback: (response) => {
        if (response.error) {
          reject(new Error(`Google Drive sign-in failed: ${response.error_description || response.error}`));
          return;
        }
        if (!response.access_token) {
          reject(new Error('Google did not return an access token. Please try signing in again.'));
          return;
        }
        resolve(response.access_token);
      },
      error_callback: (error) => reject(new Error(`Google sign-in could not open: ${error.message || error.type}`))
    });
    tokenClient.requestAccessToken({ prompt: forceAccountChooser ? 'select_account' : '' });
  });
}

async function driveApiRequest(path, token, options = {}) {
  const response = await fetch(`https://www.googleapis.com${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.contentType ? { 'Content-Type': options.contentType } : {})
    },
    ...(options.body ? { body: options.body } : {})
  });
  if (!response.ok) {
    const detail = await response.text();
    let message = detail;
    try {
      message = JSON.parse(detail).error?.message || detail;
    } catch {
      message = detail;
    }
    throw new Error(`Google Drive request failed (${response.status}): ${message || response.statusText}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function createDriveMultipart(metadata, content, mimeType) {
  const boundary = `quote-studio-${makeId('boundary')}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    content,
    `\r\n--${boundary}--`
  ]);
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

async function findOrCreateDriveFolder(token) {
  const query = encodeURIComponent(
    "name = 'La Casa Quote Studio' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
  );
  const listing = await driveApiRequest(
    `/drive/v3/files?q=${query}&spaces=drive&pageSize=100&fields=files(id,name,webViewLink)`,
    token
  );
  const folder = listing.files?.[0];
  if (folder) return folder;

  const multipart = createDriveMultipart(
    { name: 'La Casa Quote Studio', mimeType: 'application/vnd.google-apps.folder' },
    '',
    'application/json'
  );
  return driveApiRequest(
    '/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    token,
    { method: 'POST', body: multipart.body, contentType: multipart.contentType }
  );
}

async function findDriveFile(token, folderId, fileName) {
  const query = encodeURIComponent(
    `name = '${fileName}' and '${folderId}' in parents and trashed = false`
  );
  const listing = await driveApiRequest(
    `/drive/v3/files?q=${query}&spaces=drive&pageSize=100&fields=files(id,name,modifiedTime,webViewLink)`,
    token
  );
  return listing.files?.sort((first, second) => second.modifiedTime.localeCompare(first.modifiedTime))[0] || null;
}

async function uploadDriveFile(token, folderId, fileName, content, mimeType, existingFileId = '') {
  const metadata = {
    name: fileName,
    mimeType,
    ...(existingFileId ? {} : { parents: [folderId] })
  };
  const multipart = createDriveMultipart(metadata, content, mimeType);
  const path = existingFileId
    ? `/upload/drive/v3/files/${encodeURIComponent(existingFileId)}?uploadType=multipart&fields=id,name,webViewLink`
    : '/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink';
  return driveApiRequest(path, token, {
    method: existingFileId ? 'PATCH' : 'POST',
    body: multipart.body,
    contentType: multipart.contentType
  });
}

async function loadDriveBackup(token, backupFile) {
  if (!backupFile) return null;
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(backupFile.id)}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Could not read quotation history from Google Drive (${response.status}): ${detail}`);
  }
  const contents = await response.text();
  return hydrateState(JSON.parse(contents));
}

async function syncDrive(forceAccountChooser = false) {
  if (storageUnavailable) {
    showToast('Restore a valid quotation backup before syncing to Google Drive.', true);
    return;
  }

  try {
    const token = await getDriveAccessToken(forceAccountChooser);
    const profile = await driveApiRequest('/oauth2/v3/userinfo', token);
    driveAccountEmail = profile.email || 'Google account';
    const folder = await findOrCreateDriveFolder(token);
    driveFolderUrl = folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`;
    const backupFile = await findDriveFile(token, folder.id, 'quote-studio-backup.json');
    const remoteState = await loadDriveBackup(token, backupFile);
    const merged = remoteState ? mergeDriveData(state, remoteState) : state;
    const previousState = state;
    state = merged;
    if (!saveState()) {
      state = previousState;
      throw new Error('Merged quotation history could not be saved on this computer. The Drive backup was not overwritten.');
    }

    const contents = JSON.stringify({ ...state, currentView: 'dashboard', currentQuoteId: '' }, null, 2);
    await uploadDriveFile(
      token,
      folder.id,
      'quote-studio-backup.json',
      contents,
      'application/json',
      backupFile?.id || ''
    );
    showView(currentView);
    showToast(`Google Drive history synced for ${driveAccountEmail}. ${state.quotes.length} quotation${state.quotes.length === 1 ? '' : 's'} available.`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'An unexpected error prevented Google Drive sync.';
    showToast(`Google Drive sync failed. Your existing quotations have not been deleted. ${detail}`, true);
  }
}

async function uploadPdfsToDrive(files) {
  if (!files?.length) return;
  try {
    const token = await getDriveAccessToken();
    const profile = await driveApiRequest('/oauth2/v3/userinfo', token);
    driveAccountEmail = profile.email || 'Google account';
    const folder = await findOrCreateDriveFolder(token);
    driveFolderUrl = folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`;
    for (const file of files) {
      if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        throw new Error(`“${file.name}” is not a PDF. Select only exported quotation PDFs.`);
      }
      await uploadDriveFile(token, folder.id, file.name, file, 'application/pdf');
    }
    showView(currentView);
    showToast(`${files.length} PDF${files.length === 1 ? '' : 's'} uploaded to Google Drive for ${driveAccountEmail}.`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'An unexpected error prevented the PDF upload.';
    showToast(`Could not upload quotation PDF${files.length === 1 ? '' : 's'}. ${detail}`, true);
  } finally {
    const uploadInput = document.getElementById('pdfUploadInput');
    if (uploadInput) uploadInput.value = '';
  }
}

function exportBackup() {
  if (storageUnavailable) {
    showToast('A trustworthy backup cannot be created until saved data is restored. Your unreadable browser data has not been changed.', true);
    return;
  }
  const contents = JSON.stringify({ ...state, currentView: 'dashboard' }, null, 2);
  downloadFile(`la-casa-quote-studio-backup-${localDateString()}.json`, contents, 'application/json');
  showToast('A backup of your quotations, line items and settings has been downloaded.');
}

async function importBackup(file) {
  if (!file) return;
  try {
    const contents = await file.text();
    const parsed = hydrateState(JSON.parse(contents));
    if (!window.confirm(`Restore this backup? The ${parsed.quotes.length} saved quotation${parsed.quotes.length === 1 ? '' : 's'} and settings in the current browser will be replaced.`)) return;
    state = parsed;
    currentView = 'dashboard';
    storageUnavailable = false;
    storageMessage = '';
    if (!saveState()) throw new Error('Your restored data could not be saved in this browser.');
    showView('dashboard');
    showToast(`Backup restored: ${state.quotes.length} quotation${state.quotes.length === 1 ? '' : 's'} saved.`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'The selected backup could not be read.';
    showToast(`Could not restore backup. Your existing quotations have not been changed. ${detail}`, true);
  } finally {
    document.getElementById('backupInput').value = '';
  }
}

function removeQuote(quoteId) {
  const quote = state.quotes.find((entry) => entry.id === quoteId);
  if (!quote || !window.confirm(`Remove quotation ${quote.number}${quote.clientName ? ` for ${quote.clientName}` : ''}? This cannot be undone unless you have a backup.`)) return;
  state.quotes = state.quotes.filter((entry) => entry.id !== quoteId);
  state.deletedQuoteIds = [...new Set([...(state.deletedQuoteIds || []), quoteId])];
  if (state.currentQuoteId === quoteId) state.currentQuoteId = '';
  saveState();
  showView('quotes');
  showToast(`Quotation ${quote.number} was removed.`);
}

function handleAction(button) {
  const quote = findQuote();
  const quoteId = button.dataset.quoteId;
  const action = button.dataset.action;

  if (action === 'new-quote') return createQuote();
  if (action === 'show-dashboard') return showView('dashboard');
  if (action === 'edit-quote') {
    if (!state.quotes.some((entry) => entry.id === quoteId)) return;
    state.currentQuoteId = quoteId;
    return showView('builder');
  }
  if (action === 'duplicate-quote') {
    const source = state.quotes.find((entry) => entry.id === quoteId);
    if (source) createQuote(source);
    return;
  }
  if (action === 'delete-quote') return removeQuote(quoteId);
  if (action === 'save-quote' && quote) {
    quote.status = 'saved';
    quote.updatedAt = new Date().toISOString();
    saveState();
    showToast(`Quotation ${quote.number} is saved on this computer.`);
    updateNavigation();
    return;
  }
  if (action === 'print-quote' && quote) return printQuote(quote);
  if (action === 'add-item' && quote) return addLineItem(quote, 'item');
  if (action === 'add-heading' && quote) return addLineItem(quote, 'header');
  if (action === 'move-line' && quote) return moveLine(quote, button.dataset.lineId, Number(button.dataset.direction));
  if (action === 'remove-line' && quote) {
    quote.items = quote.items.filter((item) => item.id !== button.dataset.lineId);
    quote.updatedAt = new Date().toISOString();
    saveState();
    return showView('builder');
  }
  if (action === 'save-library' && quote) {
    const line = quote.items.find((item) => item.id === button.dataset.lineId);
    if (line?.type === 'item' && syncLineToLibrary(quote, line)) {
      saveState();
      showView('builder');
      return showToast(`${line.name} and its package prices were saved to the line item library.`);
    }
  }
  if (action === 'update-library' && quote) {
    const line = quote.items.find((item) => item.id === button.dataset.lineId);
    if (line?.type === 'item' && syncLineToLibrary(quote, line)) {
      saveState();
      showView('builder');
      return showToast(`${line.name} and its package prices were updated in the line item library.`);
    }
  }
  if (action === 'add-catalog-item') return addCatalogItem();
  if (action === 'remove-catalog-item') {
    const item = state.settings.items.find((entry) => entry.id === button.dataset.catalogId);
    if (!item) return;
    if (!window.confirm(`Remove “${item.name || 'this line item'}” from the library? It will remain in any quotation that already uses it.`)) return;
    state.settings.items = state.settings.items.filter((entry) => entry.id !== item.id);
    state.deletedCatalogItemIds = [...new Set([...(state.deletedCatalogItemIds || []), item.id])];
    state.settings.updatedAt = new Date().toISOString();
    saveState();
    showView('catalog');
    return showToast(`${item.name || 'Line item'} was removed from the library.`);
  }
  if (action === 'add-package') return addPackage();
  if (action === 'remove-package') return removePackage(button.dataset.packageId);
  if (action === 'reset-quote-terms' && quote) {
    if (!window.confirm('Use the current Settings terms for this quotation? Your existing quote terms will be replaced.')) return;
    quote.terms = state.settings.terms;
    quote.updatedAt = new Date().toISOString();
    saveState();
    showView('builder');
    return showToast('Settings terms were added to this quotation.');
  }
  if (action === 'export-backup') return exportBackup();
  if (action === 'import-backup') {
    document.getElementById('backupInput').click();
  }
  if (action === 'sync-drive') return syncDrive(!driveAccountEmail);
  if (action === 'change-drive-account') {
    driveAccountEmail = '';
    return syncDrive(true);
  }
  if (action === 'upload-drive-pdf') return document.getElementById('pdfUploadInput').click();
}

document.addEventListener('click', (event) => {
  const navigation = event.target.closest('[data-nav]');
  if (navigation) {
    if (navigation.dataset.nav === 'quotes' && currentView === 'quotes') return;
    return showView(navigation.dataset.nav);
  }

  const packageChoice = event.target.closest('[data-package-id]:not([data-package-field]):not([data-library-rate])');
  if (packageChoice && packageChoice.classList.contains('package-choice')) {
    const quote = findQuote();
    if (quote) return setPackage(quote, packageChoice.dataset.packageId);
  }

  const actionButton = event.target.closest('[data-action]');
  if (actionButton) handleAction(actionButton);
});

document.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  if (target.id === 'quoteSearch') {
    quoteSearch = target.value;
    const list = document.getElementById('quoteListTable');
    if (list) {
      const markup = renderQuotes();
      const template = document.createElement('div');
      template.innerHTML = markup;
      const replacement = template.querySelector('#quoteListTable');
      if (replacement) list.replaceWith(replacement);
    }
    const refreshedSearch = document.getElementById('quoteSearch');
    if (refreshedSearch) {
      refreshedSearch.focus();
      refreshedSearch.setSelectionRange(quoteSearch.length, quoteSearch.length);
    }
    return;
  }

  const quote = findQuote();
  if (target.dataset.quoteField && quote) {
    updateQuote(quote, target.dataset.quoteField, target.value);
    refreshQuoteEditor(quote);
    return;
  }

  const lineId = target.dataset.itemId;
  const packageRateId = target.dataset.itemPackageRate;
  if (lineId && packageRateId && quote) {
    const line = quote.items.find((entry) => entry.id === lineId);
    if (!line || line.type !== 'item') return;
    line.rates ||= {};
    line.rates[packageRateId] = Math.max(0, Number(target.value) || 0);
    if (packageRateId === quote.packageId) line.rate = line.rates[packageRateId];
    syncLineToLibrary(quote, line, packageRateId);
    quote.updatedAt = new Date().toISOString();
    saveState();
    refreshQuoteEditor(quote);
    return;
  }

  const itemField = target.dataset.itemField;
  if (lineId && itemField && quote) {
    const line = quote.items.find((entry) => entry.id === lineId);
    if (!line) return;
    line[itemField] = target.type === 'number' ? Math.max(0, Number(target.value) || 0) : target.value;
    if (line.type === 'item' && ['name', 'description', 'unit'].includes(itemField)) {
      syncLineToLibrary(quote, line);
    }
    quote.updatedAt = new Date().toISOString();
    saveState();
    refreshQuoteEditor(quote);
    return;
  }

  const libraryId = target.dataset.libraryId;
  const libraryField = target.dataset.libraryField;
  if (libraryId && libraryField) {
    const entry = state.settings.items.find((item) => item.id === libraryId);
    if (!entry) return;
    entry[libraryField] = target.value;
    entry.updatedAt = new Date().toISOString();
    state.settings.updatedAt = entry.updatedAt;
    saveState();
    return;
  }

  const rateLibraryId = target.dataset.libraryRate;
  if (rateLibraryId && target.dataset.packageId) {
    const entry = state.settings.items.find((item) => item.id === rateLibraryId);
    if (!entry) return;
    entry.rates[target.dataset.packageId] = Math.max(0, Number(target.value) || 0);
    entry.updatedAt = new Date().toISOString();
    state.settings.updatedAt = entry.updatedAt;
    saveState();
    return;
  }

  const settingField = target.dataset.settingField;
  if (settingField) {
    const value = settingField === 'defaultValidity'
      ? Math.min(365, Math.max(1, Number(target.value) || 1))
      : settingField === 'defaultTax'
        ? Math.min(100, Math.max(0, Number(target.value) || 0))
        : target.value;
    state.settings[settingField] = value;
    state.settings.updatedAt = new Date().toISOString();
    saveState();
    return;
  }

  const packageField = target.dataset.packageField;
  if (packageField && target.dataset.packageId) {
    const entry = findPackage(target.dataset.packageId);
    if (!entry) return;
    entry[packageField] = target.value;
    state.settings.updatedAt = new Date().toISOString();
    saveState();
    return;
  }
});

document.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  if (target instanceof HTMLInputElement && target.id === 'backupInput') {
    return importBackup(target.files?.[0]);
  }

  if (target instanceof HTMLInputElement && target.id === 'pdfUploadInput') {
    return uploadPdfsToDrive(target.files);
  }

  const selectedQuote = findQuote();
  if (selectedQuote && target.dataset.selectCatalog) {
    const selectedItem = state.settings.items.find((entry) => entry.id === target.value);
    const line = selectedQuote.items.find((entry) => entry.id === target.dataset.selectCatalog);
    if (!line || line.type !== 'item') return;
    if (selectedItem) {
      line.catalogId = selectedItem.id;
      line.name = selectedItem.name;
      line.description = selectedItem.description;
      line.unit = selectedItem.unit;
      line.quantity = 1;
      line.rates = Object.fromEntries(state.settings.packages.map((entry) => [
        entry.id,
        Math.max(0, Number(selectedItem.rates?.[entry.id]) || 0)
      ]));
      line.rate = quoteLineRate(line, selectedQuote.packageId);
    } else {
      line.catalogId = '';
      line.name = '';
      line.description = '';
      line.unit = 'sft';
      line.quantity = 1;
      line.rate = 0;
      line.rates = Object.fromEntries(state.settings.packages.map((entry) => [entry.id, 0]));
    }
    selectedQuote.updatedAt = new Date().toISOString();
    saveState();
    return showView('builder');
  }

  if (target.id === 'settingCurrency') {
    state.settings.currency = target.value;
    saveState();
    return renderLivePreview(findQuote());
  }
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((error) => {
      const detail = error instanceof Error ? error.message : 'The offline application cache could not be enabled.';
      showToast(`Quote Studio is running, but offline app installation is unavailable. ${detail}`, true);
    });
  });
}

showView(currentView);
if (storageUnavailable) {
  showToast(`Existing saved data could not be read and has not been overwritten. Changes will remain temporary. Restore a compatible JSON backup in Settings. ${storageMessage}`, true);
}
