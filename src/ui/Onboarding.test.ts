import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { Onboarding, type OnboardingStep } from './Onboarding';

function makeSteps(): OnboardingStep[] {
  return [
    { selector: null, title: 'Welcome', body: 'hi' },
    { selector: '.test-target', title: 'Toolrail', body: 'pick a tool' },
    { selector: '.test-target', title: 'Done', body: 'all set' },
  ];
}

describe('Onboarding', () => {
  let host: HTMLElement;
  let target: HTMLElement;
  let tour: Onboarding;
  let onDismiss: Mock<() => void>;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    target = document.createElement('div');
    target.className = 'test-target';
    target.style.cssText = 'position:absolute;left:100px;top:100px;width:80px;height:40px;';
    document.body.appendChild(target);
    // jsdom returns an all-zero DOMRect for any element regardless of CSS,
    // so the positioning code treats every target as "no rect" and falls back
    // to centring. Stub a positive rect so the highlight-visible assertions
    // exercise the real path.
    target.getBoundingClientRect = (): DOMRect => ({
      x: 100, y: 100, width: 80, height: 40,
      left: 100, top: 100, right: 180, bottom: 140,
      toJSON() { return this; },
    } as DOMRect);
    onDismiss = vi.fn();
    tour = new Onboarding(host, makeSteps(), onDismiss);
  });

  afterEach(() => {
    // Idempotent on already-dismissed tours.
    document.querySelector('.onboarding')?.remove();
    if (host.parentElement) host.parentElement.removeChild(host);
    if (target.parentElement) target.parentElement.removeChild(target);
  });

  it('renders nothing before start() is called', () => {
    expect(host.querySelector('.onboarding')).toBeNull();
  });

  it('renders the welcome step on start (no highlight, centered tooltip)', () => {
    tour.start();
    expect(host.querySelector('.onboarding')).not.toBeNull();
    expect((host.querySelector('.onboarding-highlight') as HTMLElement).hidden).toBe(true);
    const title = host.querySelector('.onboarding-title');
    expect(title!.textContent).toBe('Welcome');
  });

  it('Next button advances to the next step and surfaces the highlight', () => {
    tour.start();
    (host.querySelector('.onboarding-next') as HTMLButtonElement).click();
    const title = host.querySelector('.onboarding-title');
    expect(title!.textContent).toBe('Toolrail');
    expect((host.querySelector('.onboarding-highlight') as HTMLElement).hidden).toBe(false);
  });

  it('Back button reappears after step 0 and walks back', () => {
    tour.start();
    expect(host.querySelector('.onboarding-back')).toBeNull();
    (host.querySelector('.onboarding-next') as HTMLButtonElement).click();
    expect(host.querySelector('.onboarding-back')).not.toBeNull();
    (host.querySelector('.onboarding-back') as HTMLButtonElement).click();
    expect(host.querySelector('.onboarding-title')!.textContent).toBe('Welcome');
  });

  it('Skip dismisses and calls onDismiss', () => {
    tour.start();
    (host.querySelector('.onboarding-skip') as HTMLButtonElement).click();
    expect(host.querySelector('.onboarding')).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('the last step shows Finish and dismisses on click', () => {
    tour.start();
    (host.querySelector('.onboarding-next') as HTMLButtonElement).click(); // step 1
    (host.querySelector('.onboarding-next') as HTMLButtonElement).click(); // step 2 (last)
    const next = host.querySelector('.onboarding-next') as HTMLButtonElement;
    expect(next.textContent).toBe('Finish');
    next.click();
    expect(host.querySelector('.onboarding')).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('Escape dismisses the tour', () => {
    tour.start();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(host.querySelector('.onboarding')).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('clicking the backdrop dismisses', () => {
    tour.start();
    (host.querySelector('.onboarding-backdrop') as HTMLDivElement).click();
    expect(host.querySelector('.onboarding')).toBeNull();
  });

  it('clicking inside the tooltip does NOT dismiss (stopPropagation)', () => {
    tour.start();
    (host.querySelector('.onboarding-tooltip') as HTMLDivElement).click();
    expect(host.querySelector('.onboarding')).not.toBeNull();
  });

  it('shows step counter "1 of 3" on the welcome step', () => {
    tour.start();
    expect(host.querySelector('.onboarding-meta')!.textContent).toBe('Step 1 of 3');
  });

  it('start() is idempotent -- a second call does not stack two overlays', () => {
    tour.start();
    tour.start();
    expect(host.querySelectorAll('.onboarding').length).toBe(1);
  });

  it('falls back to a centered tooltip when the target selector matches nothing', () => {
    const steps: OnboardingStep[] = [
      { selector: '.does-not-exist', title: 'Missing', body: 'no target' },
    ];
    const local = new Onboarding(host, steps);
    local.start();
    expect((host.querySelector('.onboarding-highlight') as HTMLElement).hidden).toBe(true);
    const tooltip = host.querySelector('.onboarding-tooltip') as HTMLElement;
    // Centre fallback uses translate(-50%, -50%).
    expect(tooltip.style.transform).toContain('translate(-50%, -50%)');
  });
});
