// PROTOTYPE — throwaway slot/form candidates for the planned dsh-quota-bar.
//
// Question: where should the GLM quota bar live in the DSH web GUI, and in what form?
// Five structurally different variants, each mounted at its REAL slot (so it butts up
// against the actual chrome), plus a floating switcher to spotlight one at a time:
//
//   A  DockBar       conversation.input.dock (order 12, beside GoalBar)  — pi statusline port
//   B  HeaderChip    conversation.session.header.actions                — compact pill, click cycles window
//   C  SidebarFooter sidebar.footer.action                              — persistent sidebar row
//   D  InputRing     conversation.input.right                           — 22px ring, click cycles window
//   E  FloatingCard  fixed bottom-right capsule -> expandable card      — dsh-quota-panel form
//
// All readings are MOCK data cycling over time (in-memory only, no fetch, no persistence),
// so threshold colors (<50 green / <80 amber / >=80 red), wraps, and reset-time formatting
// are all observable. Delete this package once the winning variant is folded into dsh-quota-bar.
window.__ModuleLoader__.load({
  id: "@s2p2/dsh-quota-proto",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");
    const h = React.createElement;

    /* ---------------- mock quota engine (shared, in-memory) ---------------- */

    const WINDOWS = ["fiveHour", "weekly", "tools"];
    const LABEL = { fiveHour: "5h", weekly: "7d", tools: "\u{1F527}" }; // 🔧 = tools lane marker
    const BASE = { fiveHour: 18, weekly: 52, tools: 4 };   // used% at t=0
    const RATE = { fiveHour: 1.35, weekly: 0.3, tools: 0.75 }; // used% per simulated tick
    const RESET_MIN = { fiveHour: 214, weekly: 4230, tools: 980 }; // minutes to reset at t=0

    let prog = 0; // accumulated simulated ticks
    let speed = 1; // 1 | 4
    let paused = false;
    let spotlight = "ALL"; // "ALL" | "A".."E"
    let snap = null;
    const subs = new Set();

    const STATUS = { A: "waiting", B: "waiting", C: "waiting", D: "waiting", E: "waiting" };

    const pctOf = (w) => Math.min(100, Math.floor((BASE[w] + prog * RATE[w]) % 112));
    const resetAt = (w) => Date.now() + Math.max(2, RESET_MIN[w] - prog / 6) * 60000;

    const refresh = () => {
      snap = {
        speed,
        paused,
        spotlight,
        plan: "GLM Coding Plan (mock)",
        windows: {
          fiveHour: { pct: pctOf("fiveHour"), resetAt: resetAt("fiveHour") },
          weekly: { pct: pctOf("weekly"), resetAt: resetAt("weekly") },
          tools: { pct: pctOf("tools"), resetAt: resetAt("tools") },
        },
        statuses: Object.entries(STATUS)
          .map(([k, v]) => k + ":" + v)
          .join(" "),
      };
      subs.forEach((f) => f());
    };

    const store = {
      subscribe(f) {
        subs.add(f);
        return () => subs.delete(f);
      },
      getSnapshot() {
        return snap;
      },
    };
    const useStore = () => React.useSyncExternalStore(store.subscribe, store.getSnapshot);
    const advance = () => {
      if (!paused) {
        prog += speed;
        refresh();
      }
    };

    /* ---------------- formatting (ported from pi statusline) ---------------- */

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
    const fmtReset = (w, ms) => (w === "fiveHour" ? fmtClock(ms) : fmtDay(ms));

    /* ---------------- shared bits ---------------- */

    const col = (p) => (p < 50 ? "#3fb950" : p < 80 ? "#d29922" : "#f85149");
    const DIM = "#8b949e";
    const TRACK = "#30363d";
    const BG = "#161b22";
    const BORDER = "#21262d";
    const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

    const tag = (v) =>
      h(
        "span",
        {
          title: "prototype variant " + v,
          style: {
            background: "#58a6ff22",
            color: "#58a6ff",
            border: "1px solid #58a6ff55",
            borderRadius: "3px",
            fontSize: "8px",
            lineHeight: "12px",
            padding: "0 3px",
            marginRight: "6px",
            fontWeight: 600,
          },
        },
        v
      );

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

    const on = (v) => spotlight === "ALL" || spotlight === v;

    /* ---------------- variant A: dock bar (pi statusline port) ---------------- */

    const DockBar = () => {
      const s = useStore();
      if (!on("A")) return null;
      const seg = (w) =>
        h(
          "span",
          { style: { marginRight: "12px", whiteSpace: "nowrap" } },
          h("span", { style: { color: DIM, fontSize: "10px", marginRight: "4px" } }, LABEL[w]),
          h(Bar, { pct: s.windows[w].pct }),
          " ",
          h(
            "span",
            { style: { color: col(s.windows[w].pct), fontSize: "10px", fontVariantNumeric: "tabular-nums" } },
            s.windows[w].pct + "%"
          ),
          h(
            "span",
            { style: { color: DIM, fontSize: "10px", marginLeft: "5px" } },
            fmtReset(w, s.windows[w].resetAt)
          )
        );
      return h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            padding: "2px 10px",
            borderTop: "1px solid " + BORDER,
            background: BG,
            fontFamily: MONO,
            userSelect: "none",
          },
        },
        tag("A"),
        h("span", { style: { color: DIM, fontSize: "10px", marginRight: "10px" } }, "\u26A1 GLM"),
        seg("fiveHour"),
        seg("weekly"),
        seg("tools")
      );
    };

    /* ---------------- variant B: header chip ---------------- */

    const HeaderChip = () => {
      const s = useStore();
      const [w, setW] = React.useState("fiveHour");
      if (!on("B")) return null;
      const d = s.windows[w];
      const title =
        "\u26A1 GLM (mock) — " +
        WINDOWS.map((k) => LABEL[k] + " " + s.windows[k].pct + "% · resets " + fmtReset(k, s.windows[k].resetAt)).join(" | ");
      return h(
        "button",
        {
          onClick: () => setW(WINDOWS[(WINDOWS.indexOf(w) + 1) % WINDOWS.length]),
          title,
          style: {
            all: "unset",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            padding: "2px 8px",
            borderRadius: "10px",
            border: "1px solid " + BORDER,
            background: BG,
            fontSize: "10px",
            fontFamily: MONO,
            userSelect: "none",
          },
        },
        tag("B"),
        h("span", { style: { color: DIM } }, "\u26A1 GLM"),
        h("span", { style: { color: DIM } }, LABEL[w]),
        h("span", { style: { color: col(d.pct), fontVariantNumeric: "tabular-nums" } }, d.pct + "%"),
        h("span", { style: { color: DIM } }, fmtReset(w, d.resetAt))
      );
    };

    /* ---------------- variant C: sidebar footer ---------------- */

    const SidebarFooter = () => {
      const s = useStore();
      if (!on("C")) return null;
      const row = (w) =>
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "5px", fontSize: "9px", fontFamily: MONO } },
          h("span", { style: { color: DIM, width: "16px" } }, LABEL[w]),
          h(Bar, { pct: s.windows[w].pct, w: 60 }),
          h("span", { style: { color: col(s.windows[w].pct), fontVariantNumeric: "tabular-nums" } }, s.windows[w].pct + "%"),
          h("span", { style: { color: DIM, fontSize: "8px" } }, fmtReset(w, s.windows[w].resetAt))
        );
      return h(
        "div",
        { style: { padding: "4px 8px", borderTop: "1px solid " + BORDER, userSelect: "none" } },
        h(
          "div",
          { style: { fontSize: "9px", color: DIM, marginBottom: "3px", display: "flex", gap: "4px", alignItems: "center" } },
          tag("C"),
          "\u26A1 GLM Quota"
        ),
        row("fiveHour"),
        row("weekly"),
        row("tools")
      );
    };

    /* ---------------- variant D: input ring ---------------- */

    const InputRing = () => {
      const s = useStore();
      const [w, setW] = React.useState("fiveHour");
      if (!on("D")) return null;
      const d = s.windows[w];
      const R = 9;
      const CIRC = 2 * Math.PI * R;
      return h(
        "button",
        {
          onClick: () => setW(WINDOWS[(WINDOWS.indexOf(w) + 1) % WINDOWS.length]),
          title: "GLM " + LABEL[w] + " " + d.pct + "% · resets " + fmtReset(w, d.resetAt) + " (click cycles window)",
          style: {
            all: "unset",
            cursor: "pointer",
            width: "22px",
            height: "22px",
            display: "inline-flex",
            position: "relative",
            alignItems: "center",
            justifyContent: "center",
          },
        },
        h(
          "svg",
          { width: 22, height: 22, viewBox: "0 0 22 22" },
          h("circle", { cx: 11, cy: 11, r: R, fill: "none", stroke: TRACK, strokeWidth: 2.5 }),
          h("circle", {
            cx: 11,
            cy: 11,
            r: R,
            fill: "none",
            stroke: col(d.pct),
            strokeWidth: 2.5,
            strokeDasharray: CIRC,
            strokeDashoffset: CIRC * (1 - Math.min(100, d.pct) / 100),
            strokeLinecap: "round",
            transform: "rotate(-90 11 11)",
          })
        ),
        h(
          "span",
          {
            style: {
              position: "absolute",
              fontSize: "6.5px",
              color: col(d.pct),
              fontVariantNumeric: "tabular-nums",
            },
          },
          d.pct
        )
      );
    };

    /* ---------------- variant E: floating card ---------------- */

    const FloatingCard = () => {
      const s = useStore();
      const [open, setOpen] = React.useState(false);
      if (!on("E")) return null;
      if (!open) {
        return h(
          "div",
          {
            onClick: () => setOpen(true),
            style: {
              position: "fixed",
              right: "14px",
              bottom: "14px",
              zIndex: 9999,
              display: "flex",
              gap: "6px",
              alignItems: "center",
              padding: "4px 10px",
              borderRadius: "12px",
              background: BG,
              border: "1px solid " + BORDER,
              boxShadow: "0 4px 14px #0008",
              cursor: "pointer",
              fontSize: "11px",
              fontFamily: MONO,
              userSelect: "none",
            },
          },
          tag("E"),
          h("span", { style: { color: DIM } }, "\u26A1 GLM"),
          h("span", { style: { color: col(s.windows.fiveHour.pct) } }, s.windows.fiveHour.pct + "%")
        );
      }
      const row = (w) =>
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "6px", fontSize: "10px", fontFamily: MONO, marginBottom: "5px" } },
          h("span", { style: { color: DIM, width: "18px" } }, LABEL[w]),
          h(Bar, { pct: s.windows[w].pct, w: 80 }),
          h("span", { style: { color: col(s.windows[w].pct), fontVariantNumeric: "tabular-nums" } }, s.windows[w].pct + "%"),
          h("span", { style: { color: DIM } }, fmtReset(w, s.windows[w].resetAt))
        );
      return h(
        "div",
        {
          style: {
            position: "fixed",
            right: "14px",
            bottom: "14px",
            zIndex: 9999,
            width: "230px",
            padding: "10px 12px",
            borderRadius: "10px",
            background: BG,
            border: "1px solid " + BORDER,
            boxShadow: "0 6px 20px #000a",
            fontFamily: MONO,
            userSelect: "none",
          },
        },
        h(
          "div",
          { style: { display: "flex", alignItems: "center", marginBottom: "7px" } },
          tag("E"),
          h("span", { style: { color: DIM, fontSize: "10px", flex: 1 } }, s.plan),
          h(
            "button",
            {
              onClick: () => setOpen(false),
              title: "collapse",
              style: { all: "unset", cursor: "pointer", color: DIM, fontSize: "11px", padding: "0 3px" },
            },
            "\u00D7"
          )
        ),
        row("fiveHour"),
        row("weekly"),
        row("tools"),
        h("div", { style: { color: "#484f58", fontSize: "8px", marginTop: "4px" } }, "MOCK DATA \u00B7 prototype only")
      );
    };

    /* ---------------- floating switcher ---------------- */

    const KEYS = ["ALL", "A", "B", "C", "D", "E"];
    const cycle = (dir) => {
      const cur = snap ? snap.spotlight : "ALL";
      const i = KEYS.indexOf(cur);
      spotlight = KEYS[(i + dir + KEYS.length) % KEYS.length];
      refresh();
    };
    const btn = (label, onClick, active) =>
      h(
        "button",
        {
          onClick,
          style: {
            all: "unset",
            cursor: "pointer",
            color: active ? "#58a6ff" : "#c9d1d9",
            padding: "0 4px",
            fontWeight: 600,
          },
        },
        label
      );

    const Switcher = () => {
      const s = useStore();
      React.useEffect(() => {
        const onKey = (e) => {
          const t = e.target;
          if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
          if (e.key === "ArrowLeft") cycle(-1);
          if (e.key === "ArrowRight") cycle(1);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
      }, []);
      return h(
        "div",
        {
          style: {
            position: "fixed",
            bottom: "10px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10000,
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            alignItems: "center",
            padding: "5px 10px",
            borderRadius: "14px",
            background: "#0d1117ee",
            border: "1px solid #58a6ff66",
            boxShadow: "0 4px 16px #000a",
            fontFamily: MONO,
            fontSize: "10px",
            color: "#c9d1d9",
            userSelect: "none",
          },
        },
        h(
          "div",
          { style: { display: "flex", gap: "8px", alignItems: "center" } },
          btn("\u25C0", () => cycle(-1)),
          h("b", { style: { minWidth: "52px", textAlign: "center", color: "#58a6ff" } }, s.spotlight),
          btn("\u25B6", () => cycle(1)),
          h("span", { style: { color: "#30363d" } }, "|"),
          btn(s.paused ? "\u25B6" : "\u23F8", () => {
            paused = !paused;
            refresh();
          }),
          btn("1\u00D7", () => {
            speed = 1;
            refresh();
          }, !s.paused && s.speed === 1),
          btn("4\u00D7", () => {
            speed = 4;
            refresh();
          }, !s.paused && s.speed === 4)
        ),
        h(
          "div",
          { style: { display: "flex", gap: "10px", color: DIM } },
          h(
            "span",
            null,
            WINDOWS.map((w) => LABEL[w] + " " + s.windows[w].pct + "%").join("  \u00B7  ")
          ),
          h("span", { style: { color: "#484f58" } }, s.statuses)
        )
      );
    };

    /* ---------------- registration ---------------- */

    const SEATS = [
      { v: "A", slot: "conversation.input.dock", opts: { name: "dsh-quota-proto-dock", order: 12 }, comp: DockBar },
      { v: "B", slot: "conversation.session.header.actions", opts: { name: "dsh-quota-proto-header" }, comp: HeaderChip },
      { v: "C", slot: "sidebar.footer.action", opts: { name: "dsh-quota-proto-sidebar" }, comp: SidebarFooter },
      { v: "D", slot: "conversation.input.right", opts: { name: "dsh-quota-proto-ring" }, comp: InputRing },
      { v: "E", slot: "conversation.input.dock", opts: { name: "dsh-quota-proto-float", order: 99 }, comp: FloatingCard },
    ];

    exports.inject = ["slots"];
    exports.apply = (ctx) => {
      refresh();
      const timer = setInterval(advance, 1000);
      for (const seat of SEATS) {
        STATUS[seat.v] = "waiting";
        try {
          ctx.slots.inject(seat.slot, function* () {
            STATUS[seat.v] = "mounted";
            refresh();
            yield ctx.slots.register(seat.opts, seat.comp);
          });
        } catch (e) {
          STATUS[seat.v] = "error";
          refresh();
        }
      }
      try {
        ctx.slots.inject("conversation.input.dock", function* () {
          yield ctx.slots.register({ name: "dsh-quota-proto-switcher", order: 100 }, Switcher);
        });
      } catch (e) {
        /* switcher is best-effort */
      }
      ctx.on("dispose", () => clearInterval(timer));
    };
    return module.exports;
  },
});
