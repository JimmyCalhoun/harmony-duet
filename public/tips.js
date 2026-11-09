const tips = [
  {
    id: 'microphone', title: 'Headphones + live feedback', anchor: '#mic', protect: ['.monitoring'],
    text: "Put on headphones so accompaniment doesn't leak into recordings. Enable microphone and allow access for live pitch feedback. Live monitoring is off by default; opt in to Hear myself only with headphones. My live voice changes monitoring, not recordings. Audio stays in your browser. You can continue without microphone permission."
  },
  {
    id: 'line', title: 'Choose your line', anchor: '.parts', protect: ['.score', '.assistance'],
    text: 'Select Melody or Harmony and follow that row of notes. Hear my part clearly makes your selected line easier to hear.'
  },
  {
    id: 'pitch', title: 'Track your pitch', anchor: '.target-grid', protect: ['#pitch-history'],
    text: 'Press Practice and compare your voice with Your target and the pitch trace. Stay with your selected line as the other part moves. Enable the microphone when you want live feedback.'
  },
  {
    id: 'record', title: 'Record both parts', anchor: '#record', protect: ['.parts'],
    text: 'Record one part, switch lines, then record the other while your first take plays. Keep the same exercise settings so your takes match.'
  },
  {
    id: 'duet', title: 'Play your duet', anchor: '#play-duet',
    text: 'Both recordings match your exercise. Press Play both takes to hear your duet together.'
  }
];
const key = id => `harmony-duet.tips.v1.${id}`;

export function createTipProgress(storage, onError) {
  const dismissed = new Set();
  const persist = action => {
    try { action(storage()); }
    catch (error) { onError(error); }
  };
  for (const { id } of tips) {
    persist(store => { if (store.getItem(key(id)) === 'dismissed') dismissed.add(id); });
  }
  return {
    current(duetAvailable) {
      const tip = tips.find(tip => !dismissed.has(tip.id));
      return tip && (tip.id !== 'duet' || duetAvailable) ? tip : null;
    },
    dismiss(id) {
      if (!tips.some(tip => tip.id === id)) throw new Error(`Unknown teaching tip: ${id}`);
      dismissed.add(id);
      persist(store => store.setItem(key(id), 'dismissed'));
    },
    skip() {
      for (const { id } of tips) this.dismiss(id);
    },
    reset() {
      dismissed.clear();
      for (const { id } of tips) persist(store => store.removeItem(key(id)));
    }
  };
}

export function initTeachingTips(duetAvailable) {
  const status = document.getElementById('tips-status');
  const progress = createTipProgress(() => window.localStorage, error => {
    status.textContent = `Tip preferences could not be saved or read: ${error.message}. Changes apply for this visit only; tips may return after reload.`;
  });
  const bubble = document.createElement('aside');
  bubble.className = 'teaching-bubble';
  bubble.setAttribute('role', 'dialog');
  bubble.setAttribute('aria-modal', 'false');
  bubble.setAttribute('aria-labelledby', 'teaching-title');
  bubble.setAttribute('aria-describedby', 'teaching-text');
  const heading = document.createElement('h3');
  heading.id = 'teaching-title';
  const text = document.createElement('p');
  text.id = 'teaching-text';
  const actions = document.createElement('div');
  actions.className = 'teaching-actions';
  const dismiss = document.createElement('button');
  dismiss.className = 'teaching-dismiss';
  dismiss.textContent = '×';
  dismiss.setAttribute('aria-label', 'Dismiss this tip');
  const next = document.createElement('button');
  next.setAttribute('aria-describedby', 'teaching-text');
  const skip = document.createElement('button');
  skip.className = 'text-button';
  skip.textContent = 'Skip tour';
  actions.append(next, skip);
  const content = document.createElement('div');
  content.className = 'teaching-content';
  content.append(dismiss, heading, text, actions);
  bubble.append(content);
  let shown = null;
  let anchor = null;
  let initial = true;
  let frame = null;

  function position() {
    if (!shown || !anchor) return;
    const viewport = window.visualViewport;
    const bounds = {
      left: (viewport?.offsetLeft || 0) + 12,
      top: (viewport?.offsetTop || 0) + 12,
      right: (viewport?.offsetLeft || 0) + (viewport?.width || innerWidth) - 12,
      bottom: (viewport?.offsetTop || 0) + (viewport?.height || innerHeight) - 12
    };
    const target = anchor.getBoundingClientRect();
    bubble.hidden = target.bottom <= bounds.top || target.top >= bounds.bottom ||
      target.right <= bounds.left || target.left >= bounds.right;
    if (bubble.hidden) return;
    const tip = tips.find(tip => tip.id === shown);
    const protectedRects = [...document.querySelectorAll(
      [tip.anchor, ...(tip.protect || []), 'button', 'audio',
        ...(tip.id === 'microphone' ? ['input', 'select'] : [])].join(',')
    )].filter(element => !bubble.contains(element)).map(element => element.getBoundingClientRect())
      .filter(rect => rect.width && rect.height);
    bubble.style.width = `${Math.min(360, bounds.right - bounds.left)}px`;
    bubble.style.maxHeight = `${bounds.bottom - bounds.top}px`;
    bubble.style.setProperty('--content-height', `${bounds.bottom - bounds.top - 4}px`);
    const width = bubble.offsetWidth;
    const fullHeight = bubble.offsetHeight;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    for (const height of [...new Set([fullHeight, Math.min(fullHeight, 180), Math.min(fullHeight, 100)])]) {
      const centerX = clamp((target.left + target.right - width) / 2, bounds.left, bounds.right - width);
      const centerY = clamp((target.top + target.bottom - height) / 2, bounds.top, bounds.bottom - height);
      const candidates = [
        { left: target.right + 14, top: centerY },
        { left: target.left - width - 14, top: centerY },
        { left: centerX, top: target.bottom + 14 },
        { left: centerX, top: target.top - height - 14 },
        { left: bounds.left, top: bounds.top },
        { left: bounds.right - width, top: bounds.top },
        { left: bounds.left, top: bounds.bottom - height },
        { left: bounds.right - width, top: bounds.bottom - height },
        ...protectedRects.flatMap(rect => [
          { left: centerX, top: rect.bottom + 8 },
          { left: centerX, top: rect.top - height - 8 }
        ]).sort((a, b) => Math.abs(a.top - target.top) - Math.abs(b.top - target.top))
      ];
      const placement = candidates.find(({ left, top }) =>
        left >= bounds.left && top >= bounds.top && left + width <= bounds.right && top + height <= bounds.bottom &&
        !protectedRects.some(rect => left < rect.right + 8 && left + width > rect.left - 8 &&
          top < rect.bottom + 8 && top + height > rect.top - 8));
      if (!placement) continue;
      bubble.style.maxHeight = `${height}px`;
      bubble.style.setProperty('--content-height', `${height - 4}px`);
      bubble.style.left = `${placement.left}px`;
      bubble.style.top = `${placement.top}px`;
      const side = placement.left >= target.right ? 'right' : placement.left + width <= target.left ? 'left'
        : placement.top >= target.bottom ? 'below' : 'above';
      bubble.dataset.side = side;
      bubble.style.setProperty('--pointer-x', `${clamp((target.left + target.right) / 2 - placement.left, 22, width - 22)}px`);
      bubble.style.setProperty('--pointer-y', `${clamp((target.top + target.bottom) / 2 - placement.top, 22, height - 22)}px`);
      return;
    }
    // On cramped viewports, leave the controls usable until scrolling creates room.
    bubble.hidden = true;
  }
  function schedulePosition() {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => { frame = null; position(); });
  }
  window.addEventListener('scroll', schedulePosition, { passive: true });
  window.addEventListener('resize', schedulePosition);
  window.visualViewport?.addEventListener('scroll', schedulePosition, { passive: true });
  window.visualViewport?.addEventListener('resize', schedulePosition);
  const observer = new ResizeObserver(schedulePosition);
  observer.observe(bubble);

  function refresh(moveFocus = false) {
    const tip = progress.current(duetAvailable());
    if (tip?.id === shown && bubble.isConnected) {
      schedulePosition();
      return;
    }
    const hadFocus = bubble.contains(document.activeElement);
    bubble.remove();
    anchor?.classList.remove('teaching-target');
    shown = tip?.id || null;
    if (tip) {
      bubble.dataset.tip = tip.id;
      heading.textContent = `${tips.indexOf(tip) + 1} of ${tips.length} · ${tip.title}`;
      text.textContent = tip.text;
      next.textContent = tip.id === 'duet' ? 'Got it' : 'Next tip';
      anchor = document.querySelector(tip.anchor);
      anchor.classList.add('teaching-target');
      document.body.append(bubble);
      if (moveFocus || initial) anchor.scrollIntoView({ block: tip.id === 'microphone' ? 'start' : 'center', behavior: 'instant' });
      position();
      if ((moveFocus || hadFocus) && !bubble.hidden) next.focus({ preventScroll: true });
    } else if (moveFocus || hadFocus) {
      document.getElementById('show-tips').focus();
    }
    initial = false;
  }
  next.onclick = () => {
    progress.dismiss(shown);
    refresh(true);
  };
  dismiss.onclick = next.onclick;
  skip.onclick = () => {
    progress.skip();
    refresh(true);
  };
  document.getElementById('show-tips').onclick = () => {
    progress.reset();
    shown = null;
    refresh(true);
  };
  refresh();
  return { refresh };
}
