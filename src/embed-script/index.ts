(function () {
  interface BfflessChatConfig {
    url: string;
    primaryColor?: string;
    position?: 'bottom-right' | 'bottom-left';
    title?: string;
    suggestions?: string[];
  }

  const config: BfflessChatConfig = (window as unknown as { BfflessChat: BfflessChatConfig }).BfflessChat;
  if (!config?.url) {
    console.error('BfflessChat: missing required "url" in window.BfflessChat');
    return;
  }

  const baseUrl = config.url.replace(/\/$/, '');
  const primaryColor = config.primaryColor || '#3b82f6';
  const position = config.position || 'bottom-right';

  // Create shadow DOM host
  const host = document.createElement('div');
  host.id = 'bffless-chat-widget';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  // Styles inside shadow DOM
  const style = document.createElement('style');
  style.textContent = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    .bfc-button {
      position: fixed;
      bottom: 20px;
      ${position === 'bottom-left' ? 'left: 20px;' : 'right: 20px;'}
      z-index: 2147483647;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: none;
      background: ${primaryColor};
      color: white;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .bfc-button:hover {
      transform: scale(1.05);
      box-shadow: 0 6px 20px rgba(0,0,0,0.2);
    }
    .bfc-button svg {
      width: 24px;
      height: 24px;
      fill: white;
    }

    .bfc-badge {
      position: absolute;
      top: -4px;
      right: -4px;
      min-width: 20px;
      height: 20px;
      border-radius: 10px;
      background: #ef4444;
      color: white;
      font-size: 12px;
      font-weight: 600;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 0 5px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .bfc-badge.visible {
      display: flex;
    }

    .bfc-container {
      position: fixed;
      bottom: 88px;
      ${position === 'bottom-left' ? 'left: 20px;' : 'right: 20px;'}
      z-index: 2147483647;
      width: 400px;
      height: 600px;
      max-height: calc(100vh - 108px);
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 8px 30px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08);
      display: none;
      flex-direction: column;
      background: white;
    }
    .bfc-container.open {
      display: flex;
    }

    .bfc-container iframe {
      width: 100%;
      height: 100%;
      border: none;
      border-radius: 16px;
    }

    @media (max-width: 480px) {
      .bfc-container {
        width: 100vw;
        height: 100vh;
        max-height: 100vh;
        bottom: 0;
        right: 0;
        left: 0;
        border-radius: 0;
      }
      .bfc-container iframe {
        border-radius: 0;
      }
      .bfc-container.open ~ .bfc-button {
        display: none;
      }
    }
  `;
  shadow.appendChild(style);

  // Chat button
  const button = document.createElement('button');
  button.className = 'bfc-button';
  button.setAttribute('aria-label', 'Open chat');
  button.innerHTML = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  `;

  // Badge
  const badge = document.createElement('span');
  badge.className = 'bfc-badge';
  button.appendChild(badge);

  // Container
  const container = document.createElement('div');
  container.className = 'bfc-container';

  shadow.appendChild(container);
  shadow.appendChild(button);

  let iframe: HTMLIFrameElement | null = null;
  let isOpen = false;
  let unreadCount = 0;

  function createIframe() {
    iframe = document.createElement('iframe');
    iframe.src = `${baseUrl}/embed/`;
    iframe.setAttribute('title', config.title || 'Chat');
    iframe.setAttribute('allow', 'clipboard-write');
    container.appendChild(iframe);
  }

  function toggle() {
    isOpen = !isOpen;
    if (isOpen) {
      if (!iframe) createIframe();
      container.classList.add('open');
      unreadCount = 0;
      badge.classList.remove('visible');
      button.innerHTML = `
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="white" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      `;
      button.appendChild(badge);
    } else {
      container.classList.remove('open');
      button.innerHTML = `
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      `;
      button.appendChild(badge);
    }
  }

  button.addEventListener('click', toggle);

  // Listen for messages from iframe
  window.addEventListener('message', (event: MessageEvent) => {
    // Validate origin
    if (event.origin !== new URL(baseUrl).origin) return;

    const { type } = event.data || {};

    switch (type) {
      case 'bffless-chat:ready':
        // Send init config to iframe
        iframe?.contentWindow?.postMessage({
          type: 'bffless-chat:init',
          primaryColor,
          title: config.title,
          suggestions: config.suggestions,
        }, baseUrl);
        break;

      case 'bffless-chat:close':
        if (isOpen) toggle();
        break;

      case 'bffless-chat:unread':
        if (!isOpen) {
          unreadCount += (event.data.count || 1);
          badge.textContent = String(unreadCount);
          badge.classList.add('visible');
        }
        break;
    }
  });
})();
