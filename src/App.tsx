import { useChat, UIMessage } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface RateLimitState {
  isLimited: boolean;
  retryAfter: number;
  message: string;
}

// Extract conversation ID from URL path (/chat/:id)
function getConversationIdFromUrl(): string | null {
  const match = window.location.pathname.match(/^\/chat\/([^/]+)$/);
  return match ? match[1] : null;
}

// Backend message format
interface BackendMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tokens_used?: number;
  conversation_id: string;
  createdAt: string;
  updatedAt: string;
}

// Fetch existing conversation messages
async function fetchConversationMessages(conversationId: string): Promise<UIMessage[]> {
  try {
    const response = await fetch(`/api/chat?conversationId=${encodeURIComponent(conversationId)}`);
    if (!response.ok) {
      if (response.status === 404) {
        // Conversation not found - this is fine, start fresh
        return [];
      }
      throw new Error(`Failed to fetch conversation: ${response.statusText}`);
    }
    const result = await response.json();

    if (!result.success || !Array.isArray(result.data)) {
      return [];
    }

    // Transform backend messages to UIMessage format
    // Sort by createdAt ascending (oldest first) since backend may return in different order
    const sortedMessages = [...result.data].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    return sortedMessages.map((msg: BackendMessage): UIMessage => ({
      id: msg.id,
      role: msg.role,
      parts: [{ type: 'text', text: msg.content }],
    }));
  } catch (error) {
    console.error('Error fetching conversation:', error);
    return [];
  }
}

function App() {
  const [inputValue, setInputValue] = useState('');
  const [rateLimit, setRateLimit] = useState<RateLimitState>({
    isLimited: false,
    retryAfter: 0,
    message: '',
  });
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasUpdatedUrl = useRef(false);

  // Get conversation ID from URL if loading existing conversation
  const urlConversationId = getConversationIdFromUrl();

  // Load existing messages on mount if URL has conversation ID
  useEffect(() => {
    if (urlConversationId) {
      // URL has conversation ID - fetch messages
      fetchConversationMessages(urlConversationId).then((messages) => {
        setInitialMessages(messages);
        setIsLoadingHistory(false);
        hasUpdatedUrl.current = true; // URL already has ID
      });
    } else {
      // New conversation - no messages to load
      setIsLoadingHistory(false);
    }
  }, [urlConversationId]);

  // Memoize transport to avoid recreating on each render
  const transport = useMemo(() => new DefaultChatTransport({
    api: '/api/chat',
    body: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  }), []);

  // Pass URL ID to useChat if loading existing conversation, otherwise let SDK generate
  const chatResult = useChat({
    ...(urlConversationId ? { id: urlConversationId } : {}),
    transport,
  });

  const { id: conversationId, messages, sendMessage, status, error, stop, setMessages } = chatResult;

  // Update URL with SDK-generated ID on first message (for new chats)
  useEffect(() => {
    if (!hasUpdatedUrl.current && messages.length > 0 && conversationId) {
      window.history.replaceState(null, '', `/chat/${conversationId}`);
      hasUpdatedUrl.current = true;
    }
  }, [messages.length, conversationId]);

  // Set initial messages when loaded from backend
  useEffect(() => {
    if (initialMessages.length > 0 && messages.length === 0) {
      setMessages(initialMessages);
    }
  }, [initialMessages, messages.length, setMessages]);

  // Debug: log the chat result to help diagnose issues
  useEffect(() => {
    console.log('useChat result:', {
      hasSendMessage: typeof chatResult.sendMessage === 'function',
      hasStop: typeof chatResult.stop === 'function',
      status: chatResult.status,
      keys: Object.keys(chatResult),
    });
  }, [chatResult]);

  const isStreaming = status === 'streaming';
  const isSubmitting = status === 'submitted';
  const isLoading = isStreaming || isSubmitting;

  // Parse rate limit errors
  const parseRateLimitError = useCallback((err: Error | undefined) => {
    if (!err) return null;

    try {
      // The error message might contain the JSON response
      const match = err.message.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        // Handle nested error structure: { success: false, error: { code, message, details } }
        const errorObj = parsed.error || parsed;
        if (errorObj.code === 'RATE_LIMIT_EXCEEDED' && errorObj.details?.retryAfter) {
          return {
            retryAfter: errorObj.details.retryAfter,
            message: errorObj.message || 'Rate limit exceeded',
          };
        }
      }
    } catch {
      // Not a rate limit error or couldn't parse
    }
    return null;
  }, []);

  // Handle rate limit errors
  useEffect(() => {
    const rateLimitInfo = parseRateLimitError(error);
    if (rateLimitInfo) {
      setRateLimit({
        isLimited: true,
        retryAfter: rateLimitInfo.retryAfter,
        message: rateLimitInfo.message,
      });
    }
  }, [error, parseRateLimitError]);

  // Countdown timer for rate limit
  useEffect(() => {
    if (!rateLimit.isLimited || rateLimit.retryAfter <= 0) return;

    const interval = setInterval(() => {
      setRateLimit((prev) => {
        const newRetryAfter = prev.retryAfter - 1;
        if (newRetryAfter <= 0) {
          return { isLimited: false, retryAfter: 0, message: '' };
        }
        return { ...prev, retryAfter: newRetryAfter };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [rateLimit.isLimited, rateLimit.retryAfter]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading || rateLimit.isLimited) return;

    if (typeof sendMessage !== 'function') {
      console.error('sendMessage is not a function. Chat result:', chatResult);
      alert('Chat not initialized properly. Check console for details.');
      return;
    }

    const message = inputValue;
    setInputValue('');
    await sendMessage({ text: message });
  };

  // Format seconds into mm:ss
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Helper to get text content from message parts
  const getMessageText = (message: (typeof messages)[0]) => {
    if (!message.parts || message.parts.length === 0) {
      return '';
    }
    return message.parts
      .filter((part) => part.type === 'text')
      .map((part) => (part as { type: 'text'; text: string }).text)
      .join('');
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>BFFless Chat Demo</h1>
        <p style={styles.subtitle}>
          AI-powered assistant with skills
        </p>
      </header>

      <div style={styles.chatContainer}>
        {/* Status Bar */}
        <div style={styles.statusBar}>
          <div style={styles.statusBadges}>
            {isStreaming && <span style={styles.statusBadge}>Streaming...</span>}
            {isSubmitting && <span style={styles.statusBadgeUpdating}>Sending...</span>}
            {rateLimit.isLimited ? (
              <span style={styles.statusBadgeRateLimit}>
                Rate limited - try again in {formatTime(rateLimit.retryAfter)}
              </span>
            ) : (
              error && !parseRateLimitError(error) && (
                <span style={styles.statusBadgeError}>Error: {error.message}</span>
              )
            )}
            {status === 'ready' && messages.length > 0 && !rateLimit.isLimited && (
              <span style={styles.statusBadgeReady}>Ready</span>
            )}
          </div>
          {messages.length > 0 && (
            <button
              style={styles.newChatButton}
              onClick={() => {
                window.location.href = '/';
              }}
            >
              New Chat
            </button>
          )}
        </div>

        {/* Messages Area */}
        <div style={styles.messagesArea}>
          {isLoadingHistory ? (
            <div style={styles.emptyState}>
              <p style={styles.emptyStateText}>Loading conversation...</p>
            </div>
          ) : messages.length === 0 ? (
            <div style={styles.emptyState}>
              <p style={styles.emptyStateText}>Start a conversation by typing a message below.</p>
              <div style={styles.suggestions}>
                <p style={styles.suggestionsTitle}>Try asking:</p>
                <button
                  style={styles.suggestionButton}
                  onClick={() => setInputValue('What is BFFless?')}
                >
                  What is BFFless?
                </button>
                <button
                  style={styles.suggestionButton}
                  onClick={() => setInputValue('How do I set up proxy rules?')}
                >
                  How do I set up proxy rules?
                </button>
                <button
                  style={styles.suggestionButton}
                  onClick={() => setInputValue("I'd like to schedule a time to chat this week. What's available?")}
                >
                  Schedule a chat
                </button>
              </div>
            </div>
          ) : (
            <div style={styles.messagesList}>
              {messages.map((message) => (
                <div
                  key={message.id}
                  style={{
                    ...styles.messageWrapper,
                    justifyContent: message.role === 'user' ? 'flex-end' : 'flex-start',
                  }}
                >
                  <div
                    style={{
                      ...styles.message,
                      ...(message.role === 'user' ? styles.userMessage : styles.assistantMessage),
                    }}
                  >
                    <div style={styles.messageRole}>
                      {message.role === 'user' ? 'You' : 'Assistant'}
                    </div>
                    <div style={styles.messageContent}>
                      {message.role === 'assistant' ? (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            // Custom styling for markdown elements
                            p: ({ children }) => <p style={{ margin: '0 0 0.5em 0' }}>{children}</p>,
                            h1: ({ children }) => <h1 style={{ fontSize: '1.5em', fontWeight: 'bold', margin: '0.5em 0' }}>{children}</h1>,
                            h2: ({ children }) => <h2 style={{ fontSize: '1.3em', fontWeight: 'bold', margin: '0.5em 0' }}>{children}</h2>,
                            h3: ({ children }) => <h3 style={{ fontSize: '1.1em', fontWeight: 'bold', margin: '0.5em 0' }}>{children}</h3>,
                            ul: ({ children }) => <ul style={{ margin: '0.5em 0', paddingLeft: '1.5em' }}>{children}</ul>,
                            ol: ({ children }) => <ol style={{ margin: '0.5em 0', paddingLeft: '1.5em' }}>{children}</ol>,
                            li: ({ children }) => <li style={{ margin: '0.25em 0' }}>{children}</li>,
                            code: ({ className, children }) => {
                              const isInline = !className;
                              return isInline ? (
                                <code style={{ background: '#e0e0e0', padding: '0.1em 0.3em', borderRadius: '3px', fontSize: '0.9em' }}>{children}</code>
                              ) : (
                                <code style={{ display: 'block', background: '#1e1e1e', color: '#d4d4d4', padding: '0.75em', borderRadius: '6px', fontSize: '0.85em', overflowX: 'auto' }}>{children}</code>
                              );
                            },
                            pre: ({ children }) => <pre style={{ margin: '0.5em 0' }}>{children}</pre>,
                            strong: ({ children }) => <strong style={{ fontWeight: 'bold' }}>{children}</strong>,
                            em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
                            blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid #ccc', paddingLeft: '1em', margin: '0.5em 0', color: '#666' }}>{children}</blockquote>,
                            // Table elements
                            table: ({ children }) => <table style={{ borderCollapse: 'collapse', width: '100%', margin: '0.5em 0' }}>{children}</table>,
                            thead: ({ children }) => <thead style={{ borderBottom: '2px solid #ddd' }}>{children}</thead>,
                            tbody: ({ children }) => <tbody>{children}</tbody>,
                            tr: ({ children }) => <tr style={{ borderBottom: '1px solid #eee' }}>{children}</tr>,
                            th: ({ children }) => <th style={{ padding: '0.5em 0.75em', textAlign: 'left', fontWeight: 'bold', background: '#f5f5f5' }}>{children}</th>,
                            td: ({ children }) => <td style={{ padding: '0.5em 0.75em' }}>{children}</td>,
                          }}
                        >
                          {getMessageText(message)}
                        </ReactMarkdown>
                      ) : (
                        getMessageText(message)
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Area */}
        <form onSubmit={handleSubmit} style={styles.inputArea}>
          <div style={styles.inputWrapper}>
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={rateLimit.isLimited ? `Rate limited - ${formatTime(rateLimit.retryAfter)} remaining...` : "Type your message..."}
              style={styles.input}
              rows={1}
              disabled={isLoading || rateLimit.isLimited || isLoadingHistory}
            />
            <div style={styles.inputActions}>
              {isLoading ? (
                <button type="button" onClick={() => stop()} style={styles.stopButton}>
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!inputValue.trim() || rateLimit.isLimited}
                  style={{
                    ...styles.sendButton,
                    opacity: inputValue.trim() && !rateLimit.isLimited ? 1 : 0.5,
                  }}
                >
                  Send
                </button>
              )}
            </div>
          </div>
          <p style={styles.hint}>Press Enter to send, Shift+Enter for new line</p>
        </form>
      </div>

      <footer style={styles.footer}>
        <p>
          This demo uses <code>useChat</code> from the AI SDK to stream responses from the backend.
        </p>
      </footer>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '800px',
    margin: '0 auto',
    padding: '20px',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    textAlign: 'center',
    marginBottom: '24px',
  },
  title: {
    fontSize: '2rem',
    marginBottom: '8px',
    color: '#1a1a1a',
  },
  subtitle: {
    color: '#666',
    fontSize: '1rem',
  },
  newChatButton: {
    padding: '6px 12px',
    background: '#f5f5f5',
    border: '1px solid #ddd',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.8rem',
    fontWeight: '500',
    color: '#333',
    transition: 'background 0.2s',
  },
  code: {
    background: '#e8e8e8',
    padding: '2px 8px',
    borderRadius: '4px',
    fontFamily: 'monospace',
  },
  chatContainer: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    background: '#fff',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    overflow: 'hidden',
  },
  statusBar: {
    minHeight: '36px',
    padding: '8px 16px',
    borderBottom: '1px solid #eee',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusBadges: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  statusBadge: {
    background: '#e0e7ff',
    color: '#4338ca',
    padding: '4px 12px',
    borderRadius: '12px',
    fontSize: '0.8rem',
  },
  statusBadgeUpdating: {
    background: '#fef3c7',
    color: '#b45309',
    padding: '4px 12px',
    borderRadius: '12px',
    fontSize: '0.8rem',
  },
  statusBadgeError: {
    background: '#fee2e2',
    color: '#dc2626',
    padding: '4px 12px',
    borderRadius: '12px',
    fontSize: '0.8rem',
  },
  statusBadgeReady: {
    background: '#dcfce7',
    color: '#16a34a',
    padding: '4px 12px',
    borderRadius: '12px',
    fontSize: '0.8rem',
  },
  statusBadgeRateLimit: {
    background: '#fef3c7',
    color: '#b45309',
    padding: '4px 12px',
    borderRadius: '12px',
    fontSize: '0.8rem',
    fontWeight: '500',
  },
  messagesArea: {
    flex: 1,
    overflow: 'auto',
    padding: '16px',
    minHeight: '400px',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    padding: '40px',
  },
  emptyStateText: {
    color: '#666',
    fontSize: '1.1rem',
    marginBottom: '24px',
  },
  suggestions: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
  },
  suggestionsTitle: {
    color: '#888',
    fontSize: '0.9rem',
    marginBottom: '8px',
  },
  suggestionButton: {
    background: '#f5f5f5',
    border: '1px solid #ddd',
    borderRadius: '20px',
    padding: '8px 16px',
    cursor: 'pointer',
    fontSize: '0.9rem',
    color: '#333',
    transition: 'background 0.2s',
  },
  messagesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  messageWrapper: {
    display: 'flex',
    width: '100%',
  },
  message: {
    maxWidth: '80%',
    padding: '12px 16px',
    borderRadius: '12px',
  },
  userMessage: {
    background: '#2563eb',
    color: '#fff',
    borderBottomRightRadius: '4px',
  },
  assistantMessage: {
    background: '#f5f5f5',
    color: '#333',
    borderBottomLeftRadius: '4px',
  },
  messageRole: {
    fontSize: '0.75rem',
    opacity: 0.7,
    marginBottom: '4px',
    fontWeight: '500',
  },
  messageContent: {
    fontSize: '0.95rem',
    lineHeight: '1.6',
    wordBreak: 'break-word',
  },
  inputArea: {
    padding: '16px',
    borderTop: '1px solid #eee',
  },
  inputWrapper: {
    display: 'flex',
    gap: '12px',
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    padding: '12px 16px',
    border: '1px solid #ddd',
    borderRadius: '12px',
    fontSize: '1rem',
    fontFamily: 'inherit',
    resize: 'none',
    outline: 'none',
    minHeight: '48px',
    maxHeight: '120px',
  },
  inputActions: {
    display: 'flex',
    gap: '8px',
  },
  sendButton: {
    padding: '12px 24px',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '12px',
    cursor: 'pointer',
    fontSize: '0.95rem',
    fontWeight: '500',
    transition: 'background 0.2s',
  },
  stopButton: {
    padding: '12px 24px',
    background: '#dc2626',
    color: '#fff',
    border: 'none',
    borderRadius: '12px',
    cursor: 'pointer',
    fontSize: '0.95rem',
    fontWeight: '500',
  },
  hint: {
    fontSize: '0.8rem',
    color: '#888',
    marginTop: '8px',
    textAlign: 'center',
  },
  footer: {
    marginTop: '24px',
    textAlign: 'center',
    color: '#666',
    fontSize: '0.9rem',
    padding: '20px',
  },
};

export default App;
