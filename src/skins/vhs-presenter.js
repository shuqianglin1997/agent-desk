/* Local, presentation-only pixel signs. These are stylized provider marks,
 * not bundled official artwork. No account, launch or persistence authority. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VhsPresenter = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const palette = Object.freeze(['#34e3f5', '#ff43b2', '#ffad32', '#b18aff', '#46ef91', '#ffe344', '#6ba8ff', '#ff667d']);
  const labels = Object.freeze({ codex: 'CODEX', claude: 'CLAUDE', dsh: 'DSH', other: 'AGENTS' });
  const order = ['codex', 'claude', 'dsh', 'other'];
  const previous = new WeakMap();
  const pixels = Object.freeze({
    codex: [
      '0000000000000000', '0000000000000000', '0000000000000000', '0001000000001000',
      '0011000000001100', '0110000110000110', '1100000110000011', '1100001100000011',
      '0110001100000110', '0011011000001100', '0001011000001000', '0000000000000000',
      '0000000000000000', '0000000000000000', '0000000000000000', '0000000000000000'
    ],
    claude: [
      '0000000110000000', '0010000110000100', '0011000110001100', '0001100110011000',
      '1000110110110001', '1100011111100011', '0111011111101110', '0001111111111000',
      '0001111111111000', '0111011111101110', '1100011111100011', '1000110110110001',
      '0001100110011000', '0011000110001100', '0010000110000100', '0000000110000000'
    ],
    dsh: [
      '1111111111111111', '1000000000000001', '1010100000000001', '1000000000000001',
      '1111111111111111', '1000000000000001', '1001100000000001', '1000110000000001',
      '1000011000000001', '1000110000000001', '1001100011111001', '1000000011111001',
      '1000000000000001', '1000000000000001', '1111111111111111', '0000000000000000'
    ],
    other: [
      '0000111111110000', '0001100000011000', '0011000000001100', '0110000110000110',
      '1100000110000011', '1100000110000011', '1100111111110011', '1100111111110011',
      '1100000110000011', '1100000110000011', '0110000000000110', '0011000000001100',
      '0001100000011000', '0000111111110000', '0000000000000000', '0000000000000000'
    ]
  });

  function normalizeProvider(value) {
    const key = typeof value === 'string' ? value.trim().toLowerCase().replace(/[ _]+/g, '-') : '';
    if (['codex', 'codex-cli', 'codex-desktop', 'openai', 'chatgpt'].includes(key)) return 'codex';
    if (['claude', 'claude-cli', 'claude-desktop', 'anthropic'].includes(key)) return 'claude';
    if (['dsh', 'dsh-cli', 'dsh-desktop', 'work'].includes(key)) return 'dsh';
    return 'other';
  }

  function defaultColor(id, index) {
    if (Number.isSafeInteger(index) && index >= 0) return palette[index % palette.length];
    let hash = 2166136261;
    for (const char of String(id || '')) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return palette[(hash >>> 0) % palette.length];
  }

  function normalizeColor(color, fallback = palette[0]) {
    return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() :
      (typeof fallback === 'string' && /^#[0-9a-f]{6}$/i.test(fallback) ? fallback.toLowerCase() : palette[0]);
  }

  function groupAgents(agents) {
    const groups = new Map(order.map(provider => [provider, []]));
    const seen = new Set();
    for (const agent of Array.isArray(agents) ? agents : []) {
      if (!agent || typeof agent.id !== 'string' || !agent.id || seen.has(agent.id)) continue;
      seen.add(agent.id);
      const provider = normalizeProvider(agent.provider);
      groups.get(provider).push({ ...agent, provider });
    }
    return order.filter(provider => groups.get(provider).length).map(provider => ({ provider, agents: groups.get(provider) }));
  }

  function createIcon(provider, color, ownerDocument) {
    const doc = ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) throw new Error('createIcon requires a DOM document');
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('class', 'vhs-provider-icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('fill', normalizeColor(color));
    svg.dataset.provider = normalizeProvider(provider);
    for (const [y, row] of pixels[svg.dataset.provider].entries()) {
      for (let x = 0; x < row.length; x += 1) {
        if (row[x] !== '1') continue;
        const pixel = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
        for (const [key, value] of Object.entries({ x: x + 2, y: y + 2, width: 1, height: 1 })) pixel.setAttribute(key, String(value));
        svg.append(pixel);
      }
    }
    return svg;
  }

  function renderCity(container, { agents = [], onSelect, emptyLabel = '' } = {}) {
    if (!container?.ownerDocument) throw new Error('renderCity requires a DOM container');
    const doc = container.ownerDocument;
    const old = previous.get(container);
    const focusedId = container.contains(doc.activeElement) ? doc.activeElement?.dataset.agentId : null;
    const scrollLeft = container.scrollLeft;
    container.classList.add('vhs-city');
    const street = doc.createElement('div');
    street.className = 'vhs-city-street';
    const groups = groupAgents(agents);
    const buttons = [];
    let selectedButton = null;
    for (const { provider, agents: members } of groups) {
      const district = doc.createElement('section');
      district.className = 'vhs-district';
      district.dataset.provider = provider;
      district.setAttribute('aria-label', labels[provider]);
      const heading = doc.createElement('div');
      heading.className = 'vhs-district-name';
      heading.textContent = labels[provider];
      district.append(heading);
      for (let index = 0; index < members.length; index += 3) {
        const tower = doc.createElement('div');
        tower.className = 'vhs-tower';
        tower.dataset.variant = String((index / 3 + order.indexOf(provider)) % 3);
        const antenna = doc.createElement('div');
        antenna.className = 'vhs-tower-antenna';
        antenna.setAttribute('aria-hidden', 'true');
        tower.append(antenna);
        const signs = doc.createElement('div');
        signs.className = 'vhs-tower-signs';
        for (const agent of members.slice(index, index + 3)) {
          const button = doc.createElement('button');
          button.type = 'button';
          button.className = 'vhs-sign';
          button.dataset.agentId = agent.id;
          button.dataset.provider = provider;
          button.setAttribute('aria-pressed', String(agent.selected === true));
          const color = normalizeColor(agent.color, defaultColor(agent.id));
          button.style.setProperty('--sign-color', color);
          const name = typeof agent.name === 'string' ? agent.name : agent.id;
          const status = typeof agent.status === 'string' ? agent.status : '';
          button.title = [name, labels[provider], status].filter(Boolean).join(' · ');
          const text = doc.createElement('span');
          text.className = 'vhs-sign-text';
          const title = doc.createElement('strong');
          title.textContent = name;
          text.append(title);
          button.append(createIcon(provider, color, doc), text);
          button.addEventListener('click', () => { if (typeof onSelect === 'function') onSelect(agent.id); });
          button.addEventListener('keydown', event => {
            const position = buttons.indexOf(button);
            const target = event.key === 'ArrowRight' ? buttons[position + 1] : event.key === 'ArrowLeft' ? buttons[position - 1] : null;
            if (target) { event.preventDefault(); target.focus(); }
          });
          buttons.push(button);
          if (agent.selected === true) selectedButton = button;
          signs.append(button);
        }
        tower.append(signs);
        district.append(tower);
      }
      street.append(district);
    }
    if (!groups.length) {
      const empty = doc.createElement('p');
      empty.className = 'vhs-city-empty';
      empty.textContent = emptyLabel;
      street.append(empty);
    }
    container.replaceChildren(street);
    container.scrollLeft = scrollLeft;
    const restored = focusedId && buttons.find(button => button.dataset.agentId === focusedId);
    if (restored) restored.focus({ preventScroll: true });
    const selectedId = selectedButton?.dataset.agentId || null;
    if (selectedButton && old?.selectedId !== selectedId) {
      // Scroll only this city, never an overflow-hidden ancestor or dialog.
      const bounds = container.getBoundingClientRect();
      const sign = selectedButton.getBoundingClientRect();
      if (sign.left < bounds.left + 8) container.scrollLeft += sign.left - bounds.left - 8;
      else if (sign.right > bounds.right - 8) container.scrollLeft += sign.right - bounds.right + 8;
    }
    previous.set(container, { selectedId });
    return street;
  }

  return Object.freeze({ palette, defaultColor, normalizeColor, normalizeProvider, groupAgents, createIcon, renderCity });
}));
