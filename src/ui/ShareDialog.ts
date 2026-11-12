import '../styles/share-dialog.css';
import type { Store } from '../app/store';
import type { StratFile } from '../types/stratFile';
import { encodeHash } from '../app/persistence';
import { toast } from './Toast';
import { activateModalA11y } from '../app/modalA11y';

export interface ShareDialogDeps {
  /** Returns the current StratFile snapshot to share. main.ts wires this from the same helper used by Save / Export. */
  getStratFile(): StratFile;
}

// Every share is a self-contained hash link: the whole strat is lz-encoded
// into the URL fragment and nothing is uploaded. No QR (the fragment is far
// too long to scan) and no revoke (there is no server copy to take down).
export class ShareDialog {
  private root: HTMLElement | null = null;
  private deactivateA11y: (() => void) | null = null;
  private unsub: () => void = () => {};

  constructor(private host: HTMLElement, private store: Store, private deps: ShareDialogDeps) {}

  mount(): void {
    this.unsub = this.store.subscribe(['ui'], () => this.sync());
    this.sync();
  }

  destroy(): void {
    this.unsub();
    this.removeRoot();
  }

  private sync(): void {
    const open = this.store.get().ui.shareOpen;
    if (!open) {
      this.removeRoot();
      return;
    }
    if (this.root) return; // already mounted; ignore unrelated ui changes
    this.render();
  }

  private render(): void {
    if (!this.store.get().ui.shareOpen) return;

    const url = `${window.location.origin}/#s=${encodeHash(this.deps.getStratFile())}`;

    const root = document.createElement('div');
    root.className = 'share-dialog';

    const backdrop = document.createElement('div');
    backdrop.className = 'share-dialog-backdrop';
    backdrop.addEventListener('click', () => this.close());

    const panel = document.createElement('div');
    panel.className = 'share-dialog-panel';
    panel.addEventListener('click', (e) => e.stopPropagation());

    const title = document.createElement('div');
    title.className = 'share-dialog-title';
    title.textContent = 'SHARE STRAT';
    panel.appendChild(title);

    const wrap = document.createElement('div');
    wrap.className = 'share-dialog-success';

    const urlRow = document.createElement('div');
    urlRow.className = 'share-dialog-url-row';

    const urlInput = document.createElement('input');
    urlInput.className = 'share-dialog-url';
    urlInput.type = 'text';
    urlInput.readOnly = true;
    urlInput.setAttribute('aria-label', 'Share link URL');
    urlInput.value = url;
    urlInput.addEventListener('focus', () => urlInput.select());

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'share-dialog-copy';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', () => { void this.handleCopy(url, urlInput); });

    urlRow.appendChild(urlInput);
    urlRow.appendChild(copyBtn);
    wrap.appendChild(urlRow);

    const footer = document.createElement('div');
    footer.className = 'share-dialog-footer';
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'share-dialog-done';
    done.textContent = 'Done';
    done.addEventListener('click', () => this.close());
    footer.appendChild(done);
    wrap.appendChild(footer);

    panel.appendChild(wrap);
    root.appendChild(backdrop);
    root.appendChild(panel);
    this.host.appendChild(root);
    this.root = root;
    this.deactivateA11y = activateModalA11y({ panel, title });

    queueMicrotask(() => urlInput.select());
  }

  private async handleCopy(url: string, urlInput: HTMLInputElement): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied');
    } catch {
      urlInput.focus();
      urlInput.select();
      toast.error('Could not copy automatically -- press Ctrl+C / Cmd+C to copy.');
    }
  }

  private close(): void {
    const ui = this.store.get().ui;
    this.store._apply({ ui: { ...ui, shareOpen: false } });
  }

  private removeRoot(): void {
    if (this.deactivateA11y) {
      this.deactivateA11y();
      this.deactivateA11y = null;
    }
    if (this.root && this.root.parentElement) this.root.parentElement.removeChild(this.root);
    this.root = null;
  }
}
