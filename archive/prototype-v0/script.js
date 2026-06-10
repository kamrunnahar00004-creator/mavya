/* ============================================================
   Mavya Desktop Demo - State Switcher
   Hidden developer route for hardcoded states.
   No live API. No upload pipeline. No tracking.
   ============================================================ */

(function () {
  'use strict';

  const STATES = ['upload', 'analyzing', 'weak', 'strong', 'invalid'];
  const REVEAL_STATES = new Set(['weak', 'strong']);

  function setState(state) {
    if (!STATES.includes(state)) return;
    document.body.dataset.state = state;
    if (REVEAL_STATES.has(state)) {
      runReveal(state);
    } else {
      document.body.removeAttribute('data-reveal-state');
    }
  }

  function runReveal(state) {
    document.body.dataset.revealState = 'animating';
    // Reset score number to 0 for count-up
    const screen = document.querySelector(`[data-screen="${state}"]`);
    if (!screen) return;
    const scoreEl = screen.querySelector('.score-number');
    if (scoreEl) {
      scoreEl.textContent = '0.0';
    }

    requestAnimationFrame(() => {
      document.body.dataset.revealState = 'done';
      if (scoreEl) {
        animateScore(scoreEl);
      }
    });
  }

  function animateScore(el) {
    const target = parseFloat(el.dataset.target || '0');
    const duration = prefersReducedMotion() ? 0 : 600;
    const start = performance.now();

    if (duration === 0) {
      el.textContent = target.toFixed(1);
      return;
    }

    function step(now) {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      // ease-out
      const eased = 1 - Math.pow(1 - t, 3);
      const value = target * eased;
      el.textContent = value.toFixed(1);
      if (t < 1) requestAnimationFrame(step);
      else el.textContent = target.toFixed(1);
    }

    requestAnimationFrame(step);
  }

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // Keyboard route: 1/2/3/4 switches state
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    const map = { '1': 'upload', '2': 'weak', '3': 'strong', '4': 'invalid' };
    if (map[e.key]) {
      e.preventDefault();
      setState(map[e.key]);
    }
  });

  // Upload button: trigger fake analyze then go to weak state (default demo flow)
  document.addEventListener('DOMContentLoaded', () => {
    const uploadBtn = document.getElementById('upload-btn');
    const uploadInput = document.getElementById('upload-input');
    const dropzone = document.querySelector('.dropzone');

    if (uploadBtn && uploadInput) {
      uploadBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadInput.click();
      });
    }

    if (uploadInput) {
      uploadInput.addEventListener('change', () => {
        const file = uploadInput.files && uploadInput.files[0];
        if (file) loadUploadedPhoto(file);
      });
    }

    if (dropzone && uploadInput) {
      dropzone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          uploadInput.click();
        }
      });
      dropzone.addEventListener('click', (e) => {
        if (e.target !== uploadBtn) uploadInput.click();
      });
      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('is-dragging');
      });
      dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('is-dragging');
      });
      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('is-dragging');
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) loadUploadedPhoto(file);
      });
    }

    // New audit button
    const newAuditBtn = document.querySelector('.new-audit');
    if (newAuditBtn) {
      newAuditBtn.addEventListener('click', () => setState('upload'));
    }

    // Strong CTA: score another photo
    const strongCta = document.getElementById('strong-cta');
    if (strongCta) {
      strongCta.addEventListener('click', () => setState('upload'));
    }

    // Invalid CTA: try another upload
    const invalidCta = document.getElementById('invalid-cta');
    if (invalidCta) {
      invalidCta.addEventListener('click', () => setState('upload'));
    }

    // Swap in real assets when present
    swapRealAssets();

    // Weak CTA visibility: only show when prepared after-image asset is present
    // Demo default: hidden until founder drops candle-02-improved.png
    checkImprovementAsset();

    wireComparisonToggle();

    // Invisible demo route used for review captures, e.g. ?state=weak.
    const params = new URLSearchParams(window.location.search);
    const requestedState = params.get('state');
    if (STATES.includes(requestedState)) {
      if (params.get('static') === '1' && REVEAL_STATES.has(requestedState)) {
        document.body.dataset.state = requestedState;
        document.body.dataset.revealState = 'done';
        const score = document.querySelector(`[data-screen="${requestedState}"] .score-number`);
        if (score) score.textContent = parseFloat(score.dataset.target).toFixed(1);
      } else {
        setState(requestedState);
      }
    }
  });

  function loadUploadedPhoto(file) {
    const photoUrl = URL.createObjectURL(file);
    const analyzingImage = document.getElementById('analyzing-image');
    if (analyzingImage) analyzingImage.src = photoUrl;

    const original = document.querySelector('.weak-original');
    const thumbnail = document.querySelector('.weak-thumbnail');
    if (original) showPhotoInSlot(original, photoUrl);
    if (thumbnail) showPhotoInSlot(thumbnail, photoUrl);

    setState('analyzing');
    window.setTimeout(() => setState('weak'), prefersReducedMotion() ? 100 : 500);
  }

  function showPhotoInSlot(img, src) {
    img.src = src;
    img.hidden = false;
    const placeholder = img.parentElement.querySelector('.media-placeholder');
    if (placeholder) placeholder.style.display = 'none';
  }

  function swapRealAssets() {
    document.querySelectorAll('img.real-asset[data-src]').forEach((img) => {
      const src = img.dataset.src;
      const probe = new Image();
      probe.onload = () => {
        showPhotoInSlot(img, src);
      };
      probe.onerror = () => {
        // Asset missing: keep placeholder visible, leave img hidden
      };
      probe.src = src;
    });
  }

  function checkImprovementAsset() {
    // Probe whether candle-02-improved.png exists. If yes, show CTA + comparison.
    const probe = new Image();
    probe.onload = () => {
      const cta = document.getElementById('weak-cta');
      const comparison = document.getElementById('weak-comparison');
      const preview = document.querySelector('.weak-preview');
      if (preview) preview.src = 'assets/candle-02-improved.png';
      if (cta) cta.hidden = false;
      if (comparison) comparison.hidden = false;
    };
    probe.onerror = () => {
      // Asset missing: CTA and comparison stay hidden (per outline spec)
    };
    probe.src = 'assets/candle-02-improved.png';
  }

  function wireComparisonToggle() {
    const control = document.getElementById('weak-comparison');
    const original = document.querySelector('.weak-original');
    const preview = document.querySelector('.weak-preview');
    const cta = document.getElementById('weak-cta');
    if (!control || !original || !preview) return;

    function selectView(view) {
      const showPreview = view === 'preview';
      original.hidden = showPreview;
      preview.hidden = !showPreview;
      control.querySelectorAll('.toggle-btn').forEach((button) => {
        button.classList.toggle('is-active', button.dataset.tab === view);
        button.setAttribute('aria-pressed', String(button.dataset.tab === view));
      });
    }

    control.querySelectorAll('.toggle-btn').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.tab === 'original'));
      button.addEventListener('click', () => selectView(button.dataset.tab));
    });
    if (cta) cta.addEventListener('click', () => selectView('preview'));
  }

  // Expose state setter for console/dev debugging
  window.__listingLensSetState = setState;
})();
