import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { ChatPopup } from "../src/components/ChatPopup";
import "../src/chat-popup.css";

function PopupDemo() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">
          Chat Popup Demo
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Click the chat bubble in the bottom-right corner to open the chat
          popup. This is a reference implementation for building floating chat
          widgets.
        </p>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Features
          </h2>
          <ul className="list-disc list-inside text-sm text-gray-600 dark:text-gray-400 space-y-1">
            <li>Floating chat bubble with slide-up animation</li>
            <li>Streaming responses via AI SDK</li>
            <li>Conversation persistence via localStorage</li>
            <li>Markdown rendering with syntax highlighting</li>
            <li>Rate limit handling with countdown</li>
            <li>Mobile responsive (full-screen on small screens)</li>
            <li>Dark mode support</li>
            <li>New chat / close controls</li>
          </ul>
        </div>
      </div>
      <ChatPopup />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PopupDemo />
  </StrictMode>
);
