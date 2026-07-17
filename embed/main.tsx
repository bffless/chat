import { StrictMode, useCallback, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { ChatPanel } from '../src/components/ChatPopup/ChatPanel';
import './embed.css';

const EMBED_CONTAINER_CLASS =
  'flex h-full flex-col border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900';

function EmbedChat() {
  const prevMessageCountRef = useRef(0);

  const postToParent = useCallback((type: string, payload: Record<string, unknown> = {}) => {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...payload }, '*');
    }
  }, []);

  const handleClose = useCallback(() => {
    postToParent('bffless-chat:close');
  }, [postToParent]);

  const handleNewChat = useCallback(() => {
    localStorage.removeItem('chat_conversation_id');
    window.location.reload();
  }, []);

  // Notify parent that iframe is ready
  useEffect(() => {
    postToParent('bffless-chat:ready');
  }, [postToParent]);

  // Listen for messages from parent
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const { type } = event.data || {};
      if (type === 'bffless-chat:reset') {
        localStorage.removeItem('chat_conversation_id');
        window.location.reload();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Observe DOM for new assistant messages and post unread count
  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;

    const observer = new MutationObserver(() => {
      const assistantMessages = root.querySelectorAll('[data-role="assistant"]');
      const count = assistantMessages.length;
      if (count > prevMessageCountRef.current) {
        postToParent('bffless-chat:unread', { count: count - prevMessageCountRef.current });
      }
      prevMessageCountRef.current = count;
    });

    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [postToParent]);

  return (
    <div className="h-full w-full">
      <ChatPanel
        onClose={handleClose}
        onNewChat={handleNewChat}
        containerClassName={EMBED_CONTAINER_CLASS}
      />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EmbedChat />
  </StrictMode>,
);
