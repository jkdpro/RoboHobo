# OLX.pl job search

OLX.pl specifics for the `browse-jobs` skill. Configuration, result format and general guardrails are defined in `SKILL.md`; they apply here too.

## Search workflow

1. Open `https://www.olx.pl/praca/` with the Playwright MCP browser.
2. Take an accessibility snapshot before interacting with the page. If a cookie dialog appears, accept only necessary cookies unless the user explicitly asks for another choice.
3. Apply the user's keywords, location, category, and other requested filters through visible page controls. Prefer a verified location URL such as `https://www.olx.pl/praca/<city>/` when it matches the request; otherwise use the filter UI. Do not guess undocumented URL parameters.
4. Read listing cards from the accessibility snapshot. Use browser evaluation only for read-only extraction when the rendered page makes the data clearer.
5. Collect unique listing URLs. Use pagination only as needed and avoid aggressive repeated requests.
6. For shortlisted ads, open the listing pages only when necessary to obtain details that are not visible in the result card.
7. Identify promoted/sponsored results when the page labels them.

## Browser guardrails

- Use the Playwright MCP browser tools for navigation and interaction: navigate, snapshot, click, type, wait, select, and read-only evaluation as needed.
- Avoid opening more detail pages than needed.
- Close the browser when the search is complete if the MCP session supports it.
