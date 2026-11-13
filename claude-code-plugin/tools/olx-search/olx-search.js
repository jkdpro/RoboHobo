import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

export const MAX_RESULT_CAP = 25;
export const MAX_CARDS = 50;
export const MAX_PAGES = 5;
const NAVIGATION_TIMEOUT_MS = 25_000;
const ACTION_TIMEOUT_MS = 8_000;
const PAGE_PAUSE_MS = 1_000;
const MAX_RUNTIME_MS = 90_000;
const MAX_INPUT_BYTES = 64 * 1024;
const BASE_URL = 'https://www.olx.pl/praca/';

const FILTERS = {
  job_category: {
    IT: { group: 'Kategoria', options: ['Praca', 'IT / telekomunikacja'] },
  },
  employment_type: {
    full_time: { group: 'Wymiar pracy', options: ['Pełny etat'] },
    part_time: { group: 'Wymiar pracy', options: ['Niepełny etat', 'Praca dodatkowa'] },
    temporary: { group: 'Wymiar pracy', options: ['Praca sezonowa', 'Praca dodatkowa'] },
  },
  work_mode: {
    onsite: { group: 'Miejsce pracy', options: ['W siedzibie firmy'] },
    hybrid: { group: 'Miejsce pracy', options: ['Praca hybrydowa'] },
    remote: { group: 'Miejsce pracy', options: ['Praca zdalna'] },
  },
};

const WORK_MODE_LABELS = ['W siedzibie firmy', 'Praca zdalna', 'Praca hybrydowa'];
const EMPLOYMENT_LABELS = ['Pełny etat', 'Niepełny etat', 'Praca dodatkowa', 'Praca sezonowa', 'Współpraca B2B'];
const ALL_LABELS = [...WORK_MODE_LABELS, ...EMPLOYMENT_LABELS, 'Częste podróże służbowe'];
const POLISH_MONTHS = 'stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia';
const POSTING_TEXT = new RegExp(`^(?:(?:Odświeżono|Dodano)(?:\\s+dnia)?\\s+)?(?:Dzisiaj(?:\\s+o\\s+\\d{1,2}:\\d{2})?|Wczoraj(?:\\s+o\\s+\\d{1,2}:\\d{2})?|\\d{1,2}\\s+(?:${POLISH_MONTHS})(?:\\s+\\d{4})?)`, 'i');

export class SearchError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function compactText(value, max = 500) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, max) : null;
}

export function safeOlxUrl(input, base = 'https://www.olx.pl/') {
  const url = new URL(input, base);
  if (url.protocol !== 'https:' || url.hostname !== 'www.olx.pl') {
    throw new SearchError('unexpected_host', 'OLX exposed a URL outside its HTTPS site.');
  }
  return url;
}

export function safeJobUrl(input, base = 'https://www.olx.pl/') {
  const url = safeOlxUrl(input, base);
  if (!url.pathname.startsWith('/oferta/praca/')) {
    throw new SearchError('unexpected_path', 'OLX exposed a URL outside its job-listing pages.');
  }
  return url;
}

export function parseCardFields(item) {
  const paragraphs = (item.paragraphs ?? []).map((text) => compactText(text)).filter(Boolean);
  const paragraphLabels = paragraphs.filter((text) => ALL_LABELS.includes(text));
  const buttonLabels = (item.buttonTexts ?? []).flatMap((value) => {
    const text = compactText(value);
    const match = text?.match(/^(?:Miejsce pracy|Wymiar pracy):\s*(.+)$/i);
    return match ? match[1].split(/\s*,\s*/).map((label) => compactText(label)).filter(Boolean) : [];
  }).filter((text) => ALL_LABELS.includes(text));
  const labels = [...new Set([...paragraphLabels, ...buttonLabels])];
  const title = compactText(item.title, 300);
  const salary = paragraphs.find((text) => /\d.*(?:zł|PLN)/i.test(text)) ?? null;
  const posted = paragraphs.find((text) => POSTING_TEXT.test(text)) ?? null;
  const contract = paragraphs.filter((text) => /^Umowa\b/i.test(text));
  const remaining = paragraphs.filter((text) =>
    text !== title && text !== salary && text !== posted && !labels.includes(text) && !contract.includes(text));
  let employer = null;
  let locationText = null;
  let otherVisible = remaining;
  if (remaining.length >= 2) {
    [employer, locationText] = remaining;
    otherVisible = remaining.slice(2);
  } else if (remaining.length === 1 && salary) {
    locationText = remaining[0];
    otherVisible = [];
  }
  const url = item.href ? safeJobUrl(item.href).href : null;
  const rawLabels = labels;
  return {
    position: item.position,
    id: url?.match(/-([A-Z0-9]{5,})(?:\.html|\?|$)/i)?.[1] ?? null,
    url,
    title,
    employer,
    location_text: locationText,
    salary_text: salary,
    posted_text: posted,
    contract_text: contract,
    raw_labels: rawLabels,
    work_mode_labels: rawLabels.filter((label) => WORK_MODE_LABELS.includes(label)),
    employment_labels: rawLabels.filter((label) => EMPLOYMENT_LABELS.includes(label)),
    other_visible: otherVisible.map((text) => compactText(text, 300)).filter(Boolean).slice(0, 8),
    promoted: Boolean(item.text && /SPONSOROWANE|PROMOWANE/i.test(item.text)),
    untrusted: true,
  };
}

export function validateRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SearchError('invalid_request', 'Request must be a JSON object.');
  }
  const allowed = new Set(['job_category', 'employment_type', 'work_mode', 'location', 'result_cap']);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new SearchError('invalid_request', `Unknown request fields: ${unknown.join(', ')}`);

  if (!Number.isSafeInteger(value.result_cap) || value.result_cap < 1) {
    throw new SearchError('invalid_request', 'result_cap must be a positive safe integer.');
  }
  if (value.job_category != null && !Object.hasOwn(FILTERS.job_category, value.job_category)) {
    throw new SearchError('invalid_request', 'Unsupported job_category slug.');
  }
  for (const key of ['employment_type', 'work_mode']) {
    const conditions = value[key] ?? {};
    if (!conditions || typeof conditions !== 'object' || Array.isArray(conditions)) {
      throw new SearchError('invalid_request', `${key} must be an action mapping.`);
    }
    for (const [action, slugs] of Object.entries(conditions)) {
      if (!['require', 'exclude'].includes(action)) {
        throw new SearchError('invalid_request', `${key}.${action} is not a portal-filter input; pass only require/exclude constraints.`);
      }
      if (!Array.isArray(slugs) || slugs.some((slug) => typeof slug !== 'string' || !Object.hasOwn(FILTERS[key], slug))) {
        throw new SearchError('invalid_request', `${key}.${action} must be a list of registered slugs.`);
      }
    }
  }
  if (value.location != null) {
    const location = value.location;
    if (!location || typeof location !== 'object' || Array.isArray(location) ||
        Object.keys(location).some((key) => !['city', 'country', 'radius_km'].includes(key))) {
      throw new SearchError('invalid_request', 'location must contain only city, country, and radius_km.');
    }
    if (location.country != null && location.country !== 'PL') {
      throw new SearchError('unsupported_location', 'OLX.pl searches support country PL only.');
    }
    if (location.city != null && (typeof location.city !== 'string' || !location.city.trim())) {
      throw new SearchError('invalid_request', 'location.city must be a non-empty string.');
    }
    if (location.country != null && location.city == null) {
      throw new SearchError('invalid_request', 'location.country requires location.city.');
    }
    if (location.radius_km != null && (!Number.isFinite(location.radius_km) || location.radius_km <= 0)) {
      throw new SearchError('invalid_request', 'location.radius_km must be a positive number.');
    }
    if (location.radius_km != null && location.city == null) {
      throw new SearchError('invalid_request', 'location.radius_km requires location.city.');
    }
    if (location.radius_km != null && radiusOption(location.radius_km) == null) {
      throw new SearchError('unsupported_location', 'No OLX radius option can cover the requested radius.');
    }
  }
  return { ...value, location: value.location ?? {} };
}

function radiusOption(radiusKm) {
  return [0, 2, 5, 10, 15, 30, 50, 75, 100].find((option) => option >= radiusKm);
}

function requiredSlugs(mapping = {}) {
  return mapping.require ?? [];
}

function excludedSlugs(mapping = {}) {
  return mapping.exclude ?? [];
}

function mappedOptions(slugs, node) {
  return [...new Set(slugs.flatMap((slug) => FILTERS[node][slug].options.slice(node === 'job_category' ? 1 : 0)))];
}

function desiredFilters(request) {
  const result = [];
  if (request.job_category) {
    result.push({ node: 'job_category', slug: request.job_category, action: 'require', ...FILTERS.job_category[request.job_category] });
  }
  for (const node of ['employment_type', 'work_mode']) {
    for (const action of ['require', 'exclude']) {
      for (const slug of request[node]?.[action] ?? []) {
        result.push({ node, slug, action, ...FILTERS[node][slug] });
      }
    }
  }
  return result;
}

async function selectOptionInGroup(page, groupName, optionName, select) {
  const group = page.getByRole('group', { name: groupName, exact: true });
  if (await group.count() === 0) throw new SearchError('schema_changed', `OLX filter group not found: ${groupName}`);
  const option = group.getByRole('option', { name: optionName, exact: true });
  if (await option.count() === 0) throw new SearchError('filter_unavailable', `OLX option not found: ${groupName} / ${optionName}`);
  const state = await option.evaluate((element) => {
    if (element.hasAttribute('aria-selected')) return element.getAttribute('aria-selected') === 'true';
    if (element.hasAttribute('aria-checked')) return element.getAttribute('aria-checked') === 'true';
    const checkbox = element.querySelector('input[type="checkbox"]');
    return checkbox ? checkbox.checked : null;
  });
  if (state === null) throw new SearchError('schema_changed', `Cannot determine selection state for ${groupName} / ${optionName}.`);
  if (state !== select) await option.click({ timeout: ACTION_TIMEOUT_MS });
}

async function selectCategory(page, slug) {
  const path = FILTERS.job_category[slug].options;
  await page.getByRole('button', { name: 'Kategoria', exact: true }).click({ timeout: ACTION_TIMEOUT_MS });
  for (const label of path) {
    const option = page.getByRole('option', { name: label, exact: true });
    if (await option.count() === 1) {
      await option.click({ timeout: ACTION_TIMEOUT_MS });
      continue;
    }
    const item = page.getByText(label, { exact: true });
    if (await item.count() !== 1) throw new SearchError('filter_unavailable', `OLX category path not found: ${path.join(' / ')}`);
    await item.click({ timeout: ACTION_TIMEOUT_MS });
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function pickSuggestion(page, city) {
  const input = page.getByRole('combobox', { name: 'Cała Polska' });
  await input.fill(city, { timeout: ACTION_TIMEOUT_MS });
  const suggestion = page.getByRole('option', { name: new RegExp(`^${escapeRegExp(city)}(?:,|$)`, 'i') });
  const count = await suggestion.count();
  if (count !== 1) throw new SearchError('ambiguous_location', `Expected one OLX location suggestion for ${city}, found ${count}.`);
  await suggestion.click({ timeout: ACTION_TIMEOUT_MS });
}

async function applyLocation(page, location, applied) {
  if (location.city) {
    await pickSuggestion(page, location.city);
    applied.push({ node: 'location.city', requested: location.city, status: 'full' });
  }
  if (location.radius_km != null) {
    const chosen = radiusOption(location.radius_km);
    const group = page.getByRole('group', { name: 'Odległość', exact: true });
    await group.getByRole('button').first().click({ timeout: ACTION_TIMEOUT_MS });
    const option = page.getByRole('option', { name: new RegExp(`^\\+${chosen} km`) }).first();
    await option.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS });
    await option.click({ timeout: ACTION_TIMEOUT_MS });
    applied.push({ node: 'location.radius_km', requested: location.radius_km, applied: chosen, status: chosen === location.radius_km ? 'full' : 'partial' });
  }
}

async function applyFilters(page, request, applied) {
  const requiredEmployment = requiredSlugs(request.employment_type);
  const excludedEmployment = excludedSlugs(request.employment_type);
  const requiredWorkMode = requiredSlugs(request.work_mode);
  const requiredEmploymentOptions = new Set(mappedOptions(requiredEmployment, 'employment_type'));
  const overlaps = new Set([
    ...requiredEmploymentOptions,
    ...mappedOptions(requiredWorkMode, 'work_mode'),
  ]);

  for (const filter of desiredFilters(request)) {
    if (filter.node === 'job_category') {
      await selectCategory(page, filter.slug);
      applied.push({ node: filter.node, slug: filter.slug, status: 'full' });
      continue;
    }
    const required = filter.node === 'employment_type' ? requiredEmployment : requiredWorkMode;
    const requiredOptions = new Set(mappedOptions(required, filter.node));
    for (const optionName of filter.options) {
      if (filter.action === 'exclude' && requiredOptions.has(optionName)) continue;
      const select = filter.action === 'require' || (filter.node === 'employment_type' && optionName === 'Współpraca B2B' && requiredEmploymentOptions.has(optionName));
      await selectOptionInGroup(page, filter.group, optionName, select);
    }
    const overlapsRequired = filter.node === 'employment_type' && filter.action === 'exclude' && filter.options.some((option) => overlaps.has(option));
    const status = filter.action === 'exclude' || overlapsRequired ? 'partial' : 'full';
    applied.push({ node: filter.node, slug: filter.slug, action: filter.action, status });
  }

  if ((requiredEmployment.length || excludedEmployment.length) && !requiredEmploymentOptions.has('Współpraca B2B')) {
    await selectOptionInGroup(page, 'Wymiar pracy', 'Współpraca B2B', true);
    applied.push({ node: 'employment_type.supplemental', slug: 'Współpraca B2B', status: 'applied' });
  }
}

export async function detectBlocked(page) {
  const text = (await page.locator('body').innerText({ timeout: 2_000 }).catch(() => '')).toLowerCase();
  if (/captcha|weryfikujemy, czy jesteś człowiekiem|verify you are human/.test(text)) return 'CAPTCHA or human-verification challenge detected.';
  if (/dostęp został zablokowany|access denied|zbyt wiele żądań|too many requests/.test(text)) return 'OLX access block detected.';

  const dialogs = page.getByRole('dialog');
  for (let index = 0, count = await dialogs.count(); index < count; index += 1) {
    const dialogText = (await dialogs.nth(index).innerText().catch(() => '')).toLowerCase();
    if (/zaloguj się|log in|sign in/.test(dialogText) && /kontynuuj|ogłoszen|telefon|wiadomość|account/.test(dialogText)) {
      return 'Login wall detected.';
    }
  }
  if (/zaloguj się, aby kontynuować|musisz się zalogować|log in to continue|sign in to continue/.test(text)) {
    return 'Login wall detected.';
  }
  return null;
}

function checkResponse(response) {
  if (response && (response.status() === 403 || response.status() === 429)) {
    throw new SearchError('blocked', `OLX returned HTTP ${response.status()}.`);
  }
}

function checkPageResponse(page) {
  if (page.__olxBlockedResponse) throw new SearchError('blocked', page.__olxBlockedResponse);
}

function isNoResultsText(text) {
  return /nie znaleźliśmy żadnych ogłoszeń|brak wyników|nie znaleziono ogłoszeń|nie ma ogłoszeń/i.test(text);
}

async function waitForResults(page, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // On OLX the title heading may be a sibling of the listing anchor, not nested inside it.
    const cardCount = await page.locator('a[href*="/oferta/praca/"]').count();
    if (cardCount) return 'cards';
    const text = (await page.locator('body').innerText({ timeout: 2_000 }).catch(() => '')).toLowerCase();
    if (isNoResultsText(text)) return 'no_results';
    const blocked = await detectBlocked(page);
    if (blocked) throw new SearchError('blocked', blocked);
    checkPageResponse(page);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  const blocked = await detectBlocked(page);
  if (blocked) throw new SearchError('blocked', blocked);
  checkPageResponse(page);
  throw new SearchError('schema_changed', 'OLX results did not expose recognizable cards or a no-results state.');
}

async function setSortNewest(page, applied) {
  const group = page.getByRole('group', { name: /Sortuj/ });
  const sort = group.getByRole('button').first();
  if (await sort.count() === 0) {
    applied.push({ node: 'sort', requested: 'newest', status: 'unavailable' });
    return;
  }
  if ((await sort.innerText().catch(() => '')).includes('Najnowsze')) {
    applied.push({ node: 'sort', requested: 'newest', status: 'full' });
    return;
  }
  await sort.click({ timeout: ACTION_TIMEOUT_MS });
  const option = page.getByRole('option', { name: 'Najnowsze', exact: true }).first();
  if (await option.count() === 0) {
    applied.push({ node: 'sort', requested: 'newest', status: 'unavailable' });
    return;
  }
  const firstCard = page.locator('a[href*="/oferta/praca/"]').first();
  const initialHref = await firstCard.getAttribute('href').catch(() => null);
  await option.click({ timeout: ACTION_TIMEOUT_MS });
  try {
    await page.waitForFunction((previousHref) => {
      const current = document.querySelector('a[href*="/oferta/praca/"]')?.getAttribute('href') ?? null;
      return !previousHref || (current && current !== previousHref);
    }, initialHref, { timeout: ACTION_TIMEOUT_MS });
  } catch (error) {
    if (error?.name !== 'TimeoutError') throw error;
    applied.push({ node: 'sort', requested: 'newest', status: 'unavailable' });
    return;
  }
  await waitForResults(page);
  const currentSort = await group.getByRole('button').first().innerText().catch(() => '');
  if (!currentSort.includes('Najnowsze')) throw new SearchError('schema_changed', 'OLX did not confirm newest-first sorting.');
  applied.push({ node: 'sort', requested: 'newest', status: 'full' });
}

async function collectCards(page, maxCards, deadline) {
  const cards = [];
  let pagesFetched = 0;
  let hasNextPage = false;
  let noResults = false;

  while (cards.length < maxCards && pagesFetched < MAX_PAGES) {
    if (Date.now() >= deadline) throw new SearchError('timeout', 'Search exceeded the overall time limit.');
    const pageCards = await page.evaluate(() => {
      const links = [...document.querySelectorAll('a[href*="/oferta/praca/"]')];
      return links.flatMap((link) => {
        const href = link.getAttribute('href');
        if (!href) return [];

        // OLX has used generic div wrappers for cards. Walk upward only while
        // the ancestor still contains exactly this one result link.
        const titleSelector = 'h4, h3, [data-cy="ad-card-title"]';
        let node = link;
        let title = node.querySelector(titleSelector);
        let parent = link.parentElement;
        let depth = 0;
        let bestNode = title ? node : null;
        let bestTitle = title;
        while (parent && depth < 12 && parent.querySelectorAll('a[href*="/oferta/praca/"]').length === 1) {
          node = parent;
          title = node.querySelector(titleSelector);
          parent = parent.parentElement;
          depth += 1;
          if (!title) continue;
          bestNode = node;
          bestTitle = title;
          const hasSummaryButton = [...node.querySelectorAll('button')]
            .some((button) => /^(?:Miejsce pracy|Wymiar pracy):/.test(button.innerText.trim()));
          const paragraphCount = node.querySelectorAll('p').length;
          if (paragraphCount >= 2 || hasSummaryButton) break;
        }
        if (!bestNode || !bestTitle) return [];
        node = bestNode;
        title = bestTitle;
        return [{
          href,
          title: title.textContent ?? null,
          text: node.innerText ?? '',
          paragraphs: [...node.querySelectorAll('p')].map((p) => p.textContent ?? ''),
          buttonTexts: [...node.querySelectorAll('button')].map((button) => button.innerText ?? ''),
        }];
      });
    });
    pagesFetched += 1;

    checkPageResponse(page);
    if (!pageCards.length) {
      const blocked = await detectBlocked(page);
      if (blocked) throw new SearchError('blocked', blocked);
      const bodyText = (await page.locator('body').innerText().catch(() => '')).toLowerCase();
      if (isNoResultsText(bodyText)) {
        noResults = true;
        break;
      }
      throw new SearchError('schema_changed', 'OLX results page loaded but no job cards matched the parser.');
    }

    for (const item of pageCards) {
      safeJobUrl(item.href);
      cards.push(parseCardFields({ ...item, position: cards.length + 1 }));
      if (cards.length >= maxCards) break;
    }
    if (cards.length >= maxCards || pagesFetched >= MAX_PAGES) break;

    const next = page.getByRole('link', { name: /następna|next/i }).first();
    if (await next.count() === 0 || !(await next.isVisible().catch(() => false))) break;
    const href = await next.getAttribute('href');
    if (!href) break;
    hasNextPage = true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, PAGE_PAUSE_MS));
    const nextUrl = safeOlxUrl(href, page.url());
    const response = await page.goto(nextUrl.href, {
      waitUntil: 'domcontentloaded',
      timeout: Math.min(NAVIGATION_TIMEOUT_MS, Math.max(1_000, deadline - Date.now())),
    });
    checkResponse(response);
    const resultState = await waitForResults(page);
    if (resultState === 'no_results') {
      noResults = true;
      break;
    }
  }
  return {
    cards,
    pagesFetched,
    noResults,
    truncated: cards.length >= maxCards || (pagesFetched >= MAX_PAGES && hasNextPage),
  };
}

export async function executeSearch(request, { browserType = chromium } = {}) {
  const validated = validateRequest(request);
  const requestedCardCap = validated.result_cap * 2;
  const maxCards = Math.min(requestedCardCap, MAX_CARDS);
  const applied = [];
  const deadline = Date.now() + MAX_RUNTIME_MS;
  const launchOptions = { headless: true };
  if (process.env.ROBOHOBO_CHROMIUM_PATH) launchOptions.executablePath = process.env.ROBOHOBO_CHROMIUM_PATH;
  const browser = await browserType.launch(launchOptions);
  let context;
  try {
    context = await browser.newContext({ locale: 'pl-PL' });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    page.setDefaultTimeout(ACTION_TIMEOUT_MS);
    await page.route('**/*', async (route) => {
      const requestEvent = route.request();
      if (!requestEvent.isNavigationRequest()) return route.continue();
      let target;
      try {
        target = new URL(requestEvent.url());
      } catch {
        return route.abort();
      }
      if (target.protocol !== 'https:' || target.hostname !== 'www.olx.pl') {
        return route.abort();
      }
      return route.continue();
    });

    const response = await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
    checkResponse(response);
    const blocked = await detectBlocked(page);
    if (blocked) throw new SearchError('blocked', blocked);
    const necessaryCookies = page.getByRole('button', { name: 'Akceptuj niezbędne', exact: true });
    if (await necessaryCookies.count()) await necessaryCookies.click({ timeout: ACTION_TIMEOUT_MS });
    const remainingBlockedState = await detectBlocked(page);
    if (remainingBlockedState) throw new SearchError('blocked', remainingBlockedState);

    await applyLocation(page, validated.location, applied);
    await applyFilters(page, validated, applied);
    const searchButton = page.getByRole('button', { name: 'Szukaj', exact: true });
    if (await searchButton.count() !== 1 || !(await searchButton.isVisible().catch(() => false))) {
      throw new SearchError('schema_changed', 'OLX search button is missing or ambiguous; filters were not submitted.');
    }
    await searchButton.click({ timeout: ACTION_TIMEOUT_MS });
    await page.waitForLoadState('domcontentloaded', { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});
    const initialState = await waitForResults(page);
    if (initialState === 'no_results') {
      return {
        status: 'no_results', cards: [], filters_applied: applied,
        diagnostics: { pages_fetched: 0, cards_returned: 0, candidate_cap: maxCards, cap_limited: requestedCardCap > MAX_CARDS, truncated: false, sort_applied: false, untrusted: true },
      };
    }
    await setSortNewest(page, applied);
    const collected = await collectCards(page, maxCards, deadline);
    const sortStatus = applied.find((item) => item.node === 'sort')?.status;
    return {
      status: collected.cards.length ? 'ok' : 'no_results',
      cards: collected.cards,
      filters_applied: applied,
      diagnostics: {
        pages_fetched: collected.pagesFetched,
        cards_returned: collected.cards.length,
        candidate_cap: maxCards,
        cap_limited: requestedCardCap > MAX_CARDS,
        truncated: collected.truncated,
        sort_applied: sortStatus === 'full',
        untrusted: true,
      },
    };
  } finally {
    await context?.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

export { MAX_RUNTIME_MS };

async function readRequest() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > MAX_INPUT_BYTES) throw new SearchError('invalid_request', 'Request exceeds the size limit.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new SearchError('invalid_request', 'Input must be valid JSON.');
  }
}

async function main() {
  try {
    const output = await executeSearch(await readRequest());
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } catch (error) {
    const code = error instanceof SearchError ? error.code : error?.name === 'TimeoutError' ? 'timeout' : 'tool_error';
    process.stdout.write(`${JSON.stringify({ status: code, cards: [], filters_applied: [], diagnostics: { error: compactText(error?.message ?? 'Unknown error'), untrusted: true } })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
