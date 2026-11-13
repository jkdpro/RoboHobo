# OLX search helper

Local Node.js Playwright helper invoked by `skills/browse-jobs/olx-search.md`. Requires Node.js 20 or newer.

Install the pinned dependencies once from this directory:

```sh
npm ci
```

Run tests offline:

```sh
npm test
```

The script accepts one resolved OLX request as JSON on stdin and writes one JSON response to stdout. It performs no configuration loading or result eligibility/ranking. It does not open listing-detail pages. `ROBOHOBO_CHROMIUM_PATH` can point to a compatible installed Chromium; otherwise Playwright's managed Chromium is used.

Use live searches only after verifying the retrieval method is permitted. The script stops on access blocks, CAPTCHA/human verification, login walls, unexpected page structure, and timeouts. It does not attempt to bypass them.
