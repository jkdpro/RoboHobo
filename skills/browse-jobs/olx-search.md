# OLX.pl job search

OLX.pl specifics for the `browse-jobs` skill. Configuration, result format and general guardrails are defined in `SKILL.md`; they apply here too.

## Search workflow

1. Open `https://www.olx.pl/praca/` with the Playwright MCP browser.
2. Use Polish language version of the page.
3. Take an accessibility snapshot before interacting with the page. If a cookie dialog appears, accept only necessary cookies unless the user explicitly asks for another choice.
4. Always fill the following constraints:
- Location and range (If they are not provided by prompt or yaml file - ask)
- `Sortuj` as `Najnowsze`
5. Guidelines if part time or temporary job search is requested.
- fill the constraint named `Wymiar pracy`
  - for part time jobs search mark `Niepełny etat` and `Praca dodatkowa` options,
  - for temporary jobs search mark `Praca sezonowa` and `Praca dodatkowa` options,
  - it may happen that the search will cover both part time and temporary jobs - in such case mark `Niepełny etat`, `Praca dodatkowa`, `Praca sezonowa`
6. Guidelines when search request imply preference on work schedule (not a constraint; e.g.: when search request contains 'preferuj pracę na niepełny etat'):
  - do not populate `Wymiar pracy`
  - use information visible under ad title (`Pełny wymiar`, `Niepełny wymiar`, `Praca dodatkowa`, `Praca sezonowa`) for ranking the ads
7. Do not set other search constraints. Role or industry preferences should be inferred from advertisement title; If title is not clear, please follow the link and analyze advertisement text.
8. Read listing cards from the accessibility snapshot. Use browser evaluation only for read-only extraction when the rendered page makes the data clearer.
9. Collect unique listing URLs. Use pagination only as needed and avoid aggressive repeated requests.
10. For shortlisted ads, open the listing pages only when necessary to obtain details that are not visible in the result card.
11. Identify promoted/sponsored results when the page labels them.

## Browser guardrails

- Use the Playwright MCP browser tools for navigation and interaction: navigate, snapshot, click, type, wait, select, and read-only evaluation as needed.
- Avoid opening more detail pages than needed.
- Close the browser when the search is complete if the MCP session supports it.
