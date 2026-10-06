// Accessibility helpers shared by the whole page:
//  - announce(text): says something to screen readers without showing it (a reply is ready, a setting saved)
//  - watchModal(el) / trapModal(el): while a dialog is open the page behind it is inert (no focus, no
//    clicks, not read), focus moves into the dialog, and it goes back to where it came from when the
//    dialog closes. Dialogs that are already in the page are watched; ones made on the fly call trapModal.

const polite = document.getElementById("sr-status");
const assertive = document.getElementById("sr-alert");

// Setting the text again after a beat makes screen readers read the same sentence twice if asked to
export function announce(text, { urgent = false } = {}) {
  const region = urgent ? assertive : polite;
  if (!region) return;
  region.textContent = "";
  setTimeout(() => (region.textContent = text), 60);
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

const visible = (el) => !el.closest("[hidden], [inert]") && (el.offsetParent !== null || getComputedStyle(el).position === "fixed");
export const focusables = (root) => [...root.querySelectorAll(FOCUSABLE)].filter(visible);

// Kept out of the inert page: the regions that speak to screen readers
const KEEP = "[data-keep-active]";

const open = new Map(); // dialog → { opener, inerted }

export function trapModal(modal, { initial } = {}) {
  if (open.has(modal)) return () => releaseModal(modal);
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const inerted = [];
  for (const el of document.body.children) {
    if (el === modal || el.contains(modal) || el.matches(KEEP) || el.tagName === "SCRIPT" || el.inert) continue;
    el.inert = true;
    inerted.push(el);
  }
  // A dialog that was already in the page when another one opened was made inert along with the rest of the page:
  // it has to be usable now (the other dialog gets it back, inert, when it closes)
  modal.inert = false;
  open.set(modal, { opener, inerted });
  // Focus: what the dialog asks for, else its first control, else the dialog itself
  const target = (initial && modal.querySelector(initial)) || modal.querySelector("[data-autofocus]") || focusables(modal)[0];
  const box = modal.querySelector('[role="dialog"], [role="alertdialog"]') || modal;
  if (target) target.focus({ preventScroll: true });
  else {
    box.tabIndex = -1;
    box.focus({ preventScroll: true });
  }
  return () => releaseModal(modal);
}

export function releaseModal(modal) {
  const state = open.get(modal);
  if (!state) return;
  open.delete(modal);
  for (const el of state.inerted) el.inert = false;
  const { opener } = state;
  // Back to where the person was (unless that is gone, or the page already moved focus somewhere on purpose)
  if (opener?.isConnected && (document.activeElement === document.body || modal.contains(document.activeElement) || !document.activeElement)) opener.focus({ preventScroll: true });
}

// A dialog that is in the page from the start and opens by losing its hidden attribute
export function watchModal(modal) {
  const sync = () => (modal.hidden ? releaseModal(modal) : trapModal(modal, { initial: modal.dataset.modalFocus }));
  new MutationObserver(sync).observe(modal, { attributes: true, attributeFilter: ["hidden"] });
  if (!modal.hidden) sync();
}

// Tab stays inside the open dialog (for the rare case that focus gets out of an inert page)
document.addEventListener("keydown", (e) => {
  if (e.key !== "Tab" || !open.size) return;
  const modal = [...open.keys()].at(-1);
  const items = focusables(modal);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (!modal.contains(document.activeElement)) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});

document.querySelectorAll("[data-modal]").forEach(watchModal);
