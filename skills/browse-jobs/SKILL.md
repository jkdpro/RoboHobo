---
name: browse-jobs
description: Search and browse job advertisements from supported sources, including OLX.pl, summarize them, and compare them against the user's preferences. Use when the user asks to find, review, or shortlist job postings.
---

# Browse jobs

## Configuration

- The plugin's `user_dir` is available as `${user_config.user_dir}` and defaults to `~/robohobo`.
- When using a predefined search or saved preferences, read `${user_config.user_dir}/searches.yaml` and `${user_config.user_dir}/location.yaml` first.
- Use explicit criteria from the current request instead of saved values when they conflict.
- If a personal file is missing or unavailable, use the user's stated criteria and ask only for preferences that are necessary to resolve ambiguity. Do not invent values.

## Source-specific instructions

- In `searches.yaml`, use the source slug `olx` for OLX.pl.
- When the requested source is OLX.pl, read `olx-search.md` from this skill directory before browsing.

1. Ask for (or recall) the user's role, location, seniority and other preferences.
2. Search the web for matching job advertisements.
3. Summarize each result: title, company, location, salary (if listed), key requirements, link.
4. Rank or shortlist against the user's preferences and note any red flags.
