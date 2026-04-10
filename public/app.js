// ═══════════════════════════════════════
// El Resumen — App Logic
// ═══════════════════════════════════════

document.addEventListener("DOMContentLoaded", () => {
  // ─── Theme Toggle ───
  const html = document.documentElement;
  const themeBtn = document.getElementById("themeToggle");

  const savedTheme = localStorage.getItem("theme");
  if (savedTheme) {
    html.dataset.theme = savedTheme;
  } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    html.dataset.theme = "dark";
  }

  themeBtn?.addEventListener("click", () => {
    const next = html.dataset.theme === "dark" ? "light" : "dark";
    html.dataset.theme = next;
    localStorage.setItem("theme", next);
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
      if (!data.results.length) {
        searchResults.innerHTML = '<div class="search-result"><span class="search-result-snippet">Sin resultados</span></div>';
      } else {
        searchResults.innerHTML = data.results.map((r) => `
          <a href="/curacion/${encodeURIComponent(r.date)}" class="search-result">
            <span class="search-result-date">${esc(r.date)}</span>
            <span class="search-result-snippet">${r.snippet}</span>
          </a>
        `).join("");
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
