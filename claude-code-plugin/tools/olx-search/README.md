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

The script accepts one resolved OLX request as JSON on stdin by default, or from a file with `--input <file>`, and writes one JSON response to stdout. Both input modes enforce the same 64 KiB size limit. It performs no configuration loading or result eligibility/ranking. It does not open listing-detail pages. `ROBOHOBO_CHROMIUM_PATH` can point to a compatible installed Chromium; otherwise Playwright's managed Chromium is used.

Example file input (still performs a live OLX search):

```sh
node olx-search.js --input request.json
```

For VS Code debugging, add the arguments to the launch configuration's `args` property, for example:

```json
"args": ["--input", "${workspaceFolder}/request.json"]
```

Use live searches only after verifying the retrieval method is permitted. The script stops on access blocks, CAPTCHA/human verification, login walls, unexpected page structure, and timeouts. It does not attempt to bypass them.
