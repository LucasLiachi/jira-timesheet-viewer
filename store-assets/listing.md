# Store listing copy

Reusable for both the Chrome Web Store and Microsoft Edge Add-ons — the fields
line up closely enough that this one file covers both dashboards.

## Name

Jira Timesheet Viewer

## Category

Productivity

## Support email

lucasliachi@gmail.com

## Privacy policy URL

https://lucasliachi.github.io/jira-timesheet-viewer/

(Live once GitHub Pages is enabled for this repo — see README/CLAUDE.md.)

## Short description (132 characters max — fits Chrome's summary and Edge's short description)

See what Jira issues you logged time on, by day, for any date range — read-only, opens Jira itself to log work.

_(112 characters)_

## Detailed description

Jira Timesheet Viewer answers one question fast: "what did I log in Jira this week, and what's still missing?"

Pick a date range and it shows every issue assigned to you, grouped by the day you logged work on it — hours, and the worklog description when there is one. Days with nothing logged show up too, instead of silently disappearing, and a final section lists everything assigned to you in the period that has no worklog at all.

**Search, don't create.** This extension only reads worklogs — it never creates, edits, or deletes anything in Jira. Click any issue and it opens the normal Jira page (`/browse/ISSUE-KEY`), where you log time exactly as you always have.

**Narrow it down.** Below the calendar: filter by project (narrows the actual search), by status, and by issue key or summary — each filter layers on top of the last without re-querying Jira.

**Read-only summary for sharing.** Once you're happy with the filters, "Open summary in new tab" opens a clean, read-only page with the same day-by-day grouping — just the days and issues that actually have time logged — ready to copy, review, or print.

**Privacy first.** Your Jira URL, email, and API token are entered directly into the extension and kept only in the browser's in-memory session storage — never written to disk, and cleared the moment you close the browser (or click Disconnect). There is no backend server: the extension talks directly, over HTTPS, from your browser to the Jira site you configure. Full details in the privacy policy linked on this listing.

Works with Jira Cloud sites (`*.atlassian.net`). You'll need a Jira API token, which you generate yourself at id.atlassian.com under Security → API tokens.

## Notes for whoever fills the forms

- Chrome Web Store "Privacy practices" tab will ask for a justification per permission — see CLAUDE.md, "Responsabilidades para publicar na Chrome Web Store", for the exact wording already agreed for `storage`, `sidePanel`, and the `host_permissions` entry.
- Edge's Partner Center asks the same privacy-policy URL and support email in its own "Properties" tab; no separate copy needed.
- Screenshots live in `store-assets/screenshots/` — `01-welcome-and-setup.png` is the primary 1280×800 image (shows the value proposition and setup steps). `02` and `03` are supporting shots of the actual UI (light/dark) but only show the empty "not connected" state, since they were captured without a real Jira connection. Swap in a real screenshot of the day-grouped list (with your own data, ideally with issue keys/summaries you're fine making public) as the hero image once you have one — it shows the actual payoff feature better than the setup screen does.
