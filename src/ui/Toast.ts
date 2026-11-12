import '../styles/toast.css';

type Variant = 'success' | 'error' | 'info' | 'prompt';

interface Active {
  el: HTMLElement;
  timer: ReturnType<typeof setTimeout> | null;
  onDismiss: (() => void) | null;
  isPrompt: boolean;
}

interface PromptOpts {
  actionLabel: string;
  onAction: () => void;
  onDismiss?: () => void;
}

interface Pending {
  variant: Variant;
  message: string;
  prompt?: PromptOpts;
}

const AUTO_DISMISS_MS = 3000;
let rootEl: HTMLElement | null = null;
let active: Active | null = null;
const queue: Pending[] = [];

function ensureRoot(): HTMLElement {
  if (rootEl && rootEl.isConnected) return rootEl;
  rootEl = document.createElement('div');
  rootEl.className = 'toast-root';
  // The root is the SR-announced live region: aria-live + aria-atomic mean
  // a screen reader reads the whole toast as a single update each time one
  // is shown. role=status is the polite default; error toasts also carry
  // role=alert on the element itself so SRs that pick the inner role get
  // an assertive announcement.
  rootEl.setAttribute('role', 'status');
  rootEl.setAttribute('aria-live', 'polite');
  rootEl.setAttribute('aria-atomic', 'true');
  rootEl.setAttribute('aria-label', 'Notifications');
  document.body.appendChild(rootEl);
  return rootEl;
}

function dismissActive(): void {
  if (!active) return;
  if (active.timer != null) clearTimeout(active.timer);
  const onDismiss = active.onDismiss;
  if (active.el.parentElement) active.el.parentElement.removeChild(active.el);
  active = null;
  if (onDismiss) onDismiss();
  showNext();
}

function showNext(): void {
  if (active) return;
  const next = queue.shift();
  if (!next) return;
  const root = ensureRoot();

  const el = document.createElement('div');
  el.className = `toast toast--${next.variant}`;
  el.setAttribute('role', next.variant === 'error' ? 'alert' : 'status');

  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = next.message;
  el.appendChild(text);

  // Prompt variant: a primary action button between the message and the close
  // (×). Clicking it fires the caller's onAction and tears down the toast
  // without firing onDismiss -- the action took the place of dismissal.
  if (next.variant === 'prompt' && next.prompt) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'toast-action';
    action.textContent = next.prompt.actionLabel;
    const onAction = next.prompt.onAction;
    action.addEventListener('click', () => {
      if (!active) return;
      active.onDismiss = null;
      dismissActive();
      onAction();
    });
    el.appendChild(action);
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '×';
  close.addEventListener('click', () => dismissActive());
  el.appendChild(close);

  root.appendChild(el);

  let timer: ReturnType<typeof setTimeout> | null = null;
  if (next.variant === 'success' || next.variant === 'info') {
    timer = setTimeout(() => dismissActive(), AUTO_DISMISS_MS);
  }
  active = { el, timer, onDismiss: next.prompt?.onDismiss ?? null, isPrompt: next.variant === 'prompt' };
}

function enqueue(variant: Variant, message: string, prompt?: PromptOpts): void {
  queue.push(prompt ? { variant, message, prompt } : { variant, message });
  showNext();
}

export const toast = {
  success(message: string): void { enqueue('success', message); },
  error(message: string): void { enqueue('error', message); },
  info(message: string): void { enqueue('info', message); },
  /**
   * Sticky toast with a primary action button. Doesn't auto-dismiss. Pressing
   * the action runs `onAction` and tears the toast down; pressing × (or any
   * other dismissal path) runs `onDismiss` if supplied. The two callbacks are
   * mutually exclusive -- exactly one fires per prompt.
   */
  prompt(message: string, opts: PromptOpts): void { enqueue('prompt', message, opts); },
  /** Dismiss the currently-shown toast and drain the queue. Prompts are left
   *  alone: they wait for the user, and their onDismiss can be destructive. */
  dismiss(): void {
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i]!.variant !== 'prompt') queue.splice(i, 1);
    }
    if (active?.isPrompt) return;
    dismissActive();
  },
  _test: {
    reset(): void {
      queue.length = 0;
      if (active) {
        if (active.timer != null) clearTimeout(active.timer);
        if (active.el.parentElement) active.el.parentElement.removeChild(active.el);
        active = null;
      }
      if (rootEl && rootEl.parentElement) rootEl.parentElement.removeChild(rootEl);
      rootEl = null;
    },
  },
};
