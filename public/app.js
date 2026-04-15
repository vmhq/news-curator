// ═══════════════════════════════════════
// Daily Brief — App Logic
// ═══════════════════════════════════════

document.addEventListener("DOMContentLoaded", () => {

  // ─── Theme Toggle ─────────────────────────────────────────────
  const html = document.documentElement;
  const themeBtn = document.getElementById("themeToggle");
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

  // Migrate legacy "theme" key → "themeMode"
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

  systemDark.addEventListener("change", () => {
    if ((localStorage.getItem("themeMode") ?? "auto") === "auto") applyMode("auto");
  });

  themeBtn?.addEventListener("click", () => {
    const current = localStorage.getItem("themeMode") ?? "auto";
    const next = current === "auto" ? "light" : current === "light" ? "dark" : "auto";
    localStorage.setItem("themeMode", next);
    applyMode(next);
  });

  // ─── Skeleton Loading (hero image) ────────────────────────────
  const heroWrap = document.getElementById("heroImageWrap");
  const heroImg  = document.getElementById("heroImg");

  if (heroWrap && heroImg) {
    if (heroImg.complete && heroImg.naturalWidth > 0) {
      // Already loaded before DOMContentLoaded
      heroWrap.classList.remove("loading");
      heroImg.style.opacity = "1";
    } else {
      heroImg.addEventListener("load", () => {
        heroWrap.classList.remove("loading");
        heroImg.style.opacity = "1";
      });
      heroImg.addEventListener("error", () => {
        heroWrap.classList.remove("loading");
        heroWrap.innerHTML = '<div class="hero-image-placeholder"><span class="hero-emoji">📰</span></div>';
      });
    }
  }

  // ─── Heading IDs + Anchor Links ───────────────────────────────
  const articleBody = document.querySelector(".article-body");
  const usedIds = new Set();

  function slugify(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 60) || "section";
  }

  function uniqueId(base) {
    if (!usedIds.has(base)) { usedIds.add(base); return base; }
    let i = 2;
    while (usedIds.has(`${base}-${i}`)) i++;
    const id = `${base}-${i}`;
    usedIds.add(id);
    return id;
  }

  const tocHeadings = []; // [{id, text, level}]

  if (articleBody) {
    const headings = articleBody.querySelectorAll("h2, h3");
    headings.forEach((h) => {
      const rawText = h.textContent.trim();
      const id = uniqueId(slugify(rawText));
      h.id = id;

      // Anchor link

      tocHeadings.push({ id, text: rawText, level: h.tagName });
    });
  }

  // ─── Table of Contents ────────────────────────────────────────
  const tocContainer = document.getElementById("tocContainer");
  const tocNav       = document.getElementById("tocNav");

  // Only show TOC if there are at least 2 h2 sections
  const h2Entries = tocHeadings.filter(h => h.level === "H2");

  if (tocContainer && tocNav && h2Entries.length >= 2) {
    tocHeadings.forEach(({ id, text, level }) => {
      // Strip leading emoji sequences and common prefixes like "🔥 Featured Story:"
      const cleanText = text.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]+\s*/u, "").trim();
      const a = document.createElement("a");
      a.href = `#${id}`;
      a.className = `toc-item${level === "H3" ? " toc-h3" : ""}`;
      a.textContent = cleanText || text;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const target = document.getElementById(id);
        if (target) {
          history.pushState(null, "", `#${id}`);
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
      tocNav.appendChild(a);
    });

    tocContainer.hidden = false;

    // Highlight active section with IntersectionObserver
    const tocItems = tocNav.querySelectorAll(".toc-item");
    const headingEls = tocHeadings
      .map(({ id }) => document.getElementById(id))
      .filter(Boolean);

    let activeId = null;

    const observer = new IntersectionObserver(
      (entries) => {
        // Find the topmost intersecting heading
        let topEntry = null;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (!topEntry || entry.boundingClientRect.top < topEntry.boundingClientRect.top) {
              topEntry = entry;
            }
          }
        }
        if (topEntry) {
          activeId = topEntry.target.id;
          tocItems.forEach((item) => {
            const isActive = item.getAttribute("href") === `#${activeId}`;
            item.classList.toggle("active", isActive);
          });
        }
      },
      { rootMargin: "-10% 0% -75% 0%", threshold: 0 }
    );

    headingEls.forEach((el) => observer.observe(el));
  }

  // ─── Mobile Floating TOC ──────────────────────────────────────
  const mobileTocBtn     = document.getElementById("mobileTocBtn");
  const mobileTocPanel   = document.getElementById("mobileTocPanel");
  const mobileTocClose   = document.getElementById("mobileTocClose");
  const mobileTocBackdrop = document.getElementById("mobileTocBackdrop");
  const mobileTocNavEl   = document.getElementById("mobileTocNav");

  if (mobileTocNavEl && h2Entries.length >= 2) {
    // Populate with the same headings as the desktop TOC
    tocHeadings.forEach(({ id, text, level }) => {
      const cleanText = text.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]+\s*/u, "").trim();
      const a = document.createElement("a");
      a.href = `#${id}`;
      a.className = `mobile-toc-item${level === "H3" ? " mobile-toc-h3" : ""}`;
      a.textContent = cleanText || text;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        closeMobileToc();
        const target = document.getElementById(id);
        if (target) {
          history.pushState(null, "", `#${id}`);
          // Small delay lets the panel animate closed before scroll
          setTimeout(() => target.scrollIntoView({ behavior: "smooth", block: "start" }), 180);
        }
      });
      mobileTocNavEl.appendChild(a);
    });

    // Show the FAB
    mobileTocBtn?.classList.add("visible");
  }

  function openMobileToc() {
    mobileTocPanel?.classList.add("open");
    mobileTocPanel?.setAttribute("aria-hidden", "false");
    mobileTocBtn?.setAttribute("aria-expanded", "true");
  }

  function closeMobileToc() {
    mobileTocPanel?.classList.remove("open");
    mobileTocPanel?.setAttribute("aria-hidden", "true");
    mobileTocBtn?.setAttribute("aria-expanded", "false");
  }

  mobileTocBtn?.addEventListener("click", () => {
    mobileTocPanel?.classList.contains("open") ? closeMobileToc() : openMobileToc();
  });

  mobileTocClose?.addEventListener("click", closeMobileToc);
  mobileTocBackdrop?.addEventListener("click", closeMobileToc);

  // Close on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && mobileTocPanel?.classList.contains("open")) closeMobileToc();
  });

  // ─── Relative Dates (sidebar) ─────────────────────────────────
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  document.querySelectorAll(".recent-date[data-iso]").forEach((el) => {
    const iso = el.dataset.iso;
    if (!iso) return;
    // Extract the date part (strip time suffix like _HH-MM)
    const datePart = iso.replace(/_\d{2}-\d{2}$/, "");
    const itemDate = new Date(datePart + "T12:00:00");
    if (isNaN(itemDate.getTime())) return;

    const diffMs   = today.getTime() - itemDate.getTime();
    const diffDays = Math.round(diffMs / 86_400_000);

    let label;
    if (diffDays === 0)       label = "Hoy";
    else if (diffDays === 1)  label = "Ayer";
    else if (diffDays <= 6)   label = `Hace ${diffDays} días`;
    else if (diffDays <= 13)  label = "Hace 1 semana";
    else if (diffDays <= 27)  label = `Hace ${Math.floor(diffDays / 7)} semanas`;
    else if (diffDays <= 59)  label = "Hace 1 mes";
    else                      label = `Hace ${Math.floor(diffDays / 30)} meses`;

    // Keep the full date as a tooltip
    el.title = el.textContent;
    el.textContent = label;
  });

  // ─── Command Palette ──────────────────────────────────────────
  const cmdTrigger  = document.getElementById("cmdTrigger");
  const cmdOverlay  = document.getElementById("cmdOverlay");
  const cmdInput    = document.getElementById("cmdInput");
  const cmdResults  = document.getElementById("cmdResults");
  const recentDataEl = document.getElementById("recentData");

  // Parse recent editions embedded in the page
  let recentEditions = [];
  try {
    recentEditions = JSON.parse(recentDataEl?.dataset.recent || "[]");
  } catch { /* ignore */ }

  let debounceTimer;
  let selectedIndex = -1;
  let currentItems  = [];

  function openPalette() {
    cmdOverlay.classList.add("active");
    cmdInput.value = "";
    selectedIndex = -1;
    showRecent();
    // Defer focus slightly so the CSS transition doesn't steal it
    setTimeout(() => cmdInput.focus(), 30);
  }

  function closePalette() {
    cmdOverlay.classList.remove("active");
    cmdInput.value = "";
    cmdResults.innerHTML = "";
    selectedIndex = -1;
    currentItems = [];
  }

  function showRecent() {
    cmdResults.innerHTML = "";
    selectedIndex = -1;
    currentItems = [];

    if (!recentEditions.length) {
      const empty = document.createElement("p");
      empty.className = "cmd-empty";
      empty.textContent = "Escribe para buscar ediciones…";
      cmdResults.appendChild(empty);
      return;
    }

    const label = document.createElement("div");
    label.className = "cmd-section-label";
    label.textContent = "Ediciones recientes";
    cmdResults.appendChild(label);

    recentEditions.forEach((ed) => {
      const a = buildCmdItem(ed.dateFormatted, ed.summary, "", ed.url);
      cmdResults.appendChild(a);
      currentItems.push(a);
    });
  }

  function buildCmdItem(dateLabel, title, snippet, url) {
    const a = document.createElement("a");
    a.href = url;
    a.className = "cmd-item";

    const dateEl = document.createElement("span");
    dateEl.className = "cmd-item-date";
    dateEl.textContent = dateLabel;

    const titleEl = document.createElement("span");
    titleEl.className = "cmd-item-title";
    titleEl.textContent = title;

    a.appendChild(dateEl);
    a.appendChild(titleEl);

    if (snippet) {
      const snipEl = document.createElement("span");
      snipEl.className = "cmd-item-snippet";
      snipEl.innerHTML = snippet; // pre-escaped by server
      a.appendChild(snipEl);
    }

    a.addEventListener("mouseenter", () => {
      setSelected(currentItems.indexOf(a));
    });

    return a;
  }

  function setSelected(index) {
    currentItems.forEach((item, i) => {
      item.classList.toggle("selected", i === index);
    });
    selectedIndex = index;
  }

  function esc(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  async function fetchResults(q) {
    try {
      const res  = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      cmdResults.innerHTML = "";
      selectedIndex = -1;
      currentItems  = [];

      if (!data.results?.length) {
        const empty = document.createElement("p");
        empty.className = "cmd-empty";
        empty.textContent = "Sin resultados para esta búsqueda.";
        cmdResults.appendChild(empty);
        return;
      }

      const label = document.createElement("div");
      label.className = "cmd-section-label";
      label.textContent = `${data.results.length} resultado${data.results.length !== 1 ? "s" : ""}`;
      cmdResults.appendChild(label);

      for (const r of data.results) {
        const a = buildCmdItem(r.date, r.summary || r.date, r.snippet, `/curacion/${encodeURIComponent(r.date)}`);
        cmdResults.appendChild(a);
        currentItems.push(a);
      }
    } catch (err) {
      console.error("Search error:", err);
    }
  }

  // Keyboard navigation inside palette
  cmdInput?.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected(Math.min(selectedIndex + 1, currentItems.length - 1));
      currentItems[selectedIndex]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected(Math.max(selectedIndex - 1, 0));
      currentItems[selectedIndex]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      if (selectedIndex >= 0 && currentItems[selectedIndex]) {
        window.location.href = currentItems[selectedIndex].href;
      }
    } else if (e.key === "Escape") {
      closePalette();
    }
  });

  cmdInput?.addEventListener("input", (e) => {
    clearTimeout(debounceTimer);
    const q = e.target.value.trim();
    if (q.length < 2) {
      showRecent();
      return;
    }
    debounceTimer = setTimeout(() => fetchResults(q), 280);
  });

  // Open/close triggers
  cmdTrigger?.addEventListener("click", openPalette);

  cmdOverlay?.addEventListener("click", (e) => {
    if (e.target === cmdOverlay) closePalette();
  });

  document.addEventListener("keydown", (e) => {
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    const modKey = isMac ? e.metaKey : e.ctrlKey;
    if (modKey && e.key === "k") {
      e.preventDefault();
      if (cmdOverlay.classList.contains("active")) {
        closePalette();
      } else {
        openPalette();
      }
    }
    if (e.key === "Escape" && cmdOverlay?.classList.contains("active")) {
      closePalette();
    }
  });

  // ─── Reading Progress Bar ──────────────────────────────────────
  const readProgress  = document.getElementById("readProgress");
  const scrollTopBtn  = document.getElementById("scrollTopBtn");

  window.addEventListener("scroll", () => {
    if (readProgress) {
      const scrollTop  = window.scrollY;
      const docHeight  = document.documentElement.scrollHeight - window.innerHeight;
      readProgress.style.width = docHeight > 0 ? `${Math.min((scrollTop / docHeight) * 100, 100)}%` : "0%";
    }
    if (scrollTopBtn) {
      scrollTopBtn.classList.toggle("visible", window.scrollY > 300);
    }
  }, { passive: true });

  scrollTopBtn?.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // ─── Mobile Menu ──────────────────────────────────────────────
  const hamburger  = document.getElementById("hamburgerBtn");
  const mobileMenu = document.getElementById("mobileMenu");

  hamburger?.addEventListener("click", () => {
    mobileMenu?.classList.toggle("active");
  });

  mobileMenu?.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", () => mobileMenu.classList.remove("active"));
  });

});
