/**
 * dsh-quota-bar browser half: the GLM quota dock bar (prototype variant A,
 * winner of the slot/form bake-off — see issue #1 and branch proto/quota-bar-slots).
 *
 * Renders into conversation.input.dock (order 12, beside GoalBar):
 *   ⚡ GLM  5h [▮] 42% 14:30   7d [▮] 71% Mon 18 09:00   🔧 [▮] 12% Mon 25 00:00
 *
 * Data: GET /dsh-quota-bar/reading (host half fetches upstream; this only
 * talks to the same origin). 60s poll + refetch on window focus. Silent
 * degrade: never had a reading -> render nothing; stale -> dim everything.
 */
window.__ModuleLoader__.load({
  id: "@s2p2/dsh-quota-bar",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");
    const h = React.createElement;

    /* ---------------- data store ---------------- */

    const REFRESH_MS = 60_000;

    let snap = { reading: null, fetchedAt: 0, stale: true, error: null };
    const subs = new Set();
    const emit = () => subs.forEach((f) => f());

    async function poll() {
      try {
        const resp = await fetch("/dsh-quota-bar/reading", { cache: "no-store" });
        if (!resp.ok) return;
        const next = await resp.json();
        if (next && typeof next === "object") {
          snap = {
            reading: next.reading || null,
            fetchedAt: next.fetchedAt || 0,
            stale: !!next.stale,
            error: next.error || null,
          };
          emit();
        }
      } catch {
        /* silent degrade: keep the last snapshot, mark nothing */
      }
    }

    const useStore = () =>
      React.useSyncExternalStore(
        (f) => {
          subs.add(f);
          return () => subs.delete(f);
        },
        () => snap
      );

    /* ---------------- formatting (pi statusline conventions) ---------------- */

    const two = (n) => String(n).padStart(2, "0");
    const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const fmtClock = (ms) => {
      const d = new Date(ms);
      return two(d.getHours()) + ":" + two(d.getMinutes());
    };
    const fmtDay = (ms) => {
      const d = new Date(ms);
      return DOW[d.getDay()] + " " + two(d.getDate()) + " " + fmtClock(ms);
    };

    /* ---------------- dock bar ---------------- */

    // Theme-native via DSW design-token aliases (what GoalBar itself uses),
    // each with a literal fallback for themes that lack the variable.
    const DIM = "var(--dsw-alias-label-tertiary, #8b949e)";
    const TRACK = "var(--dsw-alias-border-l1, #30363d)";
    const BORDER = "var(--dsw-alias-border-l1, #21262d)";
    const BG = "var(--dsw-alias-bg-base, #000000)";
    const MONO = "ui-monospace, SFmono-Regular, Menlo, monospace";
    const col = (p) =>
      p < 50
        ? "var(--dsw-alias-state-success-primary, #3fb950)"
        : p < 80
          ? "var(--dsw-alias-state-warn-primary, #d29922)"
          : "var(--dsw-alias-state-error-primary, #f85149)";

    const Bar = ({ pct, w }) =>
      h(
        "span",
        {
          style: {
            display: "inline-block",
            width: (w || 46) + "px",
            height: "4px",
            borderRadius: "2px",
            background: TRACK,
            verticalAlign: "middle",
            position: "relative",
            overflow: "hidden",
          },
        },
        h("span", {
          style: {
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: Math.min(100, pct) + "%",
            background: col(pct),
          },
        })
      );

    const WINDOWS = [
      { key: "fiveHour", label: "5h", resetFmt: fmtClock },
      { key: "weekly", label: "7d", resetFmt: fmtDay },
      { key: "tools", label: "\u{1F527}", resetFmt: fmtDay },
    ];

    const QuotaBar = () => {
      const s = useStore();
      // Silent degrade: no reading ever -> render nothing at all.
      if (!s.reading) return null;
      const dim = s.stale ? "0.45" : "1";
      const seg = (w) => {
        const d = s.reading[w.key];
        if (!d) return null;
        return h(
          "span",
          { style: { whiteSpace: "nowrap" } },
          h("span", { style: { color: DIM, fontSize: "10px", marginRight: "4px" } }, w.label),
          d.pct === null ? null : h(Bar, { pct: d.pct }),
          d.pct === null
            ? null
            : h(
                "span",
                {
                  style: {
                    color: col(d.pct),
                    fontSize: "10px",
                    fontVariantNumeric: "tabular-nums",
                    marginLeft: "4px",
                  },
                },
                d.pct + "%"
              ),
          d.resetAt === null
            ? null
            : h(
                "span",
                { style: { color: DIM, fontSize: "10px", marginLeft: "5px" } },
                w.resetFmt(d.resetAt)
              )
        );
      };
      // GoalBar's dock pattern: wrapper inset to the composer card's bounds,
      // then an opaque floating card (—dsw-specific-tip surface) centered in
      // it. A full-width strip with bg-base left a translucent seam over
      // scrolled text; a floating card has no seam.
      return h(
        "div",
        {
          style: {
            boxSizing: "border-box",
            width:
              "calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset))",
            margin: "0 auto",
          },
        },
        h(
          "div",
          {
            title: s.error ? "last error: " + s.error : undefined,
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "12px",
              margin: "0 auto",
              padding: "3px 14px",
              border: "1px solid " + BORDER,
              borderRadius: "10px",
              background: "var(--dsw-specific-tip, " + BG + ")",
              fontFamily: MONO,
              userSelect: "none",
              opacity: dim,
              transition: "opacity .3s",
            },
          },
          h("span", { style: { color: DIM, fontSize: "10px", marginRight: "2px" } }, "\u26A1 GLM"),
          WINDOWS.map((w) => seg(w))
        )
      );
    };

    /* ---------------- registration ---------------- */

    exports.inject = ["slots"];
    exports.apply = (ctx) => {
      poll();
      const timer = setInterval(poll, REFRESH_MS);
      const onFocus = () => {
        if (document.visibilityState === "visible") poll();
      };
      document.addEventListener("visibilitychange", onFocus);
      ctx.slots.inject("conversation.input.dock", function* () {
        yield ctx.slots.register(
          { name: "conversation.input.dock", id: "quota-bar", order: 12 },
          QuotaBar
        );
      });
      ctx.on("dispose", () => {
        clearInterval(timer);
        document.removeEventListener("visibilitychange", onFocus);
      });
    };
    return module.exports;
  },
});
