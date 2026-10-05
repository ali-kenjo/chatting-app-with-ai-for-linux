// ---------- A question before something that can't be undone ----------
// confirmDialog({ title, message, confirm, cancel, danger }) → Promise<boolean>.
// An accessible dialog (the page behind it is inert, focus goes in and comes back, Esc cancels).
// With danger, the safe answer (cancel) has the focus.
import { t } from "./i18n.js";
import { trapModal } from "./a11y.js";

let counter = 0;

export function confirmDialog({ title, message, confirm = t("Confirm"), cancel = t("Cancel"), danger = false }) {
  return new Promise((resolve) => {
    const id = `confirm-${++counter}`;
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop confirm-backdrop";
    backdrop.innerHTML = `
      <div class="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="${id}-title" aria-describedby="${id}-text">
        <div class="confirm-body">
          <h2 id="${id}-title"></h2>
          <p id="${id}-text"></p>
          <div class="confirm-actions">
            <button type="button" class="btn" data-answer="no"></button>
            <button type="button" class="btn ${danger ? "btn-danger solid" : "btn-primary"}" data-answer="yes"></button>
          </div>
        </div>
      </div>`;
    backdrop.querySelector("h2").textContent = title;
    backdrop.querySelector("p").textContent = message;
    backdrop.querySelector('[data-answer="no"]').textContent = cancel;
    backdrop.querySelector('[data-answer="yes"]').textContent = confirm;
    document.body.append(backdrop);

    let release = null;
    const finish = (answer) => {
      document.removeEventListener("keydown", onKey, true);
      release?.();
      backdrop.remove();
      resolve(answer);
    };
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      finish(false);
    };
    document.addEventListener("keydown", onKey, true);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) finish(false);
      const answer = e.target.closest("[data-answer]")?.dataset.answer;
      if (answer) finish(answer === "yes");
    });
    release = trapModal(backdrop, { initial: danger ? '[data-answer="no"]' : '[data-answer="yes"]' });
  });
}
