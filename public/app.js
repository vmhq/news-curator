// ═══════════════════════════════════════
// El Resumen — App Logic
// ═══════════════════════════════════════

document.addEventListener("DOMContentLoaded", () => {
  // ─── Theme Toggle ───
  const html = document.documentElement;
  const themeBtn = document.getElementById("themeToggle");
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

  // Migrate legacy "theme" key (light/dark) → "themeMode"
  const legacyTheme = localStorage.getItem("theme");
  if (legacyTheme && !localStorage.getItem("themeMode")) {
    localStorage.setItem("themeMode", legacyTheme);
    localStorage.removeItem("theme");
  }

  function applyMode(mode) {
    const effective = mode === "auto" ? (systemDark.matches ? "dark" : "light") : mode;
    html.dataset.theme = effective;
    html.dataset.themeMode = mode;
  }

  applyMode(localStorage.getItem("themeMode") ?? "auto");

  // Keep auto mode in sync if the OS preference changes
  systemDark.addEventListener("change", () => {
    if ((localStorage.getItem("themeMode") ?? "auto") === "auto") applyMode("auto");
  });

  themeBtn?.addEventListener("click", () => {
    const current = localStorage.getItem("themeMode") ?? "auto";
    const next = current === "auto" ? "light" : current === "light" ? "dark" : "auto";
    localStorage.setItem("themeMode", next);
    applyMode(next);
  });

  // ─── Search ───
  const searchInput = document.getElementById("searchInput");
  const searchResults = document.getElementById("searchResults");
  let debounceTimer;

  searchInput?.addEventListener("input", (e) => {
    clearTimeout(debounceTimer);
    const q = e.target.value.trim();
    if (q.length < 2) {
      searchResults.classList.remove("active");
      searchResults.innerHTML = "";
      return;
    }
    debounceTimer = setTimeout(() => fetchResults(q), 300);
  });

  searchInput?.addEventListener("focus", () => {
    if (searchInput.value.trim().length >= 2) {
      searchResults.classList.add("active");
    }
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-box")) {
      searchResults?.classList.remove("active");
    }
  });

  function esc(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  async function fetchResults(q) {
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      searchResults.innerHTML = "";
      if (!data.results || !data.results.length) {
        const empty = document.createElement("div");
        empty.className = "search-result";
        const span = document.createElement("span");
        span.className = "search-result-snippet";
        span.textContent = "Sin resultados";
        empty.appendChild(span);
        searchResults.appendChild(empty);
      } else {
        for (const r of data.results) {
          const a = document.createElement("a");
          a.href = `/curacion/${encodeURIComponent(r.date)}`;
          a.className = "search-result";

          const dateSpan = document.createElement("span");
          dateSpan.className = "search-result-date";
          dateSpan.textContent = r.date;

          // snippet comes pre-escaped from server with only <mark> tags allowed
          const snippetSpan = document.createElement("span");
          snippetSpan.className = "search-result-snippet";
          snippetSpan.innerHTML = r.snippet;

          a.appendChild(dateSpan);
          a.appendChild(snippetSpan);
          searchResults.appendChild(a);
        }
      }
      searchResults.classList.add("active");
    } catch (err) {
      console.error("Search error:", err);
    }
  }

  // ─── Scroll to Top ───
  const scrollTopBtn = document.getElementById("scrollTopBtn");
  window.addEventListener("scroll", () => {
    if (window.scrollY > 300) {
      scrollTopBtn?.classList.add("visible");
    } else {
      scrollTopBtn?.classList.remove("visible");
    }
  });
  scrollTopBtn?.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // ─── Mobile Menu ───
  const hamburger = document.getElementById("hamburgerBtn");
  const mobileMenu = document.getElementById("mobileMenu");
  hamburger?.addEventListener("click", () => {
    mobileMenu?.classList.toggle("active");
  });

  // Close mobile menu on link click
  mobileMenu?.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", () => mobileMenu.classList.remove("active"));
  });
});
