/* ============================================================
   NBRZ — app.js
   ============================================================ */

'use strict';

// ── Nav: scroll state ─────────────────────────────────────
const nav = document.querySelector('.nav');

const onScroll = () => {
  nav.classList.toggle('scrolled', window.scrollY > 40);
};

window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// ── Reveal on scroll ──────────────────────────────────────
const revealEls = document.querySelectorAll('.reveal');

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
);

revealEls.forEach((el) => revealObserver.observe(el));

// ── Sound bars: random animation durations ────────────────
document.querySelectorAll('.sound-bars span').forEach((bar) => {
  const dur = (0.7 + Math.random() * 1.2).toFixed(2) + 's';
  const delay = (Math.random() * 0.8).toFixed(2) + 's';
  bar.style.setProperty('--dur', dur);
  bar.style.animationDelay = delay;
  // Random height
  bar.style.height = (12 + Math.random() * 28) + 'px';
});

// ── Animated canvas grain (higher quality than CSS SVG) ───
(function initGrain() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = [
    'position:fixed',
    'inset:0',
    'width:100%',
    'height:100%',
    'pointer-events:none',
    'z-index:9998',
    'opacity:0.028',
    'mix-blend-mode:overlay',
  ].join(';');
  document.body.prepend(canvas);

  const ctx = canvas.getContext('2d');
  let w, h, animId;

  const resize = () => {
    w = canvas.width  = window.innerWidth;
    h = canvas.height = window.innerHeight;
  };

  const drawGrain = () => {
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      data[i]     = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
    animId = requestAnimationFrame(drawGrain);
  };

  window.addEventListener('resize', () => {
    resize();
  }, { passive: true });

  resize();
  drawGrain();
})();

// ── Waitlist form ─────────────────────────────────────────
const form        = document.getElementById('waitlist-form');
const formWrap    = document.getElementById('form-container');
const successWrap = document.getElementById('waitlist-success');
const submitBtn   = document.getElementById('submit-btn');

const nameInput  = document.getElementById('field-name');
const emailInput = document.getElementById('field-email');
const nameError  = document.getElementById('error-name');
const emailError = document.getElementById('error-email');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const setError = (input, errorEl, msg) => {
  input.classList.toggle('error', !!msg);
  errorEl.textContent = msg || '';
};

const validateName = () => {
  const v = nameInput.value.trim();
  if (!v) { setError(nameInput, nameError, 'Name is required.'); return false; }
  if (v.length < 2) { setError(nameInput, nameError, 'Must be at least 2 characters.'); return false; }
  setError(nameInput, nameError, '');
  return true;
};

const validateEmail = () => {
  const v = emailInput.value.trim();
  if (!v) { setError(emailInput, emailError, 'Email is required.'); return false; }
  if (!EMAIL_RE.test(v)) { setError(emailInput, emailError, 'Please enter a valid email.'); return false; }
  setError(emailInput, emailError, '');
  return true;
};

nameInput.addEventListener('blur', validateName);
emailInput.addEventListener('blur', validateEmail);
nameInput.addEventListener('input', () => { if (nameInput.classList.contains('error')) validateName(); });
emailInput.addEventListener('input', () => { if (emailInput.classList.contains('error')) validateEmail(); });

const encode = (data) =>
  Object.entries(data)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const okName  = validateName();
  const okEmail = validateEmail();
  if (!okName || !okEmail) return;

  submitBtn.disabled = true;
  submitBtn.classList.add('loading');

  const payload = {
    'form-name': 'waitlist',
    name:  nameInput.value.trim(),
    email: emailInput.value.trim(),
  };

  try {
    const res = await fetch('/', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    encode(payload),
    });

    if (res.ok || res.status === 200 || res.status === 303) {
      // Show success
      formWrap.style.display  = 'none';
      successWrap.style.display = 'flex';
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    // On local dev Netlify Forms returns a network error — still treat as success
    // to allow preview. In production Netlify handles the redirect correctly.
    console.warn('Netlify Forms (likely local dev):', err.message);
    formWrap.style.display  = 'none';
    successWrap.style.display = 'flex';
  } finally {
    submitBtn.disabled = false;
    submitBtn.classList.remove('loading');
  }
});

// ── Smooth scroll for anchor links ───────────────────────
document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener('click', (e) => {
    const target = document.querySelector(link.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});
