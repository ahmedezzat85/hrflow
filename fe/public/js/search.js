let paletteResults = [];
let paletteSelectedIndex = -1;

const commandPaletteSources = [
  {
    id: 'finance_actions',
    title: 'Finance Actions',
    icon: 'fa-solid fa-bolt',
    search(query) {
      const q = (query || '').toLowerCase().trim();
      const actions = [
        {
          id: 'action_record_tx',
          type: 'action',
          name: 'Record Transaction (Global Quick-Add)',
          role: 'Finance Action',
          dept: 'Continuous Ledger',
          status: 'Shift+N',
          keywords: ['transaction', 'add', 'record', 'quick', 'entry', 'ledger', 'expense', 'income', 'money', 'payment'],
          icon: 'fa-solid fa-money-bill-transfer',
          onSelect: () => {
            if (typeof window.openGlobalFinanceTransactionModal === 'function') {
              window.openGlobalFinanceTransactionModal();
            } else if (typeof window.openAddFinanceTransactionModal === 'function') {
              window.openAddFinanceTransactionModal('money_out', true);
            }
          }
        },
        {
          id: 'action_transfer_funds',
          type: 'action',
          name: 'Transfer Funds Between Accounts',
          role: 'Finance Action',
          dept: 'Cash & Banking',
          status: 'Transfer',
          keywords: ['transfer', 'bank', 'funds', 'wire', 'move'],
          icon: 'fa-solid fa-arrow-right-arrow-left',
          onSelect: () => {
            if (typeof window.openRecordFinanceTransferModal === 'function') {
              window.openRecordFinanceTransferModal();
            }
          }
        }
      ];
      if (!q) return actions;
      return actions.filter(a => {
        const matchName = a.name.toLowerCase().includes(q);
        const matchKeyword = a.keywords && a.keywords.some(k => k.toLowerCase().includes(q));
        return matchName || matchKeyword;
      });
    }
  },
  {
    id: 'employees',
    title: 'Employees',
    icon: 'fa-solid fa-users',
    search(query) {
      if (!Array.isArray(employees)) return [];
      const q = (query || '').toLowerCase().trim();
      const list = employees.filter(e => {
        if (!q) return true;
        const name = (e.name || '').toLowerCase();
        const role = (e.role || '').toLowerCase();
        const dept = (e.dept || e.department || '').toLowerCase();
        const email = (e.email || '').toLowerCase();
        return name.includes(q) || role.includes(q) || dept.includes(q) || email.includes(q);
      });
      return list.map(e => ({
        id: e.id,
        type: 'employee',
        name: e.name,
        role: e.role || 'Employee',
        dept: e.dept || e.department || 'Voyance',
        email: e.email || '',
        status: e.status || 'Active',
        onSelect: () => {
          if (currentPortal === 'admin') {
            viewProfile(e.id);
          } else {
            toast(`Viewing employee: ${e.name}`, 'fa-solid fa-user');
          }
        }
      }));
    }
  }
];

function highlightMatch(text, query) {
  if (!query || !text) return text;
  const cleanQ = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!cleanQ) return text;
  const regex = new RegExp(`(${cleanQ})`, 'gi');
  return text.replace(regex, '<mark>$1</mark>');
}

function renderCommandPaletteResults(results, query) {
  const container = document.getElementById('commandPaletteResults');
  if (!container) return;

  paletteResults = results;
  paletteSelectedIndex = results.length > 0 ? 0 : -1;

  if (results.length === 0) {
    if (query && query.trim()) {
      container.innerHTML = `
        <div class="empty-state" style="padding:28px 16px;">
          <i class="fa-solid fa-magnifying-glass" style="font-size:24px;color:var(--text3);margin-bottom:8px;"></i>
          <p style="font-size:13px;color:var(--text2);margin:0;">No employees match "${query}".</p>
        </div>`;
    } else {
      container.innerHTML = `
        <div class="empty-state" style="padding:28px 16px;">
          <i class="fa-solid fa-users" style="font-size:24px;color:var(--text3);margin-bottom:8px;"></i>
          <p style="font-size:13px;color:var(--text2);margin:0;">No employees available to search.</p>
        </div>`;
    }
    return;
  }

  const itemsHtml = results.map((item, idx) => {
    const isAction = item.type === 'action';
    const avatarHtml = isAction
      ? `<div class="palette-item-avatar" style="background:rgba(37,99,235,0.12); color:#2563EB; display:flex; align-items:center; justify-content:center;"><i class="${item.icon || 'fa-solid fa-bolt'}"></i></div>`
      : `<div class="palette-item-avatar">${initials(item.name)}</div>`;
    const statusHtml = isAction
      ? `<span class="badge" style="background:var(--bg3); color:var(--text2); font-size:10px; font-weight:600; padding:2px 6px; border-radius:4px;">${item.status}</span>`
      : statusPill(item.status);
    return `
    <div class="palette-item ${idx === 0 ? 'active' : ''}" data-index="${idx}" onclick="selectPaletteItem(${idx})">
      ${avatarHtml}
      <div class="palette-item-content">
        <div class="palette-item-title">${highlightMatch(item.name, query)}</div>
        <div class="palette-item-sub">${item.role} • ${item.dept}</div>
      </div>
      <div class="palette-item-meta">
        ${statusHtml}
        <i class="fa-solid fa-chevron-right palette-item-arrow"></i>
      </div>
    </div>
  `;
  }).join('');

  const hasOnlyEmployees = results.length > 0 && results.every(r => r.type === 'employee');
  const sectionTitle = hasOnlyEmployees ? `Employees (${results.length})` : `Commands & Records (${results.length})`;

  container.innerHTML = `
    <div class="palette-section-title">${sectionTitle}</div>
    ${itemsHtml}
  `;
}

function updatePaletteSelection(newIndex) {
  const items = document.querySelectorAll('#commandPaletteResults .palette-item');
  if (!items.length) return;
  items.forEach(el => el.classList.remove('active'));
  paletteSelectedIndex = Math.max(0, Math.min(newIndex, items.length - 1));
  const activeEl = items[paletteSelectedIndex];
  if (activeEl) {
    activeEl.classList.add('active');
    activeEl.scrollIntoView({ block: 'nearest' });
  }
}

function selectPaletteItem(index) {
  if (index >= 0 && index < paletteResults.length) {
    const item = paletteResults[index];
    closeCommandPalette();
    if (typeof item.onSelect === 'function') {
      item.onSelect();
    }
  }
}

function executeCommandPaletteSearch(query) {
  const allResults = [];
  for (const src of commandPaletteSources) {
    const res = src.search(query);
    allResults.push(...res);
  }
  renderCommandPaletteResults(allResults, query);
}

function openCommandPalette() {
  const modal = document.getElementById('commandPaletteModal');
  if (!modal) return;
  modal.classList.add('active');
  const input = document.getElementById('commandPaletteInput');
  if (input) {
    input.value = '';
    executeCommandPaletteSearch('');
    setTimeout(() => input.focus(), 50);
  }
}

function closeCommandPalette() {
  const modal = document.getElementById('commandPaletteModal');
  if (!modal) return;
  modal.classList.remove('active');
}

// Global shortcuts: Cmd+K / Ctrl+K, Shift+N, & arrow navigation
window.addEventListener('keydown', (e) => {
  const modal = document.getElementById('commandPaletteModal');
  const isOpen = modal && modal.classList.contains('active');

  // Shift+N shortcut to open global transaction modal when not typing in an input/textarea/select
  if (e.shiftKey && (e.key === 'N' || e.key === 'n') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const tag = (document.activeElement?.tagName || '').toLowerCase();
    const isEditable = document.activeElement?.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select';
    if (!isEditable) {
      e.preventDefault();
      if (typeof window.openGlobalFinanceTransactionModal === 'function') {
        window.openGlobalFinanceTransactionModal();
      } else if (typeof window.openAddFinanceTransactionModal === 'function') {
        window.openAddFinanceTransactionModal('money_out', true);
      }
      return;
    }
  }

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (isOpen) {
      closeCommandPalette();
    } else {
      openCommandPalette();
    }
    return;
  }

  if (!isOpen) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    closeCommandPalette();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    updatePaletteSelection(paletteSelectedIndex + 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    updatePaletteSelection(paletteSelectedIndex - 1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    selectPaletteItem(paletteSelectedIndex >= 0 ? paletteSelectedIndex : 0);
  }
});

window.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('commandPaletteInput');
  if (input) {
    input.addEventListener('input', (e) => {
      executeCommandPaletteSearch(e.target.value);
    });
  }
});
