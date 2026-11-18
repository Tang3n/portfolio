// Theme switch: system (default) → light → dark → system.
// The choice is stored in localStorage; the inline script in <head> applies it
// before the first paint, so the page never flashes the wrong theme.
(() => {
    const button = document.getElementById("theme");
    if (!button) return;

    const root = document.documentElement;
    const order = ["system", "light", "dark"];
    const icons = { system: "◐", light: "☀", dark: "☾" };
    const labels = JSON.parse(button.dataset.labels);
    const current = () => root.dataset.theme || "system";

    function render() {
        const theme = current();
        button.textContent = icons[theme];
        button.setAttribute("aria-label", labels[theme]);
        button.title = labels[theme];
    }

    button.addEventListener("click", () => {
        const next = order[(order.indexOf(current()) + 1) % order.length];
        if (next === "system") delete root.dataset.theme;
        else root.dataset.theme = next;
        try {
            if (next === "system") localStorage.removeItem("theme");
            else localStorage.setItem("theme", next);
        } catch {
            // storage blocked (private window): the choice just won't persist
        }
        render();
    });

    render();
    button.hidden = false; // stays hidden without JavaScript
})();
