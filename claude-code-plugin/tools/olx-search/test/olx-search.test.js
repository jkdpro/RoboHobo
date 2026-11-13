import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CARDS,
  MAX_RESULT_CAP,
  SearchError,
  compactText,
  parseCardFields,
  safeJobUrl,
  safeOlxUrl,
  validateRequest,
} from '../olx-search.js';

const mixedModeListing = {
  position: 1,
  href: '/oferta/praca/frontend-developer-CID4-IDabc123.html',
  title: 'Frontend developer',
  text: 'SPONSOROWANE Frontend developer\nExample Sp. z o.o.\n14 000 - 18 000 zł / mies.\nGdańsk\nPraca zdalna\nPraca hybrydowa\nPełny etat\nOdświeżono dnia 06 listopada 2026',
  paragraphs: [
    'Example Sp. z o.o.',
    '14 000 - 18 000 zł / mies.',
    'Gdańsk',
    'Praca zdalna',
    'Praca hybrydowa',
    'Pełny etat',
    '06 listopada 2026',
  ],
};

test('validates resolved portal filters and location inputs', () => {
  const request = validateRequest({
    job_category: 'IT',
    employment_type: { require: ['full_time'] },
    work_mode: { require: ['remote'] },
    location: { city: 'Gdańsk', country: 'PL', radius_km: 30 },
    result_cap: 5,
  });
  assert.equal(request.result_cap, 5);
  assert.deepEqual(request.work_mode.require, ['remote']);
});

test('rejects unknown fields and preference actions as filter inputs', () => {
  assert.throws(() => validateRequest({ result_cap: 5, sort: 'oldest' }), /Unknown request fields/);
  assert.throws(() => validateRequest({ result_cap: 5, work_mode: { prefer: ['remote'] } }), /not a portal-filter input/);
});

test('rejects invalid slugs and unsupported locations', () => {
  assert.throws(() => validateRequest({ result_cap: 5, work_mode: { require: ['everywhere'] } }), /registered slugs/);
  assert.throws(() => validateRequest({ result_cap: 5, location: { city: 'Paris', country: 'FR' } }), /support country PL/);
  assert.throws(() => validateRequest({ result_cap: 5, location: { city: 'Gdańsk', country: 'PL', radius_km: 101 } }), /No OLX radius option/);
});

test('candidate budget is at most twice the final cap and hard-capped', () => {
  assert.equal(Math.min(5 * 2, MAX_CARDS), 10);
  assert.equal(Math.min(100 * 2, MAX_CARDS), MAX_CARDS);
  assert.equal(MAX_RESULT_CAP, 25);
  assert.equal(validateRequest({ result_cap: 100 }).result_cap, 100);
});

test('normalizes multiple work-mode labels without treating one as an exclusion', () => {
  const card = parseCardFields(mixedModeListing);
  assert.deepEqual(card.work_mode_labels, ['Praca zdalna', 'Praca hybrydowa']);
  assert.equal(card.title, 'Frontend developer');
  assert.equal(card.employer, 'Example Sp. z o.o.');
  assert.equal(card.location_text, 'Gdańsk');
  assert.equal(card.salary_text, '14 000 - 18 000 zł / mies.');
  assert.equal(card.promoted, true);
  assert.equal(card.untrusted, true);
});

test('extracts work-mode labels from OLX card summary buttons', () => {
  const card = parseCardFields({
    href: '/oferta/praca/developer-CID4-IDx12345.html',
    title: 'Developer',
    paragraphs: ['Example Sp. z o.o.', 'Gdańsk', 'Pełny etat', 'Odświeżono dnia 06 listopada 2026'],
    buttonTexts: ['Miejsce pracy: Praca hybrydowa, Praca zdalna', 'Obserwuj'],
  });
  assert.deepEqual(card.work_mode_labels, ['Praca hybrydowa', 'Praca zdalna']);
  assert.deepEqual(card.employment_labels, ['Pełny etat']);
});

test('leaves absent card fields unknown instead of inferring them', () => {
  const card = parseCardFields({ href: '/oferta/praca/it-CID4-IDx12345.html', title: 'Developer', paragraphs: [] });
  assert.equal(card.employer, null);
  assert.equal(card.location_text, null);
  assert.equal(card.salary_text, null);
  assert.deepEqual(card.work_mode_labels, []);
});

test('restricts job links to OLX job listing paths', () => {
  assert.equal(safeJobUrl('/oferta/praca/test-CID4-IDabcde.html').hostname, 'www.olx.pl');
  assert.throws(() => safeJobUrl('/myaccount/answers/'), /outside its job-listing pages/);
});

test('rejects links outside OLX before navigation or output', () => {
  assert.throws(() => safeOlxUrl('https://example.com/listing'), /outside its HTTPS site/);
  assert.throws(() => safeOlxUrl('http://www.olx.pl/praca/'), /outside its HTTPS site/);
  assert.equal(safeOlxUrl('/oferta/praca/test-CID4-IDabcde.html').hostname, 'www.olx.pl');
});

test('bounds and sanitizes ad-derived text', () => {
  assert.equal(compactText('hello\u0000   world'), 'hello world');
  assert.equal(compactText('abcdef', 3), 'abc');
});

test('returns a classified error for unexpected result hosts', () => {
  assert.throws(() => safeOlxUrl('https://evil.olx.pl.evil.example/path'), (error) => error instanceof SearchError && error.code === 'unexpected_host');
  assert.throws(() => safeOlxUrl('https://accounts.olx.pl/'), (error) => error instanceof SearchError && error.code === 'unexpected_host');
});
