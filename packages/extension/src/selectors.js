export const SITES = {
  gmail: {
    hosts: ['mail.google.com'],
    messageContainers: ['div.adn', 'div[data-message-id]', 'div[role="listitem"] div.gs'],
    bodies: ['div.a3s', 'div.ii.gt > div', 'div[data-message-id] div[dir="ltr"]'],
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
