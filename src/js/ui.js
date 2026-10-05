// Small things the panels share.

// Grey bars where a list will be, until the helper has answered (the lists replace them)
export function skeleton(tag = "div") {
  const el = document.createElement(tag);
  el.className = "skeleton-list";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = "<i></i><i></i><i></i>";
  return el;
}
