const header = document.querySelector("[data-header]");
const menuButton = document.querySelector(".menu-button");
const nav = document.querySelector("#site-nav");
const revealItems = document.querySelectorAll("[data-reveal]");

const closeMenu = () => {
  menuButton?.setAttribute("aria-expanded", "false");
  nav?.classList.remove("open");
  document.body.classList.remove("menu-open");
};

menuButton?.addEventListener("click", () => {
  const isOpen = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!isOpen));
  nav?.classList.toggle("open", !isOpen);
  document.body.classList.toggle("menu-open", !isOpen);
});

nav?.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));

window.addEventListener(
  "scroll",
  () => header?.classList.toggle("scrolled", window.scrollY > 24),
  { passive: true },
);

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.01, rootMargin: "0px 0px 80px" },
  );

  revealItems.forEach((item) => observer.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("visible"));
}

document.querySelectorAll("[data-year]").forEach((item) => {
  item.textContent = new Date().getFullYear();
});

const sectionIds = ["about", "work", "academy", "leadership", "contact"];
const navLinks = [...(nav?.querySelectorAll("[data-nav]") || [])];
const sections = sectionIds
  .map((id) => document.getElementById(id))
  .filter(Boolean);

const setCurrentNav = (id) => {
  navLinks.forEach((link) => {
    link.classList.toggle("is-current", link.dataset.nav === id);
  });
};

if (sections.length && "IntersectionObserver" in window) {
  const navObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible?.target?.id) setCurrentNav(visible.target.id);
    },
    { threshold: [0.18, 0.4, 0.6], rootMargin: "-20% 0px -45% 0px" },
  );
  sections.forEach((section) => navObserver.observe(section));
}

const approachItems = [...document.querySelectorAll(".approach-list article")];
if (approachItems.length && "IntersectionObserver" in window) {
  const approachObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      approachItems.forEach((item) => {
        item.classList.toggle("is-active", item === visible.target);
      });
    },
    { threshold: 0.55, rootMargin: "-20% 0px -25% 0px" },
  );
  approachItems.forEach((item) => approachObserver.observe(item));
  approachItems[0].classList.add("is-active");
}

const focusGrid = document.querySelector(".focus-grid");
const focusCards = [...document.querySelectorAll(".focus-card")];
if (focusGrid && focusCards.length) {
  const clearFocusHover = () => {
    focusGrid.classList.remove("has-focus-hover");
    focusCards.forEach((card) => card.classList.remove("is-hovered"));
  };

  focusGrid.addEventListener("pointerover", (event) => {
    const card = event.target.closest(".focus-card");
    if (!card || !focusGrid.contains(card)) return;
    focusGrid.classList.add("has-focus-hover");
    focusCards.forEach((item) => item.classList.toggle("is-hovered", item === card));
  });

  focusGrid.addEventListener("pointerout", (event) => {
    const fromCard = event.target.closest(".focus-card");
    if (!fromCard) return;
    const toNode = event.relatedTarget;
    const toEl = toNode && toNode.nodeType === 1 ? toNode : toNode?.parentElement;
    const toCard = toEl?.closest?.(".focus-card");
    if (toCard && focusGrid.contains(toCard)) return;
    clearFocusHover();
  });

  focusGrid.addEventListener("focusin", (event) => {
    const card = event.target.closest(".focus-card");
    if (!card) return;
    focusGrid.classList.add("has-focus-hover");
    focusCards.forEach((item) => item.classList.toggle("is-hovered", item === card));
  });

  focusGrid.addEventListener("focusout", (event) => {
    const next = event.relatedTarget?.closest?.(".focus-card");
    if (next && focusGrid.contains(next)) return;
    clearFocusHover();
  });
}
