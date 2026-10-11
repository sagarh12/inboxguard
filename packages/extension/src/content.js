import {
  inspectEmail,
  stripAbusiveInvisible,
  parseColor,
  colorsNearlyEqual,
} from '@inboxguard/core';
import {
  siteForHost,
  findMessageBodies,
  findMessageContainers,
  messageIdFor,
} from './selectors.js';
import { createRowMarker } from './inbox-rows.js';
import { createBanner } from './banner.js';
import { loadSettings, onSettingsChanged, DEFAULT_SETTINGS } from './settings.js';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const DEBOUNCE_MS = 250;
const RED_KINDS = new Set([
  'hidden-instruction',
  'encoded-instruction',
  'smuggled-instruction',
  'carrier-instruction',
]);
const NEUTRALIZED_ATTRIBUTE = 'data-inboxguard-neutralized';

function logQuietly(error) {
  try {
    console.debug('inboxguard', error);
  } catch {
    return;
  }
}

function quietly(fn, fallback) {
  try {
    return fn();
  } catch (error) {
    logQuietly(error);
    return fallback;
  }
}

export function stateFor(result) {
  if (result.verdict === 'malicious' || result.findings.some((f) => RED_KINDS.has(f.kind)))
    return 'red';
  const visibleProblem = result.findings.some((f) => f.severity !== 'info');
  if (result.verdict === 'suspicious' || visibleProblem) return 'amber';
  return 'green';
}

function pixels(value) {
  const number = parseFloat(value);
  return Number.isNaN(number) ? null : number;
}

function effectiveBackground(element, view) {
  let current = element;
  while (current && current.nodeType === 1) {
    const color = parseColor(view.getComputedStyle(current).backgroundColor);
    if (color && color.a > 0.05) return color;
    current = current.parentElement;
  }
  return parseColor('#ffffff');
}

export function isElementHidden(element, view) {
  const style = view.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse')
    return true;
  if (element.hasAttribute('hidden')) return true;
  const opacity = pixels(style.opacity);
  if (opacity !== null && opacity <= 0.05) return true;
  const fontSize = pixels(style.fontSize);
  if (fontSize !== null && fontSize <= 1) return true;
  if (style.clip && style.clip !== 'auto' && /rect/.test(style.clip)) return true;
  if (style.clipPath && style.clipPath !== 'none') return true;
  const indent = pixels(style.textIndent);
  if (indent !== null && indent <= -999) return true;
  if (
    (style.position === 'absolute' || style.position === 'fixed') &&
    ((pixels(style.left) ?? 0) <= -999 || (pixels(style.top) ?? 0) <= -999)
  )
    return true;
  if (
    /hidden|clip/.test(style.overflow) &&
    (pixels(style.maxHeight) === 0 || pixels(style.height) === 0)
  )
    return true;
  const color = parseColor(style.color);
  return Boolean(color && colorsNearlyEqual(color, effectiveBackground(element, view)));
}

function hasText(node) {
  return /[\p{L}\p{N}]/u.test(node.textContent ?? '');
}

export function neutralizeHidden(body, view) {
  let count = 0;
  const doc = body.ownerDocument;
  const walker = doc.createTreeWalker(
    body,
    view.NodeFilter.SHOW_ELEMENT | view.NodeFilter.SHOW_COMMENT | view.NodeFilter.SHOW_TEXT,
  );
  const comments = [];
  const hiddenElements = [];
  const texts = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 8) comments.push(node);
    else if (node.nodeType === 3) texts.push(node);
    else if (
      hasText(node) &&
      !hiddenElements.some((h) => h.contains(node)) &&
      isElementHidden(node, view)
    )
      hiddenElements.push(node);
  }
  for (const comment of comments) {
    if (!comment.data.trim()) continue;
    comment.data = '';
    count += 1;
  }
  for (const element of hiddenElements) {
    const inner = doc.createTreeWalker(element, view.NodeFilter.SHOW_TEXT);
    for (let text = inner.nextNode(); text; text = inner.nextNode()) text.data = '';
    element.setAttribute(NEUTRALIZED_ATTRIBUTE, 'hidden-text');
    count += 1;
  }
  for (const text of texts) {
    const cleaned = stripAbusiveInvisible(text.data);
    if (cleaned === text.data) continue;
    text.data = cleaned;
    text.parentElement?.setAttribute(NEUTRALIZED_ATTRIBUTE, 'invisible-characters');
    count += 1;
  }
  return count;
}

export function createScanner({
  document: doc,
  window: view,
  site,
  settings = { ...DEFAULT_SETTINGS },
  inspect = inspectEmail,
}) {
  const scanned = new WeakSet();
  const flagged = new WeakSet();
  const current = { settings };
  const rows = createRowMarker({ document: doc, site, inspect });

  const place = (anchor, report) => {
    const banner = createBanner(doc, report);
    anchor.parentNode?.insertBefore(banner, anchor);
    return banner;
  };

  const scanBody = (body) => {
    scanned.add(body);
    const html = body.innerHTML;
    if (html.length > MAX_BODY_BYTES) return place(body, { state: 'too-large', findings: [] });
    const started = view.performance?.now?.() ?? Date.now();
    const result = inspect({ html });
    const elapsedMs = (view.performance?.now?.() ?? Date.now()) - started;
    const state = stateFor(result);
    const shouldNeutralize = current.settings.neutralize && (state === 'amber' || state === 'red');
    if (state === 'red') rows.rememberRed(messageIdFor(body, site));
    const neutralized = shouldNeutralize ? quietly(() => neutralizeHidden(body, view), 0) : 0;
    return place(body, { state, findings: result.findings, elapsedMs, neutralized });
  };

  const markUncheckable = () => {
    for (const container of findMessageContainers(doc, site)) {
      if (flagged.has(container) || findMessageBodies(container, site).length > 0) continue;
      flagged.add(container);
      quietly(() => container.prepend(createBanner(doc, { state: 'unknown', findings: [] })));
    }
  };

  const scanNow = () =>
    quietly(() => {
      for (const body of findMessageBodies(doc, site)) {
        if (scanned.has(body) || body.closest('[data-inboxguard-banner]')) continue;
        quietly(() => scanBody(body));
      }
      markUncheckable();
      if (current.settings.markInbox) quietly(() => rows.markRows());
    });

  let timer = null;
  const schedule = () => {
    if (timer) view.clearTimeout(timer);
    timer = view.setTimeout(() => {
      timer = null;
      scanNow();
    }, DEBOUNCE_MS);
  };

  let observer = null;
  return {
    scanNow,
    start() {
      observer = new view.MutationObserver(schedule);
      observer.observe(doc.body, { childList: true, subtree: true });
      schedule();
    },
    stop() {
      observer?.disconnect();
      if (timer) view.clearTimeout(timer);
    },
    updateSettings(next) {
      current.settings = { ...current.settings, ...next };
      if (!current.settings.markInbox) quietly(() => rows.clear());
    },
  };
}

export async function bootstrap(view = globalThis.window) {
  const site = quietly(() => siteForHost(view.location.hostname), null);
  if (!site) return null;
  const settings = await loadSettings();
  const scanner = createScanner({ document: view.document, window: view, site, settings });
  onSettingsChanged((next) => scanner.updateSettings(next));
  quietly(() => scanner.start());
  return scanner;
}

if (globalThis.chrome?.runtime?.id && globalThis.window?.document) {
  bootstrap().catch(logQuietly);
}
