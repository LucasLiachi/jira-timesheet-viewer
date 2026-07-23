// Pure view: a button that toggles a small checklist popover below it — a
// "Select all" row plus one checkbox per option. All state (open/closed,
// which values are selected, the option list itself) lives in panel.js;
// this module only draws the current state and reports clicks, same
// division of labour as calendar.js.

export function renderMultiSelect(
  container,
  { label, options, selected, open, onToggleOpen, onToggleValue, onToggleAll, emptyLabel = 'Nothing to select.' }
) {
  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'multi-select';

  const allSelected = options.length > 0 && selected.size === options.length;
  const noneSelected = selected.size === 0;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'multi-select-button';
  button.textContent =
    options.length === 0 || allSelected ? label : noneSelected ? `${label} (none)` : `${label} (${selected.size})`;
  button.addEventListener('click', onToggleOpen);
  wrap.appendChild(button);

  if (open) {
    const panel = document.createElement('div');
    panel.className = 'multi-select-panel';

    if (options.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'multi-select-empty';
      empty.textContent = emptyLabel;
      panel.appendChild(empty);
    } else {
      const allRow = document.createElement('label');
      allRow.className = 'multi-select-option multi-select-all';
      const allCheckbox = document.createElement('input');
      allCheckbox.type = 'checkbox';
      allCheckbox.checked = allSelected;
      allCheckbox.indeterminate = !allSelected && !noneSelected;
      allCheckbox.addEventListener('change', () => onToggleAll(!allSelected));
      allRow.appendChild(allCheckbox);
      allRow.appendChild(document.createTextNode('Select all'));
      panel.appendChild(allRow);

      for (const option of options) {
        const row = document.createElement('label');
        row.className = 'multi-select-option';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = selected.has(option.value);
        checkbox.addEventListener('change', () => onToggleValue(option.value));
        row.appendChild(checkbox);
        row.appendChild(document.createTextNode(option.label));
        panel.appendChild(row);
      }
    }

    wrap.appendChild(panel);
  }

  container.appendChild(wrap);
}
