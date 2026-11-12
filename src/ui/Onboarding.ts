import '../styles/onboarding.css';
import { activateModalA11y } from '../app/modalA11y';

/**
 * One-shot first-run tour: dimmed backdrop, outline on the step's target, tooltip
 * card with Skip / Back / Next / Finish. Targets are looked up by selector per
 * step; a missing one (hidden by the responsive layout) falls back to a centred
 * card so the tour still progresses.
 *
 * Not wired into the store: construct, `.start()`, it dismisses itself. main.ts
 * gates on `shouldShowOnboarding()` so it mounts once per browser.
 */

export interface OnboardingStep {
  /** CSS selector for the element to highlight, or null for a centered card. */
  selector: string | null;
  title: string;
  body: string;
}

const DEFAULT_STEPS: OnboardingStep[] = [
  {
    selector: null,
    title: 'Welcome to artifactgg.com',
    body: 'Want a quick look at where everything is? You can skip it. Clearing your site data brings it back.',
  },
  {
    selector: '.tool-rail',
    title: 'Toolrail',
    body: 'Pick a tool here: cursor, draw, shapes, cones, players or text. Its settings show up just below.',
  },
  {
    selector: '.frame-timeline',
    title: 'Frame timeline',
    body: 'A strat is a run of frames. Add one with +, drag cards to reorder them, and click the chip on a card to give it a caption for playback.',
  },
  {
    selector: '.sidebar-map',
    title: 'Map',
    body: 'Switch maps here. Each map keeps its own frames while the tab is open, so you can plan more than one without losing work.',
  },
  {
    selector: '[data-action="share"]',
    title: 'Share',
    body: 'SHARE gives you a link with the whole strat inside it. Nothing is uploaded, so anyone you send it to can open it straight away.',
  },
  {
    selector: '[data-action="library"]',
    title: 'Library',
    body: 'LIB keeps your saved strats in this browser. Ctrl+S saves over the one you have open.',
  },
];

const HIGHLIGHT_PADDING = 6;
const TOOLTIP_OFFSET = 14;
const VIEWPORT_MARGIN = 12;

export class Onboarding {
  private root: HTMLDivElement | null = null;
  private backdrop: HTMLDivElement | null = null;
  private highlight: HTMLDivElement | null = null;
  private tooltip: HTMLDivElement | null = null;
  private deactivateA11y: (() => void) | null = null;
  private stepIdx = 0;
  private onResize: (() => void) | null = null;
  private onKey: ((e: KeyboardEvent) => void) | null = null;

  constructor(
    private host: HTMLElement,
    private steps: OnboardingStep[] = DEFAULT_STEPS,
    private onDismiss: () => void = () => {},
  ) {}

  start(): void {
    if (this.root) return; // already running -- no-op
    this.stepIdx = 0;
    this.buildShell();
    this.renderStep();
  }

  private buildShell(): void {
    const root = document.createElement('div');
    root.className = 'onboarding';

    const backdrop = document.createElement('div');
    backdrop.className = 'onboarding-backdrop';
    // Click-outside dismisses. Mirrors the share/library dialogs.
    backdrop.addEventListener('click', () => this.dismiss());

    const highlight = document.createElement('div');
    highlight.className = 'onboarding-highlight';
    highlight.hidden = true;

    const tooltip = document.createElement('div');
    tooltip.className = 'onboarding-tooltip';
    // The tooltip is the focus-trap panel + the dialog landmark.
    // Stop click bubble so clicking inside the tooltip doesn't dismiss.
    tooltip.addEventListener('click', (e) => e.stopPropagation());

    root.appendChild(backdrop);
    root.appendChild(highlight);
    root.appendChild(tooltip);
    this.host.appendChild(root);

    this.root = root;
    this.backdrop = backdrop;
    this.highlight = highlight;
    this.tooltip = tooltip;

    this.onResize = (): void => this.positionForCurrentStep();
    window.addEventListener('resize', this.onResize);

    this.onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.dismiss();
      }
    };
    document.addEventListener('keydown', this.onKey, true);
  }

  private renderStep(): void {
    const tooltip = this.tooltip;
    if (!tooltip) return;
    const step = this.steps[this.stepIdx];
    if (!step) { this.dismiss(); return; }

    while (tooltip.firstChild) tooltip.removeChild(tooltip.firstChild);

    const title = document.createElement('div');
    title.className = 'onboarding-title';
    title.textContent = step.title;
    tooltip.appendChild(title);

    const body = document.createElement('div');
    body.className = 'onboarding-body';
    body.textContent = step.body;
    tooltip.appendChild(body);

    const meta = document.createElement('div');
    meta.className = 'onboarding-meta';
    meta.textContent = `Step ${this.stepIdx + 1} of ${this.steps.length}`;
    tooltip.appendChild(meta);

    const controls = document.createElement('div');
    controls.className = 'onboarding-controls';

    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'onboarding-skip';
    skip.textContent = 'Skip';
    skip.addEventListener('click', () => this.dismiss());
    controls.appendChild(skip);

    if (this.stepIdx > 0) {
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'onboarding-back';
      back.textContent = 'Back';
      back.addEventListener('click', () => this.goto(this.stepIdx - 1));
      controls.appendChild(back);
    }

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'onboarding-next';
    const isLast = this.stepIdx === this.steps.length - 1;
    next.textContent = isLast ? 'Finish' : 'Next';
    next.addEventListener('click', () => {
      if (isLast) this.dismiss();
      else this.goto(this.stepIdx + 1);
    });
    controls.appendChild(next);

    tooltip.appendChild(controls);

    // Reset focus trap on every step so the new primary action is initially
    // focused. The previous activation (if any) restored focus to its
    // "previously focused" element, which is fine.
    if (this.deactivateA11y) this.deactivateA11y();
    this.deactivateA11y = activateModalA11y({
      panel: tooltip,
      title,
      initialFocus: next,
    });

    this.positionForStep(step);
  }

  private goto(idx: number): void {
    if (idx < 0 || idx >= this.steps.length) return;
    this.stepIdx = idx;
    this.renderStep();
  }

  private positionForCurrentStep(): void {
    const step = this.steps[this.stepIdx];
    if (step) this.positionForStep(step);
  }

  private positionForStep(step: OnboardingStep): void {
    const highlight = this.highlight;
    const tooltip = this.tooltip;
    if (!highlight || !tooltip) return;

    const target = step.selector
      ? document.querySelector<HTMLElement>(step.selector)
      : null;
    const rect = target ? target.getBoundingClientRect() : null;

    if (rect && rect.width > 0 && rect.height > 0) {
      highlight.hidden = false;
      highlight.style.left = `${rect.left - HIGHLIGHT_PADDING}px`;
      highlight.style.top = `${rect.top - HIGHLIGHT_PADDING}px`;
      highlight.style.width = `${rect.width + HIGHLIGHT_PADDING * 2}px`;
      highlight.style.height = `${rect.height + HIGHLIGHT_PADDING * 2}px`;
      this.placeTooltipNear(rect);
    } else {
      // No target (welcome step) or target not rendered in current layout:
      // center the tooltip and hide the highlight.
      highlight.hidden = true;
      tooltip.style.left = '50%';
      tooltip.style.top = '50%';
      tooltip.style.transform = 'translate(-50%, -50%)';
    }
  }

  private placeTooltipNear(target: DOMRect): void {
    const tooltip = this.tooltip;
    if (!tooltip) return;
    // Measure after a layout pass so width/height are honest.
    tooltip.style.left = '0px';
    tooltip.style.top = '0px';
    tooltip.style.transform = 'none';
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Try below the target, then above, then to the right, then to the left,
    // then center as a fallback. First placement that fits wins.
    const candidates: Array<{ x: number; y: number }> = [
      { x: target.left, y: target.bottom + TOOLTIP_OFFSET },
      { x: target.left, y: target.top - th - TOOLTIP_OFFSET },
      { x: target.right + TOOLTIP_OFFSET, y: target.top },
      { x: target.left - tw - TOOLTIP_OFFSET, y: target.top },
    ];
    for (const c of candidates) {
      if (c.x >= VIEWPORT_MARGIN
        && c.y >= VIEWPORT_MARGIN
        && c.x + tw <= vw - VIEWPORT_MARGIN
        && c.y + th <= vh - VIEWPORT_MARGIN
      ) {
        tooltip.style.left = `${c.x}px`;
        tooltip.style.top = `${c.y}px`;
        return;
      }
    }
    // Final fallback -- pin to centre. Better than spilling off-screen.
    tooltip.style.left = '50%';
    tooltip.style.top = '50%';
    tooltip.style.transform = 'translate(-50%, -50%)';
  }

  private dismiss(): void {
    if (!this.root) return;
    if (this.deactivateA11y) {
      this.deactivateA11y();
      this.deactivateA11y = null;
    }
    if (this.onResize) window.removeEventListener('resize', this.onResize);
    if (this.onKey) document.removeEventListener('keydown', this.onKey, true);
    this.onResize = null;
    this.onKey = null;
    if (this.root.parentElement) this.root.parentElement.removeChild(this.root);
    this.root = null;
    this.backdrop = null;
    this.highlight = null;
    this.tooltip = null;
    this.onDismiss();
  }
}
