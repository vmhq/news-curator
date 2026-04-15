// Theme initialization — runs synchronously in <head> to prevent dark mode flash.
// Must stay tiny and dependency-free.
(function () {
  try {
    var mode = localStorage.getItem("themeMode") || "auto";
    var dark =
      mode === "dark" ||
      (mode === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    var el = document.documentElement;
    el.dataset.theme = dark ? "dark" : "light";
    el.dataset.themeMode = mode;
  } catch (e) {}
})();
