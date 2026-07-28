(() => {
  const isPreview = !chrome.runtime || chrome.runtime.id === 'mock-extension-id';

  const REMOVE_LABELS = ['comments', 'components'];

  const patchHistoryTemplates = () => {
    if (typeof spTemplateChatHistory === 'function') {
      window.spTemplateChatHistory = function() { return ''; };
    }
    if (typeof spTemplateTabs === 'function') {
      const _origTabs = spTemplateTabs;
      window.spTemplateTabs = function() {
        const html = _origTabs.apply(this, arguments);
        const div = document.createElement('div');
        div.innerHTML = html;
        div.querySelectorAll('[data-tab], button, li, a').forEach(el => {
          const tab = (el.getAttribute('data-tab') || '').toLowerCase();
          const txt = el.textContent.trim().toLowerCase();
          if (tab.includes('history') || txt === 'history') el.remove();
        });
        return div.innerHTML;
      };
    }
  };

  const shouldRemoveEl = (el) => {
    const txt = el.textContent.trim().toLowerCase();
    const dataKey = (el.getAttribute('data-key') || el.getAttribute('data-prompt') ||
                     el.getAttribute('data-action') || el.getAttribute('data-shortcut') || '').toLowerCase();
    return REMOVE_LABELS.some(label =>
      txt === label ||
      txt.endsWith(label) ||
      dataKey === label ||
      dataKey.includes(label)
    );
  };

  const removeUnwanted = () => {
    document.querySelectorAll('[data-tab]').forEach(el => {
      if ((el.getAttribute('data-tab') || '').toLowerCase().includes('history')) el.remove();
    });
    document.querySelectorAll('.sp-tab-btn, .tab-btn, [role="tab"]').forEach(el => {
      if (el.textContent.trim().toLowerCase() === 'history') el.remove();
    });
    document.querySelectorAll('[class*="history"], [id*="history"]').forEach(el => {
      if (/\bhistory\b/.test((el.className || '').toLowerCase()) ||
          /\bhistory\b/.test((el.id || '').toLowerCase())) {
        el.style.display = 'none';
      }
    });

    document.querySelectorAll('button, [role="button"], .sp-shortcut-btn, .ql-shortcut, .shortcut-btn, [class*="shortcut"]').forEach(el => {
      if (shouldRemoveEl(el)) el.remove();
    });

    document.querySelectorAll('li, div, span').forEach(el => {
      const directText = Array.from(el.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE || n.tagName === 'SPAN')
        .map(n => n.textContent.trim().toLowerCase())
        .join('');
      if (REMOVE_LABELS.includes(directText)) {
        const btn = el.closest('button') || el.closest('[role="button"]') || el;
        btn.remove();
      }
    });
  };

  const autoBypassLicense = () => {
    if (!isPreview) return;
    const input = document.querySelector('input[type="text"]');
    const btn = document.querySelector('button');
    if (input && btn && btn.textContent.toLowerCase().includes('validat')) {
      input.value = 'TSG1-2026-FAIR-TECH';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      setTimeout(() => btn.click(), 200);
    }
  };

  patchHistoryTemplates();

  let debounce;
  const observer = new MutationObserver(() => {
    patchHistoryTemplates();
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      removeUnwanted();
      autoBypassLicense();
    }, 60);
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('DOMContentLoaded', () => {
    patchHistoryTemplates();
    removeUnwanted();
    setTimeout(autoBypassLicense, 500);
  });
})();
