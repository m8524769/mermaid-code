(() => {
  const STORAGE_KEY = 'mc-theme';
  const root = document.documentElement;

  // --------------------------------------------------------------------------
  // 1. Theme Toggle (Drafting Paper <-> Dark Blueprint)
  // --------------------------------------------------------------------------
  const syncThemeButtons = () => {
    const isDark = root.dataset.theme === 'dark';
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(isDark));
      btn.setAttribute(
        'aria-label',
        isDark ? 'Switch to light drafting paper' : 'Switch to dark blueprint'
      );
      btn.setAttribute(
        'title',
        isDark ? 'Switch to light drafting paper' : 'Switch to dark blueprint'
      );
    });
  };

  syncThemeButtons();
  document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      root.classList.add('theme-switching');
      const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      if (next === 'dark') {
        root.dataset.theme = 'dark';
      } else {
        delete root.dataset.theme;
      }
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {}
      syncThemeButtons();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          root.classList.remove('theme-switching');
        });
      });
    });
  });

  // --------------------------------------------------------------------------
  // 2. Mobile Navigation Drawer
  // --------------------------------------------------------------------------
  const menuBtn = document.querySelector('[data-menu-toggle]');
  const drawer = document.querySelector('[data-mobile-drawer]');
  if (menuBtn && drawer) {
    menuBtn.addEventListener('click', () => {
      const open = drawer.classList.toggle('is-open');
      menuBtn.setAttribute('aria-expanded', String(open));
    });
    drawer.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        drawer.classList.remove('is-open');
        menuBtn.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // --------------------------------------------------------------------------
  // 3. Generic Tabs ([data-tabs])
  // --------------------------------------------------------------------------
  document.querySelectorAll('[data-tabs]').forEach((group) => {
    const buttons = group.querySelectorAll('[data-tab-target]');
    const panels = group.querySelectorAll('[data-tab-panel]');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-tab-target');
        buttons.forEach((b) => {
          const active = b === btn;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-selected', String(active));
        });
        panels.forEach((p) => {
          p.classList.toggle('is-active', p.getAttribute('data-tab-panel') === target);
        });
      });
    });
  });

  // --------------------------------------------------------------------------
  // 4. Click-to-Copy ([data-copy])
  // --------------------------------------------------------------------------
  const copyText = async (text) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  };

  document.querySelectorAll('[data-copy]').forEach((btn) => {
    let timer = null;
    const labelEl = btn.querySelector('[data-copy-label]');
    const original = labelEl ? labelEl.textContent : btn.textContent;
    btn.addEventListener('click', async () => {
      const text = btn.getAttribute('data-copy');
      if (!text) return;
      try {
        await copyText(text);
        btn.classList.add('is-copied');
        if (labelEl) labelEl.textContent = 'Copied';
        else btn.textContent = 'Copied';
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          btn.classList.remove('is-copied');
          if (labelEl) labelEl.textContent = original;
          else btn.textContent = original;
        }, 1700);
      } catch {}
    });
  });

  // --------------------------------------------------------------------------
  // 5. Hero Desktop App Spotlight Controls (#hero-showcase)
  // --------------------------------------------------------------------------
  const heroShowcase = document.getElementById('hero-showcase');
  if (heroShowcase) {
    const focusBtns = heroShowcase.querySelectorAll('[data-focus-target]');
    const showcaseVp = document.getElementById('showcase-viewport');
    const stageNote = document.getElementById('hero-stage-note');
    focusBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-focus-target') || 'full';
        const note = btn.getAttribute('data-focus-note') || '';
        focusBtns.forEach((b) => {
          const active = b === btn;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-selected', String(active));
        });
        if (showcaseVp) showcaseVp.setAttribute('data-focus', target);
        if (stageNote && note) stageNote.textContent = note;
      });
    });
  }

  // --------------------------------------------------------------------------
  // 6. Desktop OS Auto-Detection (Homepage CTA + Download Page)
  // --------------------------------------------------------------------------
  const detectDesktopOS = () => {
    const ua = navigator.userAgent || '';
    const plat = navigator.platform || '';
    if (/Android|iPhone|iPad|iPod/.test(ua)) return null;
    if (/Mac/.test(plat) || /Mac OS X/.test(ua)) return 'macos';
    if (/Win/.test(plat) || /Windows/.test(ua)) return 'windows';
    return null;
  };

  const os = detectDesktopOS();
  const heroDlLabel = document.getElementById('hero-dl-label');
  if (heroDlLabel && os) {
    heroDlLabel.textContent = os === 'macos' ? 'Download for macOS' : 'Download for Windows';
  }

  const rec = document.getElementById('recommend');
  if (rec && os) {
    const selector =
      os === 'macos'
        ? '.dl-card[data-os="macos"][data-arch="aarch64"]'
        : `.dl-card[data-os="${os}"]`;
    const card = document.querySelector(selector);
    if (card) {
      card.classList.add('is-recommended');
      document.querySelectorAll('.dl-grid .dl-card').forEach((other) => {
        if (other === card) return;
        const btn = other.querySelector('.btn-coral');
        if (btn) {
          btn.classList.remove('btn-coral');
          btn.classList.add('btn-outline');
        }
      });

      const link = card.querySelector('.btn-coral');
      const recBtn = document.getElementById('rec-btn');
      const recAlt = document.getElementById('rec-alt');
      if (link && recBtn && recAlt) {
        const labels = { macos: 'Download for macOS', windows: 'Download for Windows' };
        const alts = {
          macos: 'Using an Intel Mac, or on Windows? See all packages below.',
          windows: 'On macOS? See all packages below.'
        };
        recBtn.setAttribute('href', link.getAttribute('href') || '#downloads');
        recBtn.textContent = labels[os];
        recAlt.innerHTML = `<a href="#downloads">${alts[os]}</a>`;
        rec.hidden = false;
      }
    }
  }
})();
