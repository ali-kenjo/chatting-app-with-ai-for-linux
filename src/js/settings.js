// Settings panel: open / close / switch tabs. "friends:settings" tells others
// whether it's open and which tab shows (the Robot tab's preview draws only then).
const settingsModal = document.getElementById("settings-modal");
const settingsBtn = document.getElementById("settings-btn");
const settingsClose = document.getElementById("settings-close");

function announce() {
  const tab = document.querySelector(".modal-nav .tab.active")?.dataset.tab || null;
  document.dispatchEvent(new CustomEvent("friends:settings", { detail: { open: !settingsModal.hidden, tab } }));
}

export function openSettings(tab) {
  if (tab) switchTab(tab);
  settingsModal.hidden = false;
  announce();
}

export function closeSettings() {
  if (settingsModal.hidden) return;
  settingsModal.hidden = true;
  announce();
}

function switchTab(name) {
  document.querySelectorAll(".modal-nav .tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".modal-body .pane").forEach((p) => p.classList.toggle("active", p.dataset.pane === name));
  if (!settingsModal.hidden) announce();
}

settingsBtn.addEventListener("click", () => openSettings());
settingsClose.addEventListener("click", closeSettings);

// Close when clicking outside the panel
settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) closeSettings();
});

// Switch between settings sections
document.querySelectorAll(".modal-nav .tab").forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});
