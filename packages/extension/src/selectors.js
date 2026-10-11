export const SITES = {
  gmail: {
    hosts: ['mail.google.com'],
    messageContainers: ['div.adn', 'div[data-message-id]', 'div[role="listitem"] div.gs'],
    bodies: ['div.a3s', 'div.ii.gt > div', 'div[data-message-id] div[dir="ltr"]'],
    rows: {
      row: 'tr.zA',
      parts: ['span.bog', 'span.y2'],
      idElement: '[data-legacy-thread-id]',
      idAttribute: 'data-legacy-thread-id',
    },
    messageIdAttribute: 'data-legacy-message-id',
  },
  outlook: {
    hosts: ['outlook.live.com', 'outlook.office.com', 'outlook.office365.com'],
    messageContainers: [
      'div[aria-label="Reading Pane"]',
      'div[data-app-section="ConversationContainer"]',
      'div[role="main"] div[aria-label*="Message"]',
    ],
    bodies: [
      'div[aria-label="Message body"]',
      'div[id^="UniqueMessageBody"]',
      'div.allowTextSelection',
      'div[role="document"]',
    ],
    rows: {
      row: 'div[role="option"][data-convid]',
      parts: [],
      idElement: null,
      idAttribute: 'data-convid',
    },
    messageIdAttribute: null,
  },
};

export function siteForHost(hostname) {
  return Object.values(SITES).find((site) => site.hosts.includes(hostname)) ?? null;
}

function safeQueryAll(root, selector) {
  try {
    return [...root.querySelectorAll(selector)];
  } catch {
    return [];
  }
}

export function findMessageBodies(root, site) {
  const found = new Set();
  for (const selector of site.bodies) {
    for (const element of safeQueryAll(root, selector)) {
      const nested = [...found].some(
        (existing) => existing.contains(element) || element.contains(existing),
      );
      if (!nested) found.add(element);
    }
    if (found.size > 0) break;
  }
  return [...found];
}

export function findMessageContainers(root, site) {
  for (const selector of site.messageContainers) {
    const matches = safeQueryAll(root, selector);
    if (matches.length > 0) return matches;
  }
  return [];
}

function safeQueryOne(root, selector) {
  try {
    return root.querySelector(selector);
  } catch {
    return null;
  }
}

export function findInboxRows(root, site) {
  return site.rows ? safeQueryAll(root, site.rows.row) : [];
}

export function describeRow(row, site) {
  const { parts, idElement, idAttribute } = site.rows;
  const texts = parts.map((selector) => safeQueryOne(row, selector)?.textContent ?? '');
  const text = (texts.some(Boolean) ? texts.join(' ') : (row.textContent ?? '')).trim();
  const idHolder = idElement ? safeQueryOne(row, idElement) : row;
  return { id: idHolder?.getAttribute(idAttribute) ?? null, text };
}

export function messageIdFor(body, site) {
  if (!site.messageIdAttribute) return null;
  return (
    body.closest(`[${site.messageIdAttribute}]`)?.getAttribute(site.messageIdAttribute) ?? null
  );
}
