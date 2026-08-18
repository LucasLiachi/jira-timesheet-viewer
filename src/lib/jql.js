import { addDays } from './dates.js';

/**
 * Issues assigned to the current user, active inside [from, to]. Always
 * includes issues with no due date — there is no toggle for this anymore
 * (see plano-jira-timesheet-viewer.md §11): narrowing by status happens as a
 * client-side sub-filter on the fetched list instead, not in this JQL.
 */
export function buildMyItemsJql({ from, to, projectKeys = [] }) {
  const clauses = ['assignee = currentUser()'];

  if (projectKeys.length > 0) {
    const list = projectKeys.map((key) => `"${key}"`).join(', ');
    clauses.push(`project IN (${list})`);
  }

  clauses.push(`((duedate >= "${from}" AND duedate <= "${to}") OR duedate IS EMPTY)`);

  return `${clauses.join(' AND ')} ORDER BY duedate ASC, priority DESC`;
}

/**
 * Issues that have worklogs logged by the current user inside [from, to].
 * Uses worklogAuthor = currentUser() and worklogDate >= from AND worklogDate < nextDay
 * (exclusive upper bound) to cleanly include the full end day.
 */
export function buildWorklogJql({ from, to }) {
  const clauses = ['worklogAuthor = currentUser()'];

  const nextDay = addDays(to, 1);
  clauses.push(`worklogDate >= "${from}" AND worklogDate < "${nextDay}"`);

  return `${clauses.join(' AND ')} ORDER BY updated DESC`;
}

