# Notes for certification (Edge Partner Center)

Paste as-is into "Notes for certification" on the Submit page — 1643 characters, under the 2000 limit. Not shown to customers; only to the review team.

```
Jira Timesheet Viewer is a read-only companion to Jira Cloud: given a date range, it lists issues assigned to the signed-in user, grouped by the day time was logged on them (worklogs). It never creates, edits, or deletes anything in Jira.

No test account is provided because the extension has no backend of its own — it's designed to connect directly to any Jira Cloud site the tester configures, so there is nothing for us to host or provision.

To test:
1. If you don't already have a Jira Cloud site, create a free one at atlassian.com/software/jira/free (no credit card, ~2 minutes).
2. Generate an API token at id.atlassian.com -> Security -> API tokens -> Create API token.
3. Click the extension's toolbar icon. Enter the Jira site URL (e.g. https://your-domain.atlassian.net), the Atlassian account email, and the API token, then click Connect.
4. Click "Open My Items" to open the side panel, then click a start day and an end day on the calendar to pick a date range.
5. The list groups issues by day logged. On a brand-new site with no data yet, every day will correctly show "No worklogs", with a "Not logged in this period" section at the end -- that is expected behavior, not an error. To see a populated day, log a small amount of time on any issue in Jira itself (outside the extension) for a date inside the chosen range, then reopen the panel.
6. Clicking an issue opens /browse/ISSUE-KEY on the configured site.

Credentials are kept only in chrome.storage.session (in-memory), never written to disk, and never sent anywhere except the Jira site entered. Privacy policy: https://lucasliachi.github.io/jira-timesheet-viewer/
```

## Why no test account

The extension has no backend and is BYO-Jira by design (see CLAUDE.md non-negotiables) — there's no shared instance to provision credentials for. Reviewers get a free-trial path instead, which is the standard approach for Jira/Atlassian-integration extensions.
