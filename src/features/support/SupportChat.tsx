import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import {
  MessageCircle,
  Send,
  ShieldCheck,
  X,
  Mail,
  BookOpen,
} from "lucide-react";
import {
  SUPPORT_DISCLAIMER,
  SUPPORT_EMAIL_LINK,
  SupportChatResponseSchema,
  type SupportMessage,
} from "../../../shared/support-chat";
import "./support-chat.css";

const suggestions = [
  "How do I earn WLT points?",
  "How do I claim a prize?",
  "How do referrals work?",
];

export function SupportChat() {
  const { pathname } = useLocation();
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const pageEnd = useRef<HTMLDivElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [atPageEnd, setAtPageEnd] = useState(false);
  const visible = open && !pathname.startsWith("/admin");
  const close = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const background = document.getElementById("root");
    const previousInert = background?.inert ?? false;
    const previousOverflow = document.body.style.overflow;
    const trigger = launcher.current;
    if (background) background.inert = true;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus({ preventScroll: true });
    if (log.current) log.current.scrollTop = log.current.scrollHeight;

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = dialog.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const first = controls?.[0];
      const last = controls?.[controls.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
      if (background) background.inert = previousInert;
      trigger?.focus({ preventScroll: true });
    };
  }, [close, visible]);

  useEffect(() => {
    const target = pageEnd.current;
    if (!target) return;
    const observer = new IntersectionObserver(([entry]) => {
      setAtPageEnd(entry?.isIntersecting ?? false);
    });
    observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, [pathname]);

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages, pending, error]);

  if (pathname.startsWith("/admin")) return null;

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 600 || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(trimmed);
    setError("");
    const timeout = window.setTimeout(() => {
      controller.abort();
    }, 25_000);
    try {
      const response = await fetch("/api/support/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          history: messages.slice(-6),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        setError(
          response.status === 429
            ? "Please wait a minute before sending another message, or email support."
            : "AI help is unavailable right now. Please try again or email support.",
        );
        return;
      }
      const result = SupportChatResponseSchema.parse(await response.json());
      setMessages((current) => [
        ...current.slice(-18),
        { role: "user", content: trimmed },
        { role: "assistant", content: result.answer },
      ]);
      setQuestion("");
    } catch {
      setError("AI help could not respond. Please try again or email support.");
    } finally {
      window.clearTimeout(timeout);
      request.current = null;
      setPending(null);
    }
  }

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(question);
  }

  return (
    <>
      <div ref={pageEnd} className="support-page-end" aria-hidden="true" />
      <button
        ref={launcher}
        type="button"
        className={`support-launcher${atPageEnd ? " is-at-page-end" : ""}`}
        aria-label="Open Walletor AI help"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="walletor-support-chat"
        onClick={() => {
          setOpen(true);
        }}
      >
        <MessageCircle size={23} aria-hidden="true" />
        <span>Need help?</span>
      </button>
      {visible &&
        createPortal(
          <div
            className="support-chat-backdrop"
            onClick={(event) => {
              if (event.target === event.currentTarget) close();
            }}
          >
            <section
              ref={dialog}
              id="walletor-support-chat"
              className="support-chat"
              role="dialog"
              aria-modal="true"
              aria-labelledby="support-chat-title"
            >
              <header className="support-chat__header">
                <div>
                  <strong id="support-chat-title">Walletor AI Help</strong>
                  <span>Quick answers, official guidance</span>
                </div>
                <button
                  ref={closeButton}
                  type="button"
                  aria-label="Close AI help"
                  onClick={close}
                >
                  <X size={22} />
                </button>
              </header>
              <div
                className="support-chat__log"
                ref={log}
                role="log"
                aria-label="Help conversation"
                aria-live="polite"
                aria-relevant="additions text"
              >
                <div className="support-chat__safety">
                  <ShieldCheck size={22} aria-hidden="true" />
                  <div>
                    <strong>Stay safe with Walletor</strong>
                    <p>{SUPPORT_DISCLAIMER}</p>
                  </div>
                </div>
                <p className="support-chat__intro">
                  Hi! I can explain swaps, rewards, referrals and claims. I can
                  make mistakes and cannot access your wallet or check a
                  transaction.
                </p>
                <div className="support-chat__suggestions">
                  {suggestions.map((text) => (
                    <button
                      key={text}
                      type="button"
                      disabled={pending !== null}
                      onClick={() => {
                        setQuestion(text);
                        void ask(text);
                      }}
                    >
                      {text}
                    </button>
                  ))}
                </div>
                {messages.map((message, index) => (
                  <div
                    className={`support-chat__message support-chat__message--${message.role}`}
                    key={`${String(index)}-${message.role}`}
                  >
                    <small>
                      {message.role === "user" ? "You" : "Walletor AI"}
                    </small>
                    <p>{message.content}</p>
                  </div>
                ))}
                {pending ? (
                  <>
                    <div className="support-chat__message support-chat__message--user">
                      <small>You</small>
                      <p>{pending}</p>
                    </div>
                    <p role="status">Finding an answer…</p>
                  </>
                ) : null}
                {error ? (
                  <p className="support-chat__error" role="alert">
                    {error}
                  </p>
                ) : null}
              </div>
              <footer className="support-chat__footer">
                <div className="support-chat__links">
                  <a href={SUPPORT_EMAIL_LINK}>
                    <Mail size={16} />
                    Email support
                  </a>
                  <a
                    href="https://docs.walletor.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <BookOpen size={16} />
                    Docs
                  </a>
                  <button
                    type="button"
                    disabled={pending !== null}
                    onClick={() => {
                      setMessages([]);
                      setQuestion("");
                      setError("");
                    }}
                  >
                    Clear chat
                  </button>
                </div>
                <form onSubmit={submit}>
                  <label className="sr-only" htmlFor="support-question">
                    Your question
                  </label>
                  <input
                    id="support-question"
                    value={question}
                    maxLength={600}
                    autoComplete="off"
                    placeholder="Ask about Walletor…"
                    disabled={pending !== null}
                    onChange={(event) => {
                      setQuestion(event.target.value);
                    }}
                  />
                  <button
                    type="submit"
                    aria-label="Send question"
                    disabled={!question.trim() || pending !== null}
                  >
                    <Send size={19} />
                  </button>
                </form>
                <p className="support-chat__privacy">
                  Messages are processed by Cloudflare AI. This chat is kept
                  only in this tab’s memory. Don’t include personal or wallet
                  secrets.
                </p>
              </footer>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
