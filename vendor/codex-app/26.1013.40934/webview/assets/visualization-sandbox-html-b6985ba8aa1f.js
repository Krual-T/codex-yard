import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";import{a as t,c as n,i as r,o as i,s as a,t as o,u as s}from"./visualization-sandbox-config-193a3a874c91.js";import{a as c,n as l,o as u,t as d}from"./protocol-e3c47871a888.js";var f;function p(){return(p=e((()=>{f=`(() => {
  const callTool = globalThis.openai?.callTool?.bind(globalThis.openai);
  const panels = new Map();
  const targetIds = new WeakMap();
  let nextPanelId = 0;
  let nextTargetId = 0;
  let stopped = false;
  let command = null;
  let previews = new Map();

  const send = (message) =>
    Promise.resolve()
      .then(() => callTool("__codex_visualization_annotations__", message))
      .catch(() => null);
  const liveTarget = (panel) => {
    const target = panel.target.deref();
    return target?.isConnected && target.ownerDocument === document
      ? target
      : null;
  };

  function owners() {
    const result = new Map();
    for (const panel of panels.values()) {
      const target = liveTarget(panel);
      if (target != null && panel.accepted != null) {
        result.set(target, panel);
      }
    }
    return result;
  }

  function isValue(control, value) {
    switch (control.type) {
      case "range":
        return (
          Number.isFinite(value) && value >= control.min && value <= control.max
        );
      case "color":
        return (
          typeof value === "string" &&
          /^#(?:[\\da-f]{3}|[\\da-f]{4}|[\\da-f]{6}|[\\da-f]{8})$/i.test(value)
        );
      case "toggle":
        return typeof value === "boolean";
      case "select":
        return (
          typeof value === "string" &&
          control.options.some((option) => option.value === value)
        );
      default:
        return false;
    }
  }

  function setValue(binding, value) {
    if (liveTarget(binding.panel) == null) {
      return;
    }
    try {
      if (binding.object[binding.property] === value) {
        return;
      }
      binding.object[binding.property] = value;
      binding.panel.onChange?.();
    } catch (error) {
      globalThis.reportError(error);
    }
  }

  function syncPreviews() {
    const desired = new Map();
    const activeOwners = owners();
    for (const change of command?.changes ?? []) {
      const panel = panels.get(change.registrationId);
      if (
        panel == null ||
        panel.targetId !== change.targetId ||
        activeOwners.get(liveTarget(panel)) !== panel
      ) {
        continue;
      }
      // Globals may precede an update's acknowledgement. Keep accepted previews
      // while adding bindings, without recapturing their edited values.
      if (panel.inFlight) {
        for (const [binding, value] of previews) {
          if (binding.panel === panel) {
            desired.set(binding, value);
          }
        }
        continue;
      }
      for (const edit of change.annotationControlChanges) {
        const binding = panel.bindings.get(edit.callback);
        const control = panel.accepted.find(
          (candidate) => candidate.callback === edit.callback,
        );
        if (
          binding != null &&
          control != null &&
          edit.previousValue === control.currentValue &&
          edit.value !== control.currentValue &&
          isValue(control, edit.value)
        ) {
          desired.set(binding, edit.value);
        }
      }
    }
    const previous = previews;
    previews = desired;
    for (const [binding] of previous) {
      if (previews !== desired) {
        return;
      }
      if (!desired.has(binding)) {
        setValue(binding, binding.control.currentValue);
      }
    }
    for (const [binding, value] of desired) {
      // onChange can synchronously dispose a panel or register another one.
      if (previews !== desired) {
        return;
      }
      if (previous.get(binding) !== value) {
        setValue(binding, value);
      }
    }
  }

  function targetSnapshot(panel) {
    const target = liveTarget(panel);
    if (target == null) {
      throw new TypeError("Tweak container is unavailable");
    }
    const parts = [];
    for (
      let element = target;
      element != null && parts.length < 12;
      element = element.parentElement
    ) {
      const id = element.id && globalThis.CSS?.escape?.(element.id);
      if (id && id.length < 256) {
        parts.unshift(\`#\${id}\`);
        break;
      }
      let index = 1;
      for (
        let sibling = element.previousElementSibling;
        sibling != null;
        sibling = sibling.previousElementSibling
      ) {
        if (sibling.localName === element.localName) {
          index += 1;
        }
      }
      parts.unshift(\`\${element.localName}:nth-of-type(\${index})\`);
    }
    const label = [
      target.getAttribute("aria-label"),
      target.getAttribute("title"),
      target.id,
      target.localName,
    ]
      .map((value) =>
        value
          ?.replace(
            // oxlint-disable-next-line no-control-regex -- Match the host metadata bounds.
            /[\\u0000-\\u001f\\u007f-\\u009f\\u061c\\u200e\\u200f\\u2028-\\u202e\\u2066-\\u2069]/gu,
            " ",
          )
          .replace(/\\s+/g, " ")
          .trim(),
      )
      .find((value) => value);
    const { x, y, width, height } = target.getBoundingClientRect();
    return {
      id: panel.targetId,
      label: label.slice(0, 80),
      selector: parts.join(" > ").slice(0, 1024),
      tagName: target.localName.toLowerCase(),
      visible: panel.visible,
      rect: { x, y, width, height },
    };
  }

  function dispose(panel) {
    if (panel.disposed) {
      return;
    }
    panel.disposed = true;
    if (panels.delete(panel.id)) {
      syncPreviews();
      void panel.pending.then(() =>
        send({ type: "dispose", registrationId: panel.id }),
      );
    }
    panel.bindings.clear();
    panel.controls = [];
    panel.accepted = null;
  }

  function queue(panel, control, target) {
    panel.pending = panel.pending.then(async () => {
      if (panel.disposed || stopped) {
        return;
      }
      if (liveTarget(panel) == null) {
        dispose(panel);
        return;
      }
      // Rejected bindings must not leak into additions that are already queued.
      const type = panel.accepted == null ? "register" : "update";
      panel.inFlight = true;
      const result = await send({
        type,
        registrationId: panel.id,
        annotationControls: {
          controlsMode: "replace",
          controls: [...(panel.accepted ?? []), control],
        },
        targets: [{ ...target, visible: panel.visible }],
      });
      panel.inFlight = false;
      if (panel.disposed) {
        return;
      }
      if (Array.isArray(result?.annotationControls?.controls)) {
        panel.accepted = result.annotationControls.controls;
      } else {
        panel.controls = panel.controls.filter(
          (candidate) => candidate.callback !== control.callback,
        );
        panel.bindings.delete(control.callback);
        if (type === "register") {
          dispose(panel);
          return;
        }
      }
      syncPreviews();
    });
  }

  // Object bindings and the sandbox bridge; the host owns all controls UI.
  globalThis.Tweak = class Tweak {
    #panel;
    #disposed = false;

    constructor({ container, onChange }) {
      if (!this.supported) {
        return;
      }
      if (
        !(container instanceof Element) ||
        container.ownerDocument !== document
      ) {
        throw new TypeError("Tweak needs a component element as its container");
      }
      let targetId = targetIds.get(container);
      if (targetId == null) {
        targetId = String(++nextTargetId);
        targetIds.set(container, targetId);
      }
      this.#panel = {
        id: \`tweak-\${++nextPanelId}\`,
        targetId,
        target: new WeakRef(container),
        onChange,
        bindings: new Map(),
        nextControlId: 0,
        controls: [],
        visible:
          container.closest(".viz-carousel > [data-variant][hidden]") == null,
        accepted: null,
        pending: Promise.resolve(),
        inFlight: false,
        disposed: false,
      };
    }

    get supported() {
      return callTool != null && !stopped;
    }

    addSlider(
      object,
      property,
      { min, max, step = 1, unit, label, reference } = {},
    ) {
      return this.#bind(object, property, {
        type: "range",
        label: unit ? \`\${label ?? property} (\${unit})\` : (label ?? property),
        reference,
        currentValue: object[property],
        min,
        max,
        step,
      });
    }

    addColorPicker(object, property, { label = property, reference } = {}) {
      return this.#bind(object, property, {
        type: "color",
        label,
        reference,
        currentValue: object[property],
      });
    }

    addToggle(object, property, { label = property, reference } = {}) {
      return this.#bind(object, property, {
        type: "toggle",
        label,
        reference,
        currentValue: object[property],
      });
    }

    addSelect(object, property, { options, label = property, reference }) {
      return this.#bind(object, property, {
        type: "select",
        label,
        reference,
        currentValue: object[property],
        options: options.map((option) =>
          typeof option === "string"
            ? { label: option, value: option }
            : { label: option.label, value: option.value },
        ),
      });
    }

    dispose() {
      this.#disposed = true;
      if (this.#panel != null) {
        dispose(this.#panel);
      }
    }

    #bind(object, property, definition) {
      const panel = this.#panel;
      if (this.#disposed || panel?.disposed) {
        throw new Error("Tweak has been disposed");
      }
      if (!this.supported) {
        return this;
      }
      if (!isValue(definition, definition.currentValue)) {
        throw new TypeError("Tweak bindings require a valid current value");
      }
      if (
        panel.controls.length >= 12 ||
        (!panels.has(panel.id) && panels.size >= 64)
      ) {
        throw new RangeError("Too many Tweak controls");
      }
      const callback = \`\${panel.id}-\${++panel.nextControlId}\`;
      const payload = JSON.stringify({
        controlsMode: "replace",
        controls: [...panel.controls, { ...definition, callback }],
      });
      if (payload.length > 16_384) {
        throw new RangeError("Tweak controls exceed the maximum size");
      }
      const annotationControls = JSON.parse(payload);
      const control = annotationControls.controls.at(-1);
      const target = targetSnapshot(panel);
      panel.controls = annotationControls.controls;
      panel.bindings.set(callback, {
        panel,
        object,
        property,
        control,
      });
      panels.set(panel.id, panel);
      queue(panel, control, target);
      return this;
    }
  };

  function onGlobals(event) {
    const globals = event.detail?.globals;
    if (globals == null || !Object.hasOwn(globals, "visualizationAnnotation")) {
      return;
    }
    const next = globals.visualizationAnnotation;
    if (
      next != null &&
      (typeof next.active !== "boolean" ||
        !Array.isArray(next.changes) ||
        next.changes.length > 1024 ||
        next.changes.some(
          (change) =>
            change == null ||
            typeof change.registrationId !== "string" ||
            typeof change.targetId !== "string" ||
            !Array.isArray(change.annotationControlChanges) ||
            change.annotationControlChanges.length > 12 ||
            change.annotationControlChanges.some(
              (edit) => edit == null || typeof edit.callback !== "string",
            ),
        ))
    ) {
      return;
    }
    command = next;
    syncPreviews();
  }

  function close() {
    command = { ...command, active: false };
    void send({ type: "escape" });
  }

  function onPointerEvent(event) {
    if (!command?.active || event.button !== 0 || event.defaultPrevented) {
      return;
    }
    if (
      event.target instanceof Element &&
      event.target.closest(".viz-carousel > .viz-carousel-controls") != null
    ) {
      return;
    }
    const activeOwners = owners();
    for (const target of event.composedPath()) {
      const panel = activeOwners.get(target);
      if (panel != null) {
        if (event.type === "click") {
          void send({
            type: "select",
            registrationId: panel.id,
            targetId: panel.targetId,
          });
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
    }
    if (event.type === "click") {
      close();
    }
  }

  function onKeyDown(event) {
    if (
      !command?.active ||
      event.key !== "Escape" ||
      event.defaultPrevented ||
      event.isComposing
    ) {
      return;
    }
    event.preventDefault();
    close();
  }

  function onPageHide(event) {
    if (!event.isTrusted) {
      return;
    }
    stopped = true;
    command = null;
    syncPreviews();
    for (const panel of panels.values()) {
      dispose(panel);
    }
    observer.disconnect();
    globalThis.removeEventListener("openai:set_globals", onGlobals);
    globalThis.removeEventListener("pointerdown", onPointerEvent, true);
    globalThis.removeEventListener("mousedown", onPointerEvent, true);
    globalThis.removeEventListener("click", onPointerEvent, true);
    globalThis.removeEventListener("keydown", onKeyDown);
    globalThis.removeEventListener("pagehide", onPageHide);
  }

  const observer = new MutationObserver(() => {
    for (const panel of panels.values()) {
      const target = liveTarget(panel);
      if (target == null) {
        if (command?.active && command.selection?.registrationId === panel.id) {
          close();
        }
        dispose(panel);
        continue;
      }
      const visible =
        target.closest(".viz-carousel > [data-variant][hidden]") == null;
      if (visible === panel.visible) {
        continue;
      }
      panel.visible = visible;
      panel.pending = panel.pending.then(async () => {
        if (panel.disposed || stopped || panel.accepted == null) {
          return;
        }
        if (liveTarget(panel) == null) {
          dispose(panel);
          return;
        }
        await send({
          type: "update",
          registrationId: panel.id,
          annotationControls: {
            controlsMode: "replace",
            controls: panel.accepted,
          },
          targets: [targetSnapshot(panel)],
        });
      });
    }
  });
  if (callTool != null) {
    observer.observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden"],
    });
    globalThis.addEventListener("openai:set_globals", onGlobals);
    globalThis.addEventListener("pointerdown", onPointerEvent, true);
    globalThis.addEventListener("mousedown", onPointerEvent, true);
    globalThis.addEventListener("click", onPointerEvent, true);
    globalThis.addEventListener("keydown", onKeyDown);
    globalThis.addEventListener("pagehide", onPageHide);
    onGlobals({ detail: { globals: globalThis.openai } });
  }
})();
`})))()}var m;function h(){return(h=e((()=>{m=`// Bundled into the sandbox only when the fragment references viz-calendar.
// Register before parsing the fragment: connectedCallback builds the styled
// shadow tree synchronously, without a network request or hydration frame.
(() => {
  if (customElements.get("viz-calendar")) return;

  const style = \`
    :host{display:block;min-width:0;padding:12px;font:400 14px/1.5 Inter,system-ui,sans-serif;color:var(--foreground);container-type:inline-size}
    *{box-sizing:border-box}
    .layout{display:grid;grid-template-columns:88px minmax(0,1fr);gap:24px}
    .date{display:flex;flex-direction:column;gap:8px;padding-top:8px;border-right:1px solid var(--border)}
    .weekday,.context{color:color-mix(in srgb,var(--foreground) 65%,var(--background))}
    .day{font-size:48px;line-height:1.1;letter-spacing:-.03em}
    .context{font-size:12px;line-height:16px;overflow-wrap:anywhere}
    .axis{--hour:max(48px,var(--minimum-hour));position:relative;height:calc(var(--hours)*var(--hour) + 16px);margin-top:8px;min-width:0}
    .axis.compact{--hour:max(32px,var(--minimum-hour))}
    .hour{position:absolute;top:calc(var(--at)*var(--hour));inset-inline:0;color:var(--muted-foreground)}
    .hour span{display:block;width:36px;text-align:right;transform:translateY(-50%);font-variant-numeric:tabular-nums}
    .hour::after{content:"";position:absolute;top:0;left:48px;right:0;border-top:1px solid var(--border)}
    .events{position:absolute;inset:0 0 16px 48px;margin:0;padding:0;list-style:none;overflow:hidden}
    .event{position:absolute;top:calc(var(--at)*var(--hour) + 2px);height:calc(var(--duration)*var(--hour) - 4px);left:calc(var(--lane)*100%/var(--lanes) + var(--lane)*8px/var(--lanes));width:calc((100% - (var(--lanes) - 1)*8px)/var(--lanes));border-radius:8px;background:linear-gradient(110deg,color-mix(in srgb,var(--tone) 24%,var(--background)),color-mix(in srgb,var(--tone) 32%,var(--background)));overflow:hidden;container-type:size}
    .event.past{background:color-mix(in srgb,var(--tone) 12%,var(--background));color:color-mix(in srgb,var(--foreground) 70%,var(--background))}
    .event-body{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;height:100%;padding:4px 12px;font:inherit;color:inherit;text-align:left}
    button.event-body{appearance:none;border:0;border-radius:inherit;background:transparent}
    .cursor-interaction{cursor:var(--cursor-interaction,pointer)}
    button.event-body:hover{background:color-mix(in srgb,var(--foreground) 2%,transparent)}
    button.event-body:focus-visible{outline:2px solid var(--ring);outline-offset:-2px}
    /* Optically center Inter's glyphs within the unchanged line boxes. */
    .event-content{min-width:0;transform:translateY(-1px)}
    .title{display:block;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .detail{display:block;font-size:12px;line-height:16px;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    @container(max-height:48px){.detail{display:none}.event-body{padding-block:0}}
    .video{width:16px;height:16px;flex:none}
    .now{position:absolute;top:calc(var(--at)*var(--hour));left:48px;right:0;border-top:2px solid var(--red);pointer-events:none}
    .now::before{content:"";position:absolute;left:-4px;top:-5px;width:8px;height:8px;border-radius:50%;background:var(--red)}
    .now span{position:absolute;right:calc(100% + 12px);transform:translateY(-50%);color:var(--red);font:400 12px/16px Inter,system-ui,sans-serif;font-variant-numeric:tabular-nums}
    .empty{position:absolute;top:24px;left:64px;color:var(--muted-foreground)}
    @media(pointer:coarse){:host .axis{--hour:max(48px,var(--minimum-hour),var(--minimum-target-hour))}}
    @container(max-width:520px){.layout{grid-template-columns:minmax(0,1fr)}.date{flex-direction:row;align-items:baseline;border:0;padding:0}.event-body{padding-inline:8px}}
  \`;
  const escape = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  const minutes = (value) => {
    if (
      typeof value !== "string" ||
      !/^(?:[01]\\d|2[0-3]):[0-5]\\d$|^24:00$/.test(value)
    ) {
      throw new Error("Use HH:MM times between 00:00 and 24:00.");
    }
    return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  };

  class Calendar extends HTMLElement {
    #initialized = false;
    #events;
    static observedAttributes = [
      "date",
      "start",
      "end",
      "now",
      "events",
      "lang",
      "time-zone",
      "empty-label",
      "interactive",
    ];

    constructor() {
      super();
      // Replay data assigned before the custom element was registered.
      if (Object.hasOwn(this, "events")) {
        const events = this.events;
        delete this.events;
        this.events = events;
      }
    }

    get events() {
      return this.#events === undefined
        ? JSON.parse(this.getAttribute("events") ?? "[]")
        : this.#events;
    }

    set events(events) {
      this.#events = events;
      if (this.#initialized) this.render();
    }

    connectedCallback() {
      // Keep the shared widget surface outside Shadow DOM; only layout is private.
      this.classList.add("widget");
      // Preserve a server-rendered declarative shadow root when upgrading it.
      // https://web.dev/articles/declarative-shadow-dom
      if (!this.shadowRoot) {
        this.attachShadow({ mode: "open", serializable: true });
        this.render();
      } else if (!this.#initialized && this.#events !== undefined) {
        this.render();
      }
      if (!this.#initialized) {
        this.shadowRoot.addEventListener("click", (event) => {
          const button = event.target.closest?.("button[data-event-index]");
          if (!button) return;
          const index = Number(button.dataset.eventIndex);
          this.dispatchEvent(
            new CustomEvent("eventselect", {
              bubbles: true,
              composed: true,
              detail: { event: this.events[index], index },
            }),
          );
        });
      }
      this.#initialized = true;
    }

    attributeChangedCallback(name, before, after) {
      if (before !== after && this.#initialized && this.shadowRoot)
        this.render();
    }

    render() {
      const shadow = this.shadowRoot;
      try {
        const date = this.getAttribute("date") ?? "";
        const calendarDate = new Date(\`\${date}T12:00:00Z\`);
        if (
          !/^\\d{4}-\\d{2}-\\d{2}$/.test(date) ||
          !Number.isFinite(calendarDate.getTime()) ||
          calendarDate.toISOString().slice(0, 10) !== date
        ) {
          throw new Error("Supply a valid calendar date as YYYY-MM-DD.");
        }
        const start = minutes(this.getAttribute("start") ?? "09:00");
        const end = minutes(this.getAttribute("end") ?? "17:00");
        if (end <= start)
          throw new Error("The visible end must be later than the start.");
        const now = this.hasAttribute("now")
          ? minutes(this.getAttribute("now"))
          : null;
        const input = this.events;
        if (!Array.isArray(input) || input.length > 200)
          throw new Error("Supply an array of at most 200 events.");
        const tones = new Set([
          "blue",
          "green",
          "red",
          "orange",
          "purple",
          "yellow",
        ]);
        const events = input
          .map((event, index) => {
            if (
              event == null ||
              typeof event !== "object" ||
              typeof event.title !== "string"
            ) {
              throw new Error("Each event needs a title, start and end.");
            }
            const from = minutes(event.start),
              to = minutes(event.end);
            if (to <= from)
              throw new Error("An event must end after it starts.");
            if (event.detail != null && typeof event.detail !== "string")
              throw new Error("Event detail must be text.");
            return {
              ...event,
              index,
              from,
              to,
              tone: tones.has(event.tone) ? event.tone : "blue",
              lane: 0,
              lanes: 1,
            };
          })
          .filter((event) => event.from < end && event.to > start)
          .sort((a, b) => a.from - b.from || b.to - a.to);

        // Allocate interval lanes within each connected overlap group. Adjacent
        // events share a lane; a chain of overlaps shares one column count.
        let group = [],
          laneEnds = [],
          groupEnd = -1;
        const finishGroup = () => {
          for (const event of group) event.lanes = laneEnds.length;
        };
        for (const event of events) {
          if (event.from >= groupEnd) {
            finishGroup();
            group = [];
            laneEnds = [];
          }
          let lane = laneEnds.findIndex((until) => until <= event.from);
          if (lane < 0) lane = laneEnds.length;
          event.lane = lane;
          laneEnds[lane] = event.to;
          group.push(event);
          groupEnd = Math.max(event.to, groupEnd);
        }
        finishGroup();

        const locale = this.lang || document.documentElement.lang || "en";
        const weekday = new Intl.DateTimeFormat(locale, {
          weekday: "short",
          timeZone: "UTC",
        }).format(calendarDate);
        const fullDate = new Intl.DateTimeFormat(locale, {
          dateStyle: "full",
          timeZone: "UTC",
        }).format(calendarDate);
        const timeZone = this.getAttribute("time-zone");
        const ticks = [start];
        for (
          let tick = (Math.floor(start / 60) + 1) * 60;
          tick < end;
          tick += 60
        )
          ticks.push(tick);
        ticks.push(end);
        const labelTime = (time) =>
          \`\${String(Math.floor(time / 60)).padStart(2, "0")}:\${String(time % 60).padStart(2, "0")}\`;
        const compact = end - start > 240;
        // Size from full event durations; the window clips partial events
        // without letting a one-minute sliver stretch the entire time axis.
        const minimumHour = Math.max(
          0,
          ...events.map((event) => (28 * 60) / (event.to - event.from)),
        );
        const minimumTargetHour = Math.max(
          0,
          ...events.map((event) => (48 * 60) / (event.to - event.from)),
        );
        const hourMarkup = ticks
          .map(
            (tick) =>
              \`<div class="hour" style="--at:\${(tick - start) / 60}">\${now != null && now >= start && now <= end && Math.abs(tick - now) < 15 ? "" : \`<span>\${tick % 60 ? labelTime(tick) : tick / 60}</span>\`}</div>\`,
          )
          .join("");
        const interactive = this.hasAttribute("interactive");
        const eventMarkup = events
          .map((event) => {
            const label = escape(
              \`\${event.title}, \${event.start}-\${event.end}\${event.detail ? \`, \${event.detail}\` : ""}\`,
            );
            const body = \`button type="button"\${interactive ? \` data-event-index="\${event.index}"\` : ""} aria-label="\${label}" data-tooltip="\${label}"\`;
            return \`<li class="event\${now != null && event.to <= now ? " past" : ""}" style="--at:\${(event.from - start) / 60};--duration:\${(event.to - event.from) / 60};--lane:\${event.lane};--lanes:\${event.lanes};--tone:var(--\${event.tone})"><\${body} class="event-body cursor-interaction"><span class="event-content"><span class="title">\${escape(event.title)}</span>\${event.detail ? \`<span class="detail">\${escape(event.detail)}</span>\` : ""}</span>\${event.video ? '<svg class="video" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>' : ""}</button></li>\`;
          })
          .join("");
        const nowMarkup =
          now != null && now >= start && now <= end
            ? \`<div class="now" style="--at:\${(now - start) / 60}" role="img" aria-label="\${escape(labelTime(now))}"><span>\${labelTime(now)}</span></div>\`
            : "";
        shadow.innerHTML = \`<style>\${style}</style><section class="calendar" aria-label="\${escape(fullDate)}"><div class="layout"><div class="date"><span class="weekday">\${escape(weekday)}</span><span class="day">\${Number(date.slice(-2))}</span>\${timeZone ? \`<span class="context">\${escape(timeZone)}</span>\` : ""}</div><div class="axis\${compact ? " compact" : ""}" style="--hours:\${(end - start) / 60};--minimum-hour:\${minimumHour}px;--minimum-target-hour:\${minimumTargetHour}px">\${hourMarkup}<ol class="events">\${eventMarkup}</ol>\${nowMarkup}\${events.length ? "" : \`<span class="empty">\${escape(this.getAttribute("empty-label") ?? "No events")}</span>\`}</div></div></section>\`;
      } catch (error) {
        // Invalid model-authored input remains visible and recoverable through
        // the same attributes; never silently invent dates or drop events.
        shadow.innerHTML = \`<style>\${style}</style><div class="calendar" role="alert">\${escape(error instanceof Error ? error.message : "Invalid calendar data.")}</div>\`;
      }
    }
  }
  customElements.define("viz-calendar", Calendar);
})();
`})))()}var g;function _(){return(_=e((()=>{g=`/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-call, typescript/no-unsafe-return */
// Runs inside the visualization sandbox, not the host webview.
(() => {
  const capability = "__CODEX_INLINE_VISUALIZATION_DOWNLOAD_CAPABILITY__";
  const callTool = globalThis.openai.callTool.bind(globalThis.openai);
  const anchorClick = Reflect.get(
    globalThis.HTMLAnchorElement.prototype,
    "click",
  );
  globalThis.document.currentScript?.remove();
  let isHandlingTrustedClick = false;
  let didDownload = false;

  const handleDownload = (anchor, event, waitForPropagation) => {
    const isUserActivated =
      event.isTrusted ||
      isHandlingTrustedClick ||
      globalThis.navigator.userActivation?.isActive === true;
    const startDownload = () => {
      if (
        event.defaultPrevented ||
        !isUserActivated ||
        didDownload ||
        !anchor.hasAttribute("download")
      ) {
        return;
      }

      let url;
      try {
        url = new globalThis.URL(anchor.href, globalThis.location.href);
      } catch {
        return;
      }
      if (url.protocol !== "blob:" && url.protocol !== "data:") {
        return;
      }

      const name = anchor.download.trim() || "download";
      didDownload = true;
      void globalThis
        .fetch(url.href)
        .then((response) => response.blob())
        .then((blob) =>
          callTool("__codex_inline_visualization_download__", {
            blob,
            capability,
            name,
          }),
        )
        .catch(() => {});
    };

    if (waitForPropagation) {
      globalThis.queueMicrotask(startDownload);
    } else {
      startDownload();
    }
  };

  globalThis.addEventListener(
    "click",
    (event) => {
      if (event.isTrusted) {
        isHandlingTrustedClick = true;
        didDownload = false;
        globalThis.queueMicrotask(() => {
          isHandlingTrustedClick = false;
        });
      }

      const anchor = event
        .composedPath()
        .find((target) => target instanceof globalThis.HTMLAnchorElement);
      if (anchor != null) {
        handleDownload(anchor, event, true);
      }
    },
    { capture: true },
  );

  globalThis.HTMLAnchorElement.prototype.click = function () {
    let event;
    const observeClick = (clickEvent) => {
      event = clickEvent;
    };
    this.addEventListener("click", observeClick, { capture: true, once: true });
    try {
      return Reflect.apply(anchorClick, this, []);
    } finally {
      this.removeEventListener("click", observeClick, true);
      if (event != null) {
        handleDownload(this, event, false);
      }
    }
  };
})();
`})))()}var v;function y(){return(y=e((()=>{v=`<!--__INLINE_VISUALIZATION_FRAGMENT__-->
<script src="https://unpkg.com/@floating-ui/core@1.7.3/dist/floating-ui.core.umd.min.js"><\/script>
<script src="https://unpkg.com/@floating-ui/dom@1.7.4/dist/floating-ui.dom.umd.min.js"><\/script>
<script>
(() => {
  if (window.FloatingUIDOM == null) {
    return;
  }
  const { autoUpdate, computePosition, flip, offset, shift, size } =
    window.FloatingUIDOM;
  const tooltipPlacements = new Set(["top", "right", "bottom", "left"]);
  const tooltipId = \`codex-visualization-tooltip-\${
    window.crypto?.randomUUID?.() ?? Date.now().toString(36)
  }\`;
  const tooltipGap = 5;
  const hoverDelay = 700;
  const skipDelay = 300;
  let activeTrigger = null;
  let pendingTrigger = null;
  let tooltip = null;
  let openTimeout = null;
  let autoUpdateCleanup = null;
  let positionRequest = 0;
  let skipDelayUntil = 0;
  let lastPointerWasTouch = false;
  let pinnedByTouch = false;

  const getTrigger = (event) => {
    for (const target of event.composedPath()) {
      if (target?.nodeType === Node.ELEMENT_NODE) {
        const trigger = target.closest("[data-tooltip]");
        if (trigger) return trigger;
      }
    }
    return null;
  };
  const containsTarget = (trigger, target) =>
    target?.nodeType != null && trigger.contains(target);
  const getContent = (trigger) =>
    trigger.getAttribute("data-tooltip")?.trim() ?? "";
  const getPlacement = (trigger) => {
    const placement = trigger.getAttribute("data-tooltip-placement");
    return tooltipPlacements.has(placement) ? placement : "top";
  };
  const getTooltip = () => {
    if (tooltip == null) {
      tooltip = document.createElement("div");
      tooltip.id = tooltipId;
      tooltip.className = "tooltip";
      tooltip.setAttribute("role", "tooltip");
    }
    return tooltip;
  };
  const setDescribedBy = (trigger, described) => {
    const ids = new Set(
      (trigger.getAttribute("aria-describedby") ?? "")
        .split(/\\s+/)
        .filter(Boolean),
    );
    if (described) {
      ids.add(tooltipId);
    } else {
      ids.delete(tooltipId);
    }
    if (ids.size === 0) {
      trigger.removeAttribute("aria-describedby");
    } else {
      trigger.setAttribute("aria-describedby", [...ids].join(" "));
    }
  };
  const clearOpenTimeout = () => {
    if (openTimeout != null) {
      window.clearTimeout(openTimeout);
      openTimeout = null;
    }
    pendingTrigger = null;
  };
  const closeTooltip = (activateSkipDelay = true) => {
    clearOpenTimeout();
    pinnedByTouch = false;
    positionRequest += 1;
    autoUpdateCleanup?.();
    autoUpdateCleanup = null;
    if (activeTrigger == null) {
      return;
    }
    setDescribedBy(activeTrigger, false);
    activeTrigger = null;
    tooltip?.remove();
    if (activateSkipDelay) {
      skipDelayUntil = Date.now() + skipDelay;
    }
  };
  const updatePosition = (trigger, floating) => {
    const request = ++positionRequest;
    void computePosition(trigger, floating, {
      middleware: [
        offset(tooltipGap),
        flip({ padding: tooltipGap }),
        shift({ padding: tooltipGap }),
        size({
          padding: tooltipGap,
          apply({ availableHeight, availableWidth, elements }) {
            elements.floating.style.setProperty(
              "--tooltip-available-width",
              \`\${Math.max(0, availableWidth)}px\`,
            );
            elements.floating.style.setProperty(
              "--tooltip-available-height",
              \`\${Math.max(0, availableHeight)}px\`,
            );
          },
        }),
      ],
      placement: getPlacement(trigger),
      strategy: "fixed",
    })
      .then(({ x, y }) => {
        if (activeTrigger !== trigger || request !== positionRequest) {
          return;
        }
        const scale = window.devicePixelRatio || 1;
        floating.style.transform = \`translate(\${Math.round(x * scale) / scale}px, \${Math.round(y * scale) / scale}px)\`;
        floating.style.visibility = "visible";
      })
      .catch(() => {
        if (activeTrigger === trigger && request === positionRequest) {
          closeTooltip(false);
        }
      });
  };
  const openTooltip = (trigger) => {
    const content = getContent(trigger);
    if (!trigger.isConnected || content.length === 0) {
      return;
    }
    clearOpenTimeout();
    if (activeTrigger === trigger) {
      return;
    }
    closeTooltip();
    const floating = getTooltip();
    floating.textContent = content;
    floating.style.visibility = "hidden";
    floating.style.transform = "translate(0, 0)";
    document.body.appendChild(floating);
    activeTrigger = trigger;
    setDescribedBy(trigger, true);
    autoUpdateCleanup = autoUpdate(trigger, floating, () => {
      updatePosition(trigger, floating);
    });
  };
  const requestOpen = (trigger, immediate = false) => {
    if (
      getContent(trigger).length === 0 ||
      activeTrigger === trigger ||
      pendingTrigger === trigger
    ) {
      return;
    }
    clearOpenTimeout();
    pendingTrigger = trigger;
    const delay =
      immediate || activeTrigger != null || Date.now() < skipDelayUntil
        ? 0
        : hoverDelay;
    if (delay === 0) {
      openTooltip(trigger);
      return;
    }
    openTimeout = window.setTimeout(() => {
      openTimeout = null;
      pendingTrigger = null;
      openTooltip(trigger);
    }, delay);
  };
  const handlePointerOpen = (event) => {
    if (event.pointerType === "touch") {
      return;
    }
    const trigger = getTrigger(event);
    if (trigger == null || containsTarget(trigger, event.relatedTarget)) {
      return;
    }
    requestOpen(trigger);
  };
  const handlePointer = (event) => {
    lastPointerWasTouch =
      event.type === "pointerdown" && event.pointerType === "touch";
  };
  const handleTouchClick = (event) => {
    const isTouch = event.pointerType === "touch" || lastPointerWasTouch;
    lastPointerWasTouch = false;
    if (!isTouch || event.detail === 0) {
      return;
    }
    const trigger = getTrigger(event);
    if (
      trigger == null ||
      !trigger.isConnected ||
      getContent(trigger).length === 0 ||
      (pinnedByTouch && activeTrigger === trigger)
    ) {
      if (pinnedByTouch) {
        closeTooltip();
      }
      return;
    }
    openTooltip(trigger);
    pinnedByTouch = activeTrigger === trigger;
    window.setTimeout(() => {
      if (activeTrigger === trigger && !trigger.isConnected) {
        closeTooltip(false);
      }
    }, 0);
  };
  const handleLeave = (event) => {
    if (pinnedByTouch) {
      return;
    }
    const trigger = getTrigger(event);
    if (trigger == null || containsTarget(trigger, event.relatedTarget)) {
      return;
    }
    if (activeTrigger === trigger || pendingTrigger === trigger) {
      closeTooltip();
    }
  };
  const handleFocusIn = (event) => {
    const trigger = getTrigger(event);
    if (trigger?.matches(":focus-visible")) {
      requestOpen(trigger, true);
    }
  };
  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      closeTooltip();
    }
  };
  const handleContextMenu = (event) => {
    lastPointerWasTouch = false;
    const trigger = getTrigger(event);
    if (activeTrigger === trigger || pendingTrigger === trigger) {
      closeTooltip();
    }
  };
  const handlers = {
    pointerover: handlePointerOpen,
    pointerdown: handlePointer,
    pointercancel: handlePointer,
    click: handleTouchClick,
    pointerout: handleLeave,
    focusin: handleFocusIn,
    focusout: handleLeave,
    keydown: handleKeyDown,
    contextmenu: handleContextMenu,
  };
  const roots = new Map();
  const handledEvents = new WeakSet();
  const handleEvent = (event) => {
    if (handledEvents.has(event)) return;
    handledEvents.add(event);
    handlers[event.type](event);
  };
  const discoverRoots = (node) => {
    if (node.shadowRoot) listen(node.shadowRoot);
    for (const element of node.querySelectorAll("*")) {
      if (element.shadowRoot) listen(element.shadowRoot);
    }
  };
  const listen = (root) => {
    if (roots.has(root)) return;
    for (const type of Object.keys(handlers)) root.addEventListener(type, handleEvent);
    const observer = new window.MutationObserver((records) => {
      for (const { addedNodes } of records) {
        for (const node of addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) discoverRoots(node);
        }
      }
      for (const [root, cleanup] of roots) {
        if (root.host && !root.host.isConnected) {
          cleanup();
          roots.delete(root);
        }
      }
      if (activeTrigger && !activeTrigger.isConnected) closeTooltip(false);
    });
    observer.observe(root, { childList: true, subtree: true });
    roots.set(root, () => {
      observer.disconnect();
      for (const type of Object.keys(handlers)) root.removeEventListener(type, handleEvent);
    });
    discoverRoots(root);
  };
  const destroy = () => {
    closeTooltip(false);
    lastPointerWasTouch = false;
    for (const cleanup of roots.values()) cleanup();
    roots.clear();
    tooltip = null;
  };

  // Events between children of one shadow root never reach the document.
  listen(document);
  window.addEventListener("pagehide", destroy, { once: true });
})();
<\/script>
<script id="codex-visualization-tabs">
(() => {
  const selector = '.nav[role="tablist"] [role="tab"]';
  const disabled = ':disabled,[aria-disabled="true"]';
  const selectTab = (selected) => {
    const panelId = selected.getAttribute("aria-controls");
    for (const tab of selected.closest('[role="tablist"]').querySelectorAll('[role="tab"]')) {
      const active = tab === selected;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
      const id = tab.getAttribute("aria-controls");
      const panel = id && document.getElementById(id);
      if (panel != null) {
        panel.hidden = id !== panelId;
        if (!panel.hidden && selected.id) {
          panel.setAttribute("aria-labelledby", selected.id);
        }
      }
    }
  };
  const interact = (event) => {
    const tab = event.target?.closest?.(selector);
    if (event.defaultPrevented || tab == null || tab.matches(disabled)) {
      return;
    }
    if (event.type === "click") {
      selectTab(tab);
      return;
    }
    const tabs = Array.from(
      tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]'),
    ).filter((candidate) => !candidate.matches(disabled));
    const current = tabs.indexOf(tab);
    let next;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = (current + 1) % tabs.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = (current + tabs.length - 1) % tabs.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = tabs.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    tabs[next].focus();
    selectTab(tabs[next]);
  };

  for (const list of document.querySelectorAll('.nav[role="tablist"]')) {
    const selected =
      list.querySelector('[role="tab"][aria-selected="true"]') ??
      list.querySelector('[role="tab"].active') ??
      list.querySelector('[role="tab"]');
    if (selected != null) {
      selectTab(selected);
    }
  }
  document.addEventListener("click", interact);
  document.addEventListener("keydown", interact);
  window.addEventListener("pagehide", () => {
    document.removeEventListener("click", interact);
    document.removeEventListener("keydown", interact);
  }, { once: true });
})();
<\/script>
<script id="codex-visualization-carousel">
  (() => {
    for (const root of document.querySelectorAll(".viz-carousel")) {
      const panels = Array.from(
        root.querySelectorAll(":scope > [data-variant]"),
      );
      if (panels.length === 0) {
        continue;
      }
      root.setAttribute("role", "group");
      panels.forEach((panel, index) => {
        panel.hidden = index !== 0;
        panel.setAttribute("role", "group");
        if (!panel.hasAttribute("aria-label")) {
          panel.setAttribute("aria-label", panel.dataset.variant);
        }
      });
      root.dataset.activeVariant = panels[0].dataset.variant;
      if (panels.length === 1) {
        continue;
      }

      const controls = document.createElement("div");
      controls.className = "viz-carousel-controls";
      // Portable copy of the settings dropdown's legacy glyph; no 14px icon-package preset matches it.
      // https://github.com/openai/openai/blob/master/codex/codex-apps/webview/src/icons/chevron.svg
      controls.innerHTML = \`
      <button type="button" class="viz-carousel-previous cursor-interaction"><i data-lucide="chevron-left" aria-hidden="true"></i></button>
      <details class="viz-carousel-picker">
        <summary class="cursor-interaction">
          <span class="viz-carousel-count tabular-nums"></span>
          <span class="viz-carousel-name"></span>
          <svg class="viz-carousel-caret" width="14" height="14" viewBox="0 0 20 21" fill="none" aria-hidden="true" focusable="false">
            <path d="M15.2793 7.71101C15.539 7.45131 15.961 7.45131 16.2207 7.71101C16.4804 7.97071 16.4804 8.39272 16.2207 8.65242L10.4707 14.4024C10.211 14.6621 9.78902 14.6621 9.52932 14.4024L3.77932 8.65242L3.69436 8.54792C3.52385 8.28979 3.55205 7.93828 3.77932 7.71101C4.00659 7.48374 4.3581 7.45554 4.61623 7.62605L4.72073 7.71101L10 12.9903L15.2793 7.71101Z" fill="currentColor" stroke="currentColor" stroke-width="0.6" />
          </svg>
        </summary>
        <div class="viz-carousel-options"></div>
      </details>
      <button type="button" class="viz-carousel-next cursor-interaction"><i data-lucide="chevron-right" aria-hidden="true"></i></button>\`;
      const previous = controls.querySelector(".viz-carousel-previous");
      const next = controls.querySelector(".viz-carousel-next");
      const picker = controls.querySelector(".viz-carousel-picker");
      const summary = picker.querySelector("summary");
      const count = controls.querySelector(".viz-carousel-count");
      const name = controls.querySelector(".viz-carousel-name");
      const options = controls.querySelector(".viz-carousel-options");
      const status = document.createElement("span");
      status.className = "sr-only";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      status.setAttribute("aria-atomic", "true");
      previous.setAttribute(
        "aria-label",
        root.dataset.previousLabel ?? "Previous variant",
      );
      next.setAttribute("aria-label", root.dataset.nextLabel ?? "Next variant");

      let active = 0;
      let mousePointerId = null;
      let summaryPointerHandled = false;
      summary.addEventListener("pointerdown", (event) => {
        summaryPointerHandled =
          event.pointerType === "mouse" && event.button === 0 && !event.ctrlKey;
        if (!summaryPointerHandled) {
          return;
        }
        event.preventDefault();
        summary.focus({ preventScroll: true });
        picker.open = !picker.open;
        mousePointerId = picker.open ? event.pointerId : null;
      });
      summary.addEventListener("click", (event) => {
        if (summaryPointerHandled && event.detail > 0) {
          event.preventDefault();
        }
      });
      const choices = panels.map((panel, index) => {
        const choice = document.createElement("button");
        choice.type = "button";
        choice.className = "cursor-interaction";
        choice.textContent = panel.dataset.variant;
        choice.addEventListener("click", () => {
          select(index);
          summary.focus();
        });
        choice.addEventListener("pointerup", (event) => {
          if (
            picker.open &&
            event.pointerType === "mouse" &&
            event.button === 0 &&
            event.pointerId === mousePointerId
          ) {
            choice.click();
          }
        });
        options.appendChild(choice);
        return choice;
      });
      const select = (index) => {
        const changed = active !== index;
        active = index;
        panels.forEach((panel, position) => {
          panel.hidden = position !== active;
          choices[position].setAttribute(
            "aria-current",
            String(position === active),
          );
        });
        root.dataset.activeVariant = panels[active].dataset.variant;
        count.textContent = \`\${active + 1} / \${panels.length}\`;
        name.textContent = panels[active].dataset.variant;
        picker.open = false;
        mousePointerId = null;
        if (changed) {
          status.textContent = \`\${count.textContent}: \${name.textContent}\`;
        }
      };
      previous.addEventListener("click", () =>
        select((active + panels.length - 1) % panels.length),
      );
      next.addEventListener("click", () =>
        select((active + 1) % panels.length),
      );
      picker.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && picker.open) {
          event.preventDefault();
          picker.open = false;
          mousePointerId = null;
          summary.focus();
          return;
        }
        if (event.altKey || event.ctrlKey || event.metaKey) {
          return;
        }
        const index = choices.indexOf(document.activeElement);
        let nextIndex;
        if (event.key === "ArrowDown") {
          nextIndex = index < 0 ? active : (index + 1) % choices.length;
        } else if (event.key === "ArrowUp") {
          nextIndex = index < 0 ? active : (index + choices.length - 1) % choices.length;
        } else if (picker.open && event.key === "Home") {
          nextIndex = 0;
        } else if (picker.open && event.key === "End") {
          nextIndex = choices.length - 1;
        } else {
          return;
        }
        event.preventDefault();
        picker.open = true;
        choices[nextIndex].focus();
      });
      picker.addEventListener("focusout", (event) => {
        if (!picker.contains(event.relatedTarget)) {
          picker.open = false;
          mousePointerId = null;
        }
      });
      const dismiss = (event) => {
        if (!summary.contains(event.target)) {
          mousePointerId = null;
        }
        if (!picker.contains(event.target)) {
          picker.open = false;
        }
      };
      const endPointerSelection = () => {
        mousePointerId = null;
      };
      const sizePicker = () => {
        root.style.setProperty(
          "--viz-carousel-picker-height",
          \`\${picker.open ? options.offsetHeight : 0}px\`,
        );
      };
      picker.addEventListener("toggle", sizePicker);
      window.addEventListener("resize", sizePicker);
      document.addEventListener("pointerdown", dismiss);
      document.addEventListener("pointerup", endPointerSelection);
      document.addEventListener("pointercancel", endPointerSelection);
      window.addEventListener("blur", endPointerSelection);
      window.addEventListener(
        "pagehide",
        () => {
          document.removeEventListener("pointerdown", dismiss);
          document.removeEventListener("pointerup", endPointerSelection);
          document.removeEventListener("pointercancel", endPointerSelection);
          window.removeEventListener("blur", endPointerSelection);
          window.removeEventListener("resize", sizePicker);
        },
        { once: true },
      );
      root.append(controls, status);
      select(0);
    }
  })();
<\/script>
<script id="codex-visualization-lucide" async src="https://unpkg.com/lucide@1.17.0/dist/umd/lucide.js"><\/script>
<script>
(() => {
  const initialize = () => {
    globalThis.lucide?.createIcons({ attrs: { width: 16, height: 16 } });
  };
  if (globalThis.lucide != null) {
    initialize();
    return;
  }
  document
    .getElementById("codex-visualization-lucide")
    ?.addEventListener("load", initialize, { once: true });
})();
<\/script>
`})))()}function b(e,t){return t||=e.slice(0),Object.freeze(Object.defineProperties(e,{raw:{value:Object.freeze(t)}}))}function x(e,{allowAnnotations:t=!1,treatment:n=!1,calendarRuntime:r=m,initialGlobals:i,downloadCapability:a,innerKit:o=v,lockDocumentOverflow:s=!0,reportToHost:c=!0,styles:l=`:root {
  color-scheme: light dark;
  background-color: var(
    --background,
    var(--color-background-primary, light-dark(rgb(255 255 255), rgb(24 24 24)))
  ) !important;

  /* Agent-facing contract; keep in sync with SKILL.md. */
  --background: var(
    --color-background-primary,
    light-dark(rgb(255 255 255), rgb(24 24 24))
  );
  --foreground: var(
    --color-text-primary,
    light-dark(rgb(26 28 31), rgb(255 255 255))
  );
  --card: color-mix(in oklab, var(--foreground) 5%, var(--background));
  --card-foreground: var(
    --color-text-primary,
    light-dark(rgb(26 28 31), rgb(255 255 255))
  );
  --popover: var(
    --color-background-secondary,
    light-dark(rgb(255 255 255), rgb(45 45 45))
  );
  --popover-foreground: var(
    --color-text-primary,
    light-dark(rgb(26 28 31), rgb(255 255 255))
  );
  --primary: var(
    --color-text-info,
    light-dark(rgb(51 156 255), rgb(131 195 255))
  );
  --primary-foreground: var(
    --color-text-inverse,
    light-dark(rgb(255 255 255), rgb(13 13 13))
  );
  --secondary: var(
    --color-background-secondary,
    light-dark(rgb(255 255 255 / 96%), rgb(54 54 54 / 96%))
  );
  --secondary-foreground: var(
    --color-text-primary,
    light-dark(rgb(26 28 31), rgb(255 255 255))
  );
  --muted: color-mix(in srgb, var(--foreground) 10%, transparent);
  --muted-foreground: var(
    --color-text-secondary,
    light-dark(rgb(26 28 31 / 49.4%), rgb(255 255 255 / 49.8%))
  );
  --accent: var(
    --color-background-info,
    light-dark(rgb(229 242 255), rgb(13 39 63))
  );
  --accent-foreground: var(
    --color-text-info,
    light-dark(rgb(51 156 255), rgb(131 195 255))
  );
  --destructive: var(
    --color-text-warning,
    light-dark(rgb(226 85 7), rgb(255 133 73))
  );
  --border: var(
    --color-border-secondary,
    light-dark(rgb(26 28 31 / 8%), rgb(255 255 255 / 8.2%))
  );
  --input: var(
    --color-border-primary,
    light-dark(
      rgb(26 28 31 / 11.8%),
      color-mix(in oklab, rgb(0 0 0) 10%, transparent)
    )
  );
  --ring: var(
    --color-ring-primary,
    light-dark(rgb(51 156 255), rgb(131 195 255 / 76%))
  );
  --font-size-base: var(--font-text-md-size, 16px);
  --blue: light-dark(rgb(51 156 255), rgb(51 156 255));
  --orange: light-dark(rgb(226 85 7), rgb(251 106 34));
  --green: light-dark(rgb(0 162 64), rgb(64 201 119));
  --red: light-dark(rgb(224 46 42), rgb(255 103 100));
  --purple: light-dark(rgb(146 79 247), rgb(173 123 249));
  --yellow: light-dark(rgb(255 195 0), rgb(255 210 64));
  --viz-series-1: var(--primary);
  --viz-series-2: light-dark(rgb(243 136 59), rgb(245 154 86));
  --viz-series-3: light-dark(rgb(93 201 119), rgb(116 213 139));
  --viz-series-4: light-dark(rgb(235 119 177), rgb(240 143 192));
  --viz-series-5: light-dark(rgb(155 121 236), rgb(170 145 239));
  --viz-series-6: light-dark(rgb(58 185 177), rgb(90 203 194));

  /* Internal implementation variables; not part of the agent contract. */
  --font-sans:
    -apple-system-body, ui-sans-serif, -apple-system, system-ui, "Segoe UI",
    Helvetica, "Apple Color Emoji", Arial, sans-serif, "Segoe UI Emoji",
    "Segoe UI Symbol";
  --font-mono:
    ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono",
    monospace;
  --font-size-normal: max(11px, var(--font-size-base));
  --font-size-tooltip: calc(var(--font-size-base) - 1px);
  --font-size-small: max(11px, calc(var(--font-size-base) - 2px));
  --font-size-h1: calc(var(--font-size-normal) * 1.7142857143);
  --font-size-h2: calc(var(--font-size-normal) * 1.4285714286);
  --font-size-h3: calc(var(--font-size-normal) * 1.2857142857);
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --icon-size: 16px;
  --line-height-normal: calc(var(--font-size-normal) * 1.5);
  --line-height-tooltip: calc(var(--font-size-tooltip) * 1.4285714286);
  --line-height-small: calc(var(--font-size-small) + 4px);
  --corner-shape: round;
  --radius: var(--border-radius-lg, 8px);
  --radius-sm: calc(var(--radius) * 0.5);
  --radius-md: calc(var(--radius) * 0.75);
  --radius-lg: var(--radius);
  --radius-2xl: calc(var(--radius) * 2);
  --radius-full: 9999px;
  --shadow-sm: 0 1px 2px -1px rgb(0 0 0 / 8%);
  --checkmark-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 17 17'%3E%3Cpath d='M12.8961 3.64101C13.1297 3.41418 13.4984 3.37523 13.7779 3.56581C14.0571 3.75635 14.1554 4.11331 14.0299 4.41347L13.9615 4.53847L7.71151 13.7045C7.59411 13.8767 7.4063 13.9877 7.19881 14.0072C6.99136 14.0267 6.78564 13.9533 6.63826 13.806L2.88826 10.056L2.79842 9.9457C2.6192 9.67407 2.64927 9.30496 2.88826 9.06581C3.12738 8.82669 3.49647 8.79676 3.76815 8.97597L3.8785 9.06581L7.03084 12.2182L12.8053 3.74941L12.8961 3.64101Z'/%3E%3C/svg%3E");

  /* Legacy aliases; not part of the current agent contract. */
  --viz-bg: transparent;
  --viz-panel: var(--card);
  --viz-border: var(--border);
  --viz-text: var(--foreground);
  --viz-muted: var(--muted-foreground);
  --viz-accent: var(--primary);
  --viz-accent-text: var(--primary-foreground);
  --viz-accent-bg: var(--accent);
  --viz-font-size: var(--font-size-base);
  --viz-warning: var(--destructive);
}

:root[data-theme="light"] {
  color-scheme: light;
}

:root[data-theme="dark"] {
  color-scheme: dark;
}

* {
  box-sizing: border-box;
}

html > body {
  /* Preserve MCP aliases for older inline renderers without creating :root cycles. */
  --color-background-primary: var(
    --background,
    light-dark(rgb(255 255 255), rgb(24 24 24))
  );
  --color-text-primary: var(
    --foreground,
    light-dark(rgb(26 28 31), rgb(255 255 255))
  );
  --color-border-secondary: var(
    --border,
    light-dark(rgb(26 28 31 / 8%), rgb(255 255 255 / 8.2%))
  );

  margin: 0;
  padding: var(--visualize-paint-gutter, 0px);
  color: var(--foreground);
  background: transparent !important;
  font-family: var(--font-sans) !important;
  -webkit-font-smoothing: antialiased;
  font-size: var(--font-size-base);
  line-height: calc(var(--font-size-base) * 1.625);
  font-weight: var(--font-weight-normal);
}

.cursor-interaction {
  cursor: var(--cursor-interaction, pointer);
}

a {
  color: color-mix(in srgb, var(--viz-accent) 80%, var(--viz-text) 20%);
  cursor: var(--cursor-interaction, pointer);
  text-decoration: none;
  text-underline-offset: 2px;
  font-weight: inherit;
}

a:is(:hover, :focus-visible) {
  text-decoration-line: underline;
  text-decoration-style: dashed;
  text-decoration-thickness: 0.5px;
}

h1,
h2,
h3,
h4,
h5,
h6,
p {
  margin-block: 0;
}
p,
h1,
h2,
h3,
h4,
h5,
h6,
li,
.table {
  font-family: var(--font-sans);
}

h1 {
  font-size: calc(var(--font-size-base) * 1.5);
  line-height: 1.3333333333;
}

h2 {
  font-size: calc(var(--font-size-base) * 1.25);
  line-height: 1.4;
}
h3 {
  font-size: calc(var(--font-size-base) * 1.125);
  line-height: 1.5555555556;
}
h4 {
  font-size: var(--font-size-base);
  line-height: 1.5;
}
h5,
h6 {
  font-size: var(--font-size-base);
  line-height: calc(var(--font-size-base) * 1.625);
}

h1,
h2,
h3,
h4,
h5,
h6,
b,
strong,
th {
  font-weight: 600;
}

code:not(pre code) {
  display: inline;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  corner-shape: var(--corner-shape);
  background: var(--muted);
  font-family: var(--font-mono);
  font-size: 0.92em;
  overflow-wrap: anywhere;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
  word-break: break-word;
}
pre,
pre code {
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 20px;
}

.table-responsive {
  width: 100%;
  overflow-x: auto;
  scrollbar-width: thin;
}

.table {
  width: 100%;
  color: var(--foreground);
  font: inherit;
  text-align: start;
  border-collapse: separate;
  border-spacing: 0;
  font-size: calc(var(--font-size-base) * 0.875);
  line-height: calc(var(--font-size-base) * 1.625);
  font-family: var(--font-sans);
}

.table :is(th, td) {
  padding-block: 10px;
  padding-inline: 0 24px;
  overflow-wrap: anywhere;
  border-bottom: 1px solid var(--border);
  text-align: start;
  vertical-align: top;
  border-bottom-color: color-mix(in srgb, var(--foreground) 5%, transparent);
}
.table :is(th, td):not(:last-child) {
  padding-inline-end: calc(var(--font-size-base) * 1.5);
}

.table-responsive > .table :is(th, td) {
  overflow-wrap: break-word;
}

.table :is(th, td):last-child {
  padding-inline-end: 0;
}

.table :is(caption, thead th) {
  font-weight: 600;
}

.table thead :is(th, td) {
  border-bottom-color: var(--border-strong, var(--input));
  padding-block: calc(var(--font-size-base) / 2);
  line-height: var(--font-size-base);
}

.table tbody tr:last-child :is(th, td) {
  border-bottom: 0;
}
.table tbody :is(th, td) {
  padding-block: calc(var(--font-size-base) * 0.625);
}

.table.table-sm :is(th, td) {
  padding-block: 8px;
}

.table.table-sm :is(th, td):not(:last-child) {
  padding-inline-end: 16px;
}

.table :is(.text-end, [align="right"]) {
  text-align: end;
  font-variant-numeric: tabular-nums;
}

.table :is(.text-center, [align="center"]) {
  text-align: center;
}

.table .text-nowrap {
  white-space: nowrap;
}

#widget {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  padding: 0;
  background: transparent !important;
}

.card {
  min-width: 0;
  padding: 12px;
  overflow: hidden;
  overflow-wrap: break-word;
  border-radius: var(--radius-2xl);
  corner-shape: var(--corner-shape);
  color: var(--card-foreground);
  background: var(--card);
}

.widget {
  min-width: 0;
  overflow: hidden;
  border: 0;
  border-radius: var(--radius-lg);
  corner-shape: var(--corner-shape);
  box-shadow: 0 0 0 0.5px var(--border-strong, var(--border));
  color: var(--foreground);
  background: var(--background);
}

#widget > :not(.card, .widget, .progress) {
  width: 100% !important;
  max-width: none !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

.tooltip {
  position: fixed;
  z-index: 50;
  top: 0;
  left: 0;
  width: max-content;
  max-width: min(
    20rem,
    var(--tooltip-available-width, calc(100vw - 10px)),
    calc(100vw - 10px)
  );
  max-height: min(
    var(--tooltip-available-height, calc(100vh - 10px)),
    calc(100vh - 10px)
  );
  border: 1px solid var(--border);
  corner-shape: var(--corner-shape);
  overflow-wrap: break-word;
  white-space: normal;
  pointer-events: none;
  user-select: none;
  font-family: var(--font-sans);
  padding: 5px 12px;
  border-color: color-mix(
    in oklab,
    light-dark(var(--primary-foreground), var(--foreground)) 5%,
    transparent
  );
  border-radius: var(--radius-2xl);
  color: light-dark(var(--primary-foreground), var(--foreground));
  background: light-dark(var(--foreground), var(--popover));
  box-shadow: 0 8px 18px rgb(15 23 42 / 20%);
  letter-spacing: -0.15px;
  font-size: calc(var(--font-size-base) * 14 / 16);
  font-size: round(nearest, calc(var(--font-size-base) * 14 / 16), 1px);
  font-weight: 600;
  line-height: 18px;
  text-align: center;
}

.viz-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(max(180px, 24%), 1fr));
  gap: 10px;
}

.viz-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.viz-stat-value {
  font-size: var(--font-size-h2);
  font-weight: var(--font-weight-medium);
  line-height: 1.25;
}

.viz-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

hr {
  width: 100%;
  height: 1px;
  margin-block: 6px;
  border: 0;
  background: var(--border);
}

.nav {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 4px;
}

.progress {
  display: flex;
  height: 8px;
  margin-block: calc((var(--line-height-normal, 1.5em) - 8px) / 2);
  overflow: hidden;
  border: 0;
  border-radius: var(--radius-full);
  background: var(--muted);
}

.progress-bar:only-child {
  border-radius: var(--radius-full);
}

.progress-bar {
  height: 100%;
  flex-shrink: 0;
  border: 0;
  background: var(--viz-series-1);
}

.viz-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  color: color-mix(in srgb, var(--foreground) 40%, var(--muted-foreground));
  background: color-mix(in srgb, var(--foreground) 5%, transparent);
  font-family: var(--font-sans);
  font-size: calc(var(--font-size-base) * 14 / 16);
  font-size: round(nearest, calc(var(--font-size-base) * 14 / 16), 1px);
  font-weight: var(--font-weight-normal);
  line-height: 1;
}

small,
.text-small {
  font-size: var(--font-size-small);
  line-height: var(--line-height-small);
}

.text-muted {
  color: var(--muted-foreground);
}

.tabular-nums {
  font-variant-numeric: tabular-nums;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.viz-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.viz-controls > .form-label {
  display: grid;
  min-width: min(100%, 260px);
  flex: 1 1 280px;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 2px 12px;
  margin-bottom: 0;
}

.viz-controls > .form-label > :is(.form-control, .form-range, .form-select) {
  grid-column: 1 / -1;
}

.btn,
.nav-link,
.form-check-input,
.form-control,
.form-range,
.form-select {
  font: inherit;
}

/* Match inline alignment without overriding a containing flex or grid layout. */
.btn,
.nav-link,
.form-control,
.form-select,
.form-range,
.form-check {
  vertical-align: middle;
}

.btn,
.nav-link {
  appearance: button;
  display: inline-flex;
  inline-size: fit-content;
  max-inline-size: 100%;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin: 0;
  padding: 0 8px;
  -webkit-app-region: no-drag;
  border: 1px solid var(--input);
  corner-shape: var(--corner-shape);
  cursor: var(--cursor-interaction, pointer);
  text-align: center;
  text-decoration: none;
  white-space: nowrap;
  user-select: none;
  -webkit-font-smoothing: inherit;
  font-family: var(--font-sans);
  height: fit-content;
  min-height: calc(12px + 2 * var(--control-spacing, 12px));
  padding-inline: var(--control-spacing, 12px);
  border-color: transparent;
  border-radius: var(--radius-full);
  color: var(--foreground);
  background: color-mix(in srgb, var(--foreground) 5%, transparent);
  font-size: calc(var(--font-size-base) * 14 / 16);
  font-size: round(nearest, calc(var(--font-size-base) * 14 / 16), 1px);
  font-weight: var(--font-weight-normal);
  line-height: 18px;
}

.btn {
  border-color: var(--border);
  color: var(--secondary-foreground);
  background: var(--secondary);
}

.btn:is(.btn-block, .viz-tile) {
  inline-size: 100%;
}

.btn.viz-tile {
  min-width: 0;
  overflow-wrap: anywhere;
  white-space: normal;
}

a.btn {
  cursor: var(--cursor-interaction, pointer);
  text-decoration: none;
}

.btn:not(:disabled):hover {
  background: light-dark(
    color-mix(in srgb, var(--foreground) 5.5%, transparent),
    color-mix(in srgb, var(--foreground) 8%, transparent)
  );
}

.nav-link:not(:disabled):not([aria-disabled="true"]):hover {
  background: color-mix(in srgb, var(--foreground) 10%, transparent);
}

.btn-primary {
  border-color: var(--border);
  color: var(--primary-foreground);
  background: var(--foreground);
  background-clip: border-box;
}

.btn-primary .text-muted {
  color: color-mix(in srgb, var(--primary-foreground) 50%, transparent);
}

.btn-primary:not(:disabled):hover {
  background: color-mix(in srgb, var(--foreground) 80%, transparent);
  background-clip: border-box;
}

.btn-ghost {
  border-color: transparent;
  color: var(--muted-foreground);
  background: transparent;
}

.btn-ghost:not(:disabled):hover {
  color: var(--muted-foreground);
  background: light-dark(
    color-mix(in srgb, var(--foreground) 5.5%, transparent),
    color-mix(in srgb, var(--foreground) 8%, transparent)
  );
}

.nav-pills .nav-link {
  min-width: 0;
  border-color: transparent;
  color: var(--muted-foreground);
  background: transparent;
}

.nav-justified .nav-link {
  flex: 1 1 0;
  overflow-wrap: anywhere;
  white-space: normal;
}

.nav-pills .nav-link.active {
  color: var(--foreground);
  background: var(--muted);
}

/* Shared preview chrome; product styles stay inside each variant. */
.viz-dotted-background {
  background-image: radial-gradient(
    circle,
    color-mix(in srgb, var(--foreground) 14%, transparent) 0.8px,
    transparent 0.8px
  );
  background-position: center;
  background-size: 16px 16px;
}

.viz-carousel {
  position: relative;
  min-width: 0;
}

.viz-carousel:has(> .viz-carousel-controls) {
  min-height: calc(60px + var(--viz-carousel-picker-height, 0px));
  padding-bottom: 60px;
}

.viz-carousel > [data-variant][hidden] {
  display: none !important;
}

.viz-carousel > [data-variant] {
  isolation: isolate;
}

.viz-carousel-controls {
  --viz-carousel-hover: light-dark(
    color-mix(in srgb, var(--foreground) 5.4%, transparent),
    color-mix(in srgb, var(--foreground) 7.8%, transparent)
  );
  position: absolute;
  z-index: 2;
  bottom: 8px;
  left: 50%;
  display: flex;
  width: max-content;
  /* Leave room for the host's design-controls launcher at the trailing edge. */
  max-width: calc(100% - 96px);
  align-items: center;
  gap: 0;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 16px;
  color: var(--foreground);
  background: var(--background);
  font-family: var(--font-sans);
  /* Match the settings dropdown chrome independently of the content font size. */
  font-size: 13px;
  font-weight: var(--font-weight-normal);
  line-height: 18px;
  transform: translateX(-50%);
  user-select: none;
}

/* Keep authored mockup button styles out of the shared carousel chrome. */
.viz-carousel-controls button,
.viz-carousel-picker > summary {
  display: flex !important;
  height: auto !important;
  min-height: 30px;
  align-items: center !important;
  justify-content: center !important;
  gap: 4px;
  padding: 0 6px !important;
  -webkit-app-region: no-drag;
  border: 0 !important;
  border-radius: 14px !important;
  color: inherit !important;
  background: transparent !important;
  font: inherit !important;
  -webkit-tap-highlight-color: transparent;
}

.viz-carousel-controls > button,
.viz-carousel-picker > summary {
  position: relative;
  isolation: isolate;
}

.viz-carousel-controls > button {
  --icon-size: 16px;
  width: 30px !important;
  padding: 0 !important;
}

.viz-carousel-picker > summary {
  padding-inline: 12px !important;
}

.viz-carousel-controls .viz-carousel-caret {
  width: 14px;
  height: 14px;
  flex: none;
  margin: 0;
  color: inherit;
  transform: rotate(180deg);
}

.viz-carousel-controls > button > svg,
.viz-carousel-controls .viz-carousel-caret,
.viz-carousel-count {
  opacity: 0.5;
}

.viz-carousel-controls > button::before,
.viz-carousel-picker > summary::before {
  position: absolute;
  z-index: -1;
  inset: 3px;
  border-radius: 12px;
  content: "";
  pointer-events: none;
}

.viz-carousel-controls > button:hover::before,
.viz-carousel-picker > summary:hover::before {
  background: var(--viz-carousel-hover);
}

.viz-carousel-controls > button,
.viz-carousel-controls [data-lucide],
.viz-carousel-controls .lucide {
  flex-shrink: 0;
}

.viz-carousel-picker {
  min-width: 0;
}

.viz-carousel-picker > summary {
  min-width: 0;
  list-style: none;
}

.viz-carousel-picker > summary::-webkit-details-marker {
  display: none;
}

.viz-carousel-count {
  flex-shrink: 0;
  white-space: nowrap;
}

.viz-carousel-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.viz-carousel-options {
  position: absolute;
  right: 0;
  bottom: calc(100% + 4px);
  left: 0;
  display: flex;
  max-height: 240px;
  flex-direction: column;
  gap: 2px;
  overflow: auto;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--background);
  box-shadow: 0 4px 12px light-dark(rgb(0 0 0 / 6%), rgb(0 0 0 / 25%));
}

.viz-carousel-options > button {
  border-radius: max(0px, calc(var(--radius-lg) - 5px)) !important;
  width: 100% !important;
  min-height: 28px;
  justify-content: flex-start !important;
  padding: 4px 8px !important;
  font-size: var(--font-size-small) !important;
  text-align: start;
  white-space: normal;
  overflow-wrap: anywhere;
}

.viz-carousel-options > [aria-current="true"],
.viz-carousel-options > button:hover {
  background: var(--viz-carousel-hover) !important;
}

.btn:disabled,
.nav-link:disabled,
.nav-link[aria-disabled="true"] {
  cursor: not-allowed;
  opacity: 0.4;
}

[data-lucide] {
  stroke-width: 1.6;
}

.form-label {
  display: block;
  margin-bottom: 6px;
  color: var(--foreground);
}

.form-control {
  display: block;
  width: 100%;
  padding: 0 8px;
  outline: none;
  border: 1px solid var(--input);
  corner-shape: var(--corner-shape);
  color: var(--foreground);
  font-family: var(--font-sans);
  height: calc(12px + 2 * var(--control-spacing, 12px));
  min-height: calc(12px + 2 * var(--control-spacing, 12px));
  padding-inline: calc(4px + var(--control-spacing, 12px) / 2);
  border-color: var(--input);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--popover) 96%, transparent);
  font-size: calc(var(--font-size-base) * 14 / 16);
  font-size: round(nearest, calc(var(--font-size-base) * 14 / 16), 1px);
  font-weight: var(--font-weight-normal);
  line-height: 1.4285714286;
}
.form-control:is(
  [type="file"],
  [type="date"],
  [type="datetime-local"],
  [type="month"],
  [type="week"],
  [type="color"]
) {
  height: calc(12px + 2 * var(--control-spacing, 12px));
  min-height: calc(12px + 2 * var(--control-spacing, 12px));
  line-height: 18px;
}
.form-control:is(
  [type="date"],
  [type="datetime-local"],
  [type="month"],
  [type="week"]
) {
  padding-inline: var(--control-spacing, 12px);
}

.form-control::placeholder {
  color: var(--muted-foreground);
}

.form-control[type="file"] {
  overflow: hidden;
  cursor: var(--cursor-interaction, pointer);
  padding: 0;
}

.form-control[type="file"]::file-selector-button {
  padding: 0 8px;
  border: 0;
  border-right: 1px solid var(--input);
  color: var(--secondary-foreground);
  background: var(--secondary);
  cursor: inherit;
  font: inherit;
  min-height: calc(10px + 2 * var(--control-spacing, 12px));
  padding-inline: var(--control-spacing, 12px);
  margin-inline-end: var(--control-spacing, 12px);
}

.form-control[type="file"]:not(:disabled):hover::file-selector-button {
  background: color-mix(in srgb, var(--foreground) 6%, var(--secondary));
}

.form-control-color[type="color"] {
  width: 40px;
  height: calc(12px + 2 * var(--control-spacing, 12px));
  padding: 3px;
  cursor: var(--cursor-interaction, pointer);
}

.form-control-color[type="color"]::-webkit-color-swatch-wrapper {
  padding: 0;
}

.form-control-color[type="color"]::-webkit-color-swatch {
  border: 0;
  border-radius: calc(var(--radius-lg) - 4px);
  corner-shape: var(--corner-shape);
}

textarea.form-control {
  height: auto;
  resize: vertical;
  min-height: 96px;
  padding: 8px 10px;
}

.form-control:focus-visible {
  border-color: var(--ring);
  box-shadow: none;
}
.form-control:disabled {
  color: var(--muted-foreground);
  background: color-mix(in srgb, var(--foreground) 5%, transparent);
  opacity: 1;
}
.form-control[aria-invalid="true"] {
  border-color: var(--red);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--red) 20%, transparent);
}

.form-control:disabled,
.form-select:disabled {
  cursor: not-allowed;
}

.form-select {
  appearance: none;
  display: block;
  width: 100%;
  height: fit-content;
  min-height: calc(12px + 2 * var(--control-spacing, 12px));
  margin: 0;
  /* The secondary icon role is 14px at compact density and 16px at web density. */
  --icon-size: calc(10px + var(--control-spacing, 12px) / 2);
  /* Settings dropdowns retain a 12px inset and a 4px text-to-chevron gap. */
  padding: 0 calc(16px + var(--icon-size)) 0 12px;
  outline: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  corner-shape: var(--corner-shape);
  color: var(--foreground);
  background-color: var(--secondary);
  background-image:
    linear-gradient(
      45deg,
      transparent calc(50% - 0.6px),
      var(--muted-foreground) calc(50% - 0.6px) calc(50% + 0.6px),
      transparent calc(50% + 0.6px)
    ),
    linear-gradient(
      135deg,
      transparent calc(50% - 0.6px),
      var(--muted-foreground) calc(50% - 0.6px) calc(50% + 0.6px),
      transparent calc(50% + 0.6px)
    );
  background-position:
    calc(100% - 12px - var(--icon-size) / 2) 50%,
    calc(100% - 12px - var(--icon-size) * 0.18) 50%;
  background-repeat: no-repeat;
  background-size: calc(var(--icon-size) * 0.32) calc(var(--icon-size) * 0.32);
  cursor: var(--cursor-interaction, default);
  font-size: calc(var(--font-size-base) * 14 / 16);
  font-size: round(nearest, calc(var(--font-size-base) * 14 / 16), 1px);
  font-weight: var(--font-weight-normal);
  line-height: 18px;
}

.form-select option {
  color: var(--popover-foreground);
  background-color: var(--popover);
}

.form-select:not(:disabled):hover {
  background-color: light-dark(
    color-mix(in srgb, var(--foreground) 5.5%, transparent),
    color-mix(in srgb, var(--foreground) 8%, transparent)
  );
}

.form-select:focus-visible {
  box-shadow: 0 0 0 2px var(--ring);
}
.form-select:disabled {
  opacity: 0.4;
}

.form-check {
  display: flex;
  min-height: calc(12px + 2 * var(--control-spacing, 12px));
  align-items: center;
  gap: 6px;
}

.form-check-input {
  appearance: none;
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  margin: 0;
  border: 1px solid var(--input);
  color: var(--primary-foreground);
  background-color: transparent;
  cursor: var(--cursor-interaction, default);
  transition:
    background-color 150ms,
    border-color 150ms,
    box-shadow 150ms;
}

.form-check:not(.form-switch) .form-check-input[type="checkbox"] {
  corner-shape: round;
  box-shadow: var(--shadow-sm);
  position: relative;
  width: calc(10px + var(--control-spacing, 12px) / 2);
  height: calc(10px + var(--control-spacing, 12px) / 2);
  border-color: var(--border-strong, var(--input));
  border-radius: calc(var(--radius-sm) / 2);
  background-color: transparent;
  color: var(--foreground);
}

.form-check:not(.form-switch)
  .form-check-input:not(:disabled):not(:checked):hover {
  background-color: var(--card);
}

.form-check:not(.form-switch)
  .form-check-input[type="checkbox"]:is(:checked, :indeterminate) {
  border-color: var(--border-strong, var(--input));
  background-color: color-mix(in srgb, var(--popover) 96%, transparent);
}

.form-check:not(.form-switch)
  .form-check-input[type="checkbox"]:checked::before {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--primary-foreground);
  content: "";
  mask: var(--checkmark-image) center / 12px 12px no-repeat;
  background-color: var(--foreground);
}
.form-check:not(.form-switch)
  .form-check-input[type="checkbox"]:indeterminate::before {
  position: absolute;
  inset: 0;
  display: block;
  width: 65%;
  height: 6.65%;
  margin: auto;
  border-radius: var(--radius-full);
  background: var(--foreground);
  mask: none;
  content: "";
}

.form-check-input[type="radio"] {
  border-radius: var(--radius-full);
  width: 16px;
  height: 16px;
  border: 0;
  box-shadow: inset 0 0 0 1px var(--input);
}

.form-check-input[type="radio"]:checked {
  border: 0;
  background: radial-gradient(
    circle,
    var(--primary-foreground) 0 3px,
    var(--foreground) 3px
  );
  box-shadow: none;
}

.form-check:not(.form-switch) .form-check-input:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
.form-check:not(.form-switch) .form-check-input[type="checkbox"]:focus-visible {
  border-color: var(--ring);
  outline: none;
  box-shadow: 0 0 0 2px var(--ring);
}

.form-check:not(.form-switch) .form-check-input:disabled {
  cursor: not-allowed;
  pointer-events: none;
}

.form-check:not(.form-switch) .form-check-input:disabled + .form-check-label {
  cursor: not-allowed;
}
.form-check:not(.form-switch) .form-check-input[type="radio"]:disabled,
.form-check:not(.form-switch)
  .form-check-input[type="radio"]:disabled
  + .form-check-label {
  opacity: 0.5;
}

.form-switch .form-check-input:disabled,
.form-switch .form-check-input:disabled + .form-check-label {
  cursor: not-allowed;
  opacity: 0.6;
}

.form-check-label {
  color: var(--foreground);
  cursor: var(--cursor-interaction, default);
}

.form-switch .form-check-input {
  position: relative;
  width: 32px;
  height: 20px;
  border: 0;
  border-radius: var(--radius-full);
  background: var(--muted);
  box-shadow: none;
  transition: background-color 200ms cubic-bezier(0, 0, 0.2, 1);
}

.form-switch .form-check-input::before {
  position: absolute;
  top: 50%;
  left: 0;
  width: 16px;
  height: 16px;
  box-sizing: border-box;
  border: 1px solid light-dark(var(--primary-foreground), var(--foreground));
  border-radius: var(--radius-full);
  box-shadow: var(--shadow-sm);
  content: "";
  transform: translate(2px, -50%);
  transition: transform 200ms cubic-bezier(0, 0, 0.2, 1);
  border-color: #fff;
  background: #fff;
}

.form-switch .form-check-input:checked {
  background: var(--blue);
}

.form-switch .form-check-input:checked::before {
  transform: translate(14px, -50%);
}

.form-switch .form-check-input:focus-visible {
  box-shadow: 0 0 0 2px var(--ring);
  outline: none;
}

.form-range {
  appearance: none;
  display: block;
  width: 100%;
  flex: 1;
  margin: 0;
  padding: 0;
  border: 0;
  accent-color: var(--primary);
  height: calc(12px + 2 * var(--control-spacing, 12px));
  min-height: calc(12px + 2 * var(--control-spacing, 12px));
  outline: none;
  border-radius: var(--radius-full);
  color: var(--foreground);
  background: transparent;
}

.form-range::-webkit-slider-runnable-track {
  background: var(--form-range-track, var(--border));
  height: 2px;
  border-radius: var(--radius-full);
}

.form-range::-webkit-slider-thumb {
  appearance: none;
  width: 20px;
  height: 20px;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  margin-top: -9px;
  border-color: transparent;
  background: currentColor;
  box-shadow: var(--shadow-sm);
}

/* Outline the native track and thumb, preserving the larger input hit area. */
.form-range:focus-visible::-webkit-slider-runnable-track {
  outline: 2px auto Highlight;
  outline-color: -webkit-focus-ring-color;
}

.form-range::-moz-range-track {
  background: var(--form-range-track, var(--border));
  height: 2px;
  border-radius: var(--radius-full);
}

.form-range::-moz-range-thumb {
  width: 20px;
  height: 20px;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  border-color: transparent;
  background: currentColor;
  box-shadow: var(--shadow-sm);
}

.form-range:focus-visible::-moz-range-thumb {
  outline: 2px solid Highlight;
  outline-offset: 2px;
}

.form-range:disabled {
  opacity: 1;
  cursor: default;
}

.btn:not(.btn-primary, .viz-tile):is(
  [aria-pressed="true"],
  [aria-selected="true"],
  .is-selected
) {
  border-color: transparent;
  color: var(--primary-foreground);
  background: var(--blue);
}

.btn.viz-tile:is([aria-pressed="true"], [aria-selected="true"], .is-selected) {
  border-color: var(--primary);
  box-shadow: inset 0 0 0 1px var(--primary);
}

.btn:focus-visible,
.nav-link:focus-visible {
  outline-offset: 2px;
  outline: none;
  box-shadow: 0 0 0 2px var(--ring);
}

.viz-carousel-controls :is(button, summary):focus-visible {
  outline: 2px solid var(--ring) !important;
  outline-offset: 2px !important;
}

/* Web recipes are the default, including on renderers without inline style queries. */
@supports (border-radius: if(style(--corner-shape: round): 1px; else: 2px)) {
  /* Match the host's proportional text-sm scale at every text preference. */
  .tooltip,
  .viz-badge,
  .btn,
  .nav-link,
  .form-control,
  .form-select {
    font-size: if(
      style(--corner-shape: round): round(
          nearest,
          calc(var(--font-size-base) * 14 / 16),
          1px
        );
        else: round(nearest, calc(var(--font-size-base) * 13 / 14), 1px)
    );
  }

  .btn,
  .nav-link,
  .form-select {
    border-radius: if(
      style(--corner-shape: round): var(--radius-full); else: var(--radius-lg)
    );
  }

  .form-check:not(.form-switch) .form-check-input[type="checkbox"] {
    border-radius: if(
      style(--corner-shape: round): calc(var(--radius-sm) / 2);
        else: calc(var(--radius-lg) * 0.4)
    );
  }

  .tooltip {
    font-weight: if(
      style(--corner-shape: round): 600; else: var(--font-weight-normal)
    );
  }
}

@media (pointer: coarse) {
  .viz-carousel:has(> .viz-carousel-controls) {
    min-height: calc(76px + var(--viz-carousel-picker-height, 0px));
    padding-bottom: 76px;
  }

  .btn,
  .nav-link,
  .viz-carousel-controls button,
  .viz-carousel-picker > summary,
  .form-control,
  .form-select {
    min-width: 44px;
    min-height: 44px;
  }

  /* Keep small-screen WebKit from zooming when a text field receives focus. */
  .form-control,
  .form-select {
    font-size: max(16px, calc(var(--font-size-base) * 14 / 16));
    font-size: max(
      16px,
      round(nearest, calc(var(--font-size-base) * 14 / 16), 1px)
    );
  }
  .form-control:is(
    [type="file"],
    [type="date"],
    [type="datetime-local"],
    [type="month"],
    [type="week"],
    [type="time"],
    [type="color"]
  ) {
    height: 44px;
    min-height: 44px;
    font-size: max(16px, calc(var(--font-size-base) * 14 / 16));
    font-size: max(
      16px,
      round(nearest, calc(var(--font-size-base) * 14 / 16), 1px)
    );
  }

  .form-control[type="file"]::file-selector-button {
    min-width: 44px;
    min-height: 44px;
  }

  .form-control-color[type="color"] {
    width: 44px;
    height: 44px;
  }

  .form-control:is(
    [type="date"],
    [type="datetime-local"],
    [type="month"],
    [type="time"],
    [type="week"]
  ) {
    min-width: 0;
    max-width: 100%;
    padding-block: 8px;
  }

  .form-check {
    min-height: 44px;
    padding-inline: 15px;
  }

  .form-check-input {
    position: relative;
  }

  .form-check-input::after {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 44px;
    height: 44px;
    content: "";
    transform: translate(-50%, -50%);
  }

  .form-check-label {
    display: inline-flex;
    min-width: 44px;
    min-height: 44px;
    align-items: center;
  }

  .form-range {
    height: 44px;
    touch-action: pan-y;
  }
}

svg {
  display: block;
  max-width: 100%;
  height: auto;
}

#widget > svg {
  width: 100%;
}

/* Model-authored chart rules can otherwise stretch icons after these styles load. */
svg.lucide {
  display: block;
  width: var(--icon-size) !important;
  height: var(--icon-size) !important;
  flex: none;
  margin: 0 !important;
  stroke-width: 1.6;
}

.text-warning,
.text-destructive {
  color: var(--destructive);
}
`,syncHostStyles:u=!0}={}){let d=i==null?``:`<script>globalThis.__codexVisualizationInitialGlobals=${JSON.stringify(i).replaceAll(`<`,`\\u003c`)};<\/script>\n`,p=c&&a!=null?`\n${S(a)}`:``,h=c?`${F}\n${I}\n${L}\n${R}\n${z}\n${V}${p}`:``;return`${l===``?``:`<style>${l}</style>\n`}${o.replace(N,()=>`${d}${H.replace(`__CODEX_VISUALIZATION_SYNC_HOST_STYLES__`,JSON.stringify(u))}
${h}
${c&&t?`<script>${f.replaceAll(`<\/script`,`<\\/script`)}<\/script>`:``}
${r!=null&&/\bviz-calendar\b/i.test(e)?`<script>${r.replaceAll(`<\/script`,`<\\/script`)}<\/script>`:``}
${e}
${c?B:``}
${M}
${s?j:``}`)}`}function S(e){return`<script>${g.replace(JSON.stringify(P),JSON.stringify(e).replaceAll(`<`,`\\u003c`)).replaceAll(`<\/script`,`<\\/script`)}<\/script>`}var C,w,T,E,D,O,k,A,j,M,N,P,F,I,L,R,z,B,V,H;function U(){return(U=e((()=>{u(),p(),h(),l(),_(),y(),s(),j=`<style id="codex-visualization-document-overflow">html,body{overflow-y:hidden!important}</style>`,M=`<style id="codex-visualization-document-scrollbar">html,body{scrollbar-width:none!important}html::-webkit-scrollbar,body::-webkit-scrollbar{display:none!important}</style>`,N=`<!--__INLINE_VISUALIZATION_FRAGMENT__-->`,P=`__CODEX_INLINE_VISUALIZATION_DOWNLOAD_CAPABILITY__`,F=String.raw(C||=b([`<script>
(() => {
  const reportEnvironmentError = (value) => {
    const error = value instanceof Error ? value : new Error(String(value));
    void globalThis.openai
      .callTool(
        "`,`",
        {
          message: error.message,
          name: error.name,
          stack: error.stack,
        },
      )
      .catch(() => {});
  };

  globalThis.addEventListener("error", (event) => {
    reportEnvironmentError(event.error ?? event.message);
  });
  globalThis.addEventListener("unhandledrejection", (event) => {
    reportEnvironmentError(event.reason);
  });
})();
<\/script>`]),r),I=String.raw(w||=b([`<script id="codex-visualization-variants">
(() => {
  let previousSnapshot = "[]";
  let roots = [];
  const report = () => {
    roots = Array.from(
      document.querySelectorAll(".viz-carousel[data-active-variant]"),
    ).slice(0, 32);
    const selectedVariants = roots.flatMap((root, carousel) => {
      const variant = root.dataset.activeVariant;
      const label = root.getAttribute("aria-label")?.slice(0, 256);
      return variant ? [{
        carousel,
        ...(label == null ? {} : { label }),
        variant: variant.slice(0, 256),
      }] : [];
    });
    const snapshot = JSON.stringify(selectedVariants);
    if (snapshot !== previousSnapshot) {
      previousSnapshot = snapshot;
      void globalThis.openai.callTool("`,`", {
        type: "variants",
        selectedVariants,
      }).catch(() => {});
    }
  };
  const observer = new MutationObserver((records) => {
    if (records.some((record) => record.type === "attributes") || roots.some((root) => !root.isConnected)) {
      report();
    }
  });
  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-active-variant"],
  });
  report();
  globalThis.addEventListener("pagehide", () => observer.disconnect(), { once: true });
})();
<\/script>`]),d),L=String.raw(T||=b([`<script>
(() => {
  let isHovering = false;
  let isTouch = false;
  const reportHover = (nextIsHovering, nextIsTouch = false) => {
    if (nextIsHovering === isHovering && nextIsTouch === isTouch) {
      return;
    }
    isHovering = nextIsHovering;
    isTouch = nextIsTouch;
    void globalThis.openai
      .callTool(
        "`,`",
        isTouch ? { isHovering, pointerType: "touch" } : { isHovering },
      )
      .catch(() => {});
  };

  globalThis.addEventListener(
    "pointerover",
    (event) =>
      reportHover(event.pointerType !== "touch", event.pointerType === "touch"),
    { capture: true },
  );
  globalThis.addEventListener(
    "pointerout",
    (event) => {
      if (event.pointerType !== "touch" && event.relatedTarget == null) {
        reportHover(false);
      }
    },
    { capture: true },
  );
})();
<\/script>`]),i),R=String.raw(E||=b([`<script>
(() => {
  const report = (method) => {
    void globalThis.openai.callTool("`,`", { method }).catch(() => {});
  };
  globalThis.addEventListener("pointerdown", () => report("pointer"), { capture: true });
  globalThis.addEventListener("keydown", (event) => {
    if (!event.isComposing && event.key !== "Shift" && !event.altKey && !event.ctrlKey && !event.metaKey) {
      report(`,`.includes(event.key) ? "keyboard-navigation" : "keyboard");
    }
  }, { capture: true });
})();
<\/script>`]),a,JSON.stringify(c)),z=String.raw(D||=b([`<script>
(() => {
  const bubbledClicks = new WeakSet();
  const interactiveSelector = [
    "button", "input", "select", "textarea", "label", "summary", "a[href]",
    "audio[controls]", "video[controls]", "[onclick]", "[data-visualization-interactive]",
    '[contenteditable]:not([contenteditable="false"])',
    ...[
      "button", "checkbox", "combobox", "gridcell", "link", "listbox",
      "menuitem", "menuitemcheckbox", "menuitemradio", "option", "radio",
      "scrollbar", "searchbox", "slider", "spinbutton", "switch", "tab",
      "textbox", "treeitem",
    ].map((role) => '[role~="' + role + '"]'),
  ].join(",");

  globalThis.addEventListener("click", (event) => bubbledClicks.add(event));
  globalThis.addEventListener("click", (event) => {
    // Capture the path before a control can remove itself. Custom delegated
    // controls can opt in with data-visualization-interactive.
    const elements = event.composedPath().filter((target) => target instanceof Element);
    const isInteractiveTarget = elements.some((element) =>
      element.matches(interactiveSelector) ||
      (element.hasAttribute("tabindex") && element.tabIndex >= 0)) ||
      (elements[0] != null && getComputedStyle(elements[0]).cursor === "pointer");
    // Use a task, not a microtask: native dispatch can run microtasks between
    // listeners. Propagation flags are reset when dispatch finishes:
    // https://dom.spec.whatwg.org/#concept-event-dispatch
    globalThis.setTimeout(() => {
      void globalThis.openai.callTool("`,`", {
        isInteractive: isInteractiveTarget || event.defaultPrevented ||
          (event.bubbles && !bubbledClicks.has(event)),
      }).catch(() => {});
    }, 0);
  }, { capture: true });
})();
<\/script>`]),o),B=String.raw(O||=b([`<script>
(() => {
  const contentRange = document.createRange();
  let previousMeasurement = null;
  let heightReportTimer = null;
  const reportHeight = () => {
    const bodyChildren = Array.from(document.body.children).filter(
      (element) =>
        element.tagName !== "SCRIPT" &&
        element.tagName !== "STYLE" &&
        element.getAttribute("role") !== "tooltip",
    );
    const bodyStyle = globalThis.getComputedStyle(document.body);
    const contentWidth = Math.max(
      0,
      Math.round(
        globalThis.innerWidth -
          parseFloat(bodyStyle.paddingLeft) -
          parseFloat(bodyStyle.paddingRight),
      ),
    );
    let contentHeight;
    if (bodyChildren.length === 0) {
      contentRange.selectNodeContents(document.body);
      contentHeight = contentRange.getBoundingClientRect().height;
    } else if (bodyChildren.length === 1) {
      const [bodyChild] = bodyChildren;
      const childRect = bodyChild.getBoundingClientRect();
      // Child margins can collapse above the root without adding to its height.
      // The host adds body padding separately.
      contentHeight =
        Math.max(bodyChild.scrollHeight, childRect.height) +
        Math.max(
          0,
          childRect.top -
            document.body.getBoundingClientRect().top -
            parseFloat(bodyStyle.paddingTop),
        );
    } else {
      const bodyTop = document.body.getBoundingClientRect().top;
      contentHeight = Math.max(
        ...bodyChildren.map(
          (bodyChild) => bodyChild.getBoundingClientRect().bottom - bodyTop,
        ),
      );
    }
    const viewportHeight = globalThis.innerHeight;
    const previous = previousMeasurement;
    previousMeasurement = { contentHeight, contentWidth, viewportHeight };
    if (
      previous != null &&
      contentWidth === previous.contentWidth &&
      contentHeight - previous.contentHeight ===
        viewportHeight - previous.viewportHeight
    ) {
      return;
    }

    void globalThis.openai
      .callTool(
        "`,`",
        { height: contentHeight, width: contentWidth },
      )
      .catch(() => {});
  };
  const scheduleHeightReport = () => {
    if (heightReportTimer != null) {
      return;
    }
    // Offscreen frames can suspend animation callbacks while their content loads.
    heightReportTimer = globalThis.setTimeout(() => {
      heightReportTimer = null;
      reportHeight();
    }, 0);
  };

  const resizeObserver = new ResizeObserver(scheduleHeightReport);
  const observeBodyChildren = () => {
    for (const element of document.body.children) {
      resizeObserver.observe(element);
    }
  };
  resizeObserver.observe(document.body);
  observeBodyChildren();
  new MutationObserver(() => {
    observeBodyChildren();
    scheduleHeightReport();
  }).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "class", "height", "width"],
  });
  globalThis.addEventListener("resize", scheduleHeightReport);
  reportHeight();
})();
<\/script>`]),t),V=String.raw(k||=b([`<script>
(() => {
  globalThis.addEventListener("keydown", (event) => {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey ||
      event.shiftKey || !["ArrowLeft", "ArrowRight", "Escape"].includes(event.key)) {
      return;
    }
    const target = event.composedPath().find((element) => element instanceof HTMLElement);
    const editable = target?.closest("[contenteditable]");
    const editing = target && (target.isContentEditable ||
      (editable && editable.getAttribute("contenteditable") !== "false") ||
      target.closest('input, textarea, select, [role="slider"], [role="spinbutton"], [role="combobox"], [role="listbox"], [role="grid"], [role="tree"], [role="tablist"], [role="menu"]'));
    if (event.key !== "Escape" && editing) { return; }
    // Let the widget handle the key before forwarding it across the sandbox.
    globalThis.setTimeout(() => {
      if (!event.defaultPrevented && globalThis.openai?.displayMode === "fullscreen") {
        void globalThis.openai.callTool("`,`", {
          key: event.key,
        }).catch(() => {});
      }
    }, 0);
  });
})();
<\/script>`]),n),H=String.raw(A||=b([`<style id="codex-visualization-host-theme">:root {}</style>
<script>
(() => {
  // Host colors are defaults; later authored styles can give the same names
  // their own meaning (for example, --muted as a chart's label color).
  const hostStyles = document.getElementById("codex-visualization-host-theme");
  const hostStyle = hostStyles.sheet.cssRules[0].style;
  // Typography, geometry and interaction cursors still follow the host.
  const styleForProperty = (property) =>
    /^--(?:font-|radius|corner-shape$|control-spacing$|cursor-interaction$|icon-size$|visualize-paint-gutter$)/.test(property)
      ? document.documentElement.style
      : hostStyle;
  const initialGlobals =
    globalThis.__codexVisualizationInitialGlobals ?? globalThis.openai;
  delete globalThis.__codexVisualizationInitialGlobals;
  if (initialGlobals?.statePersistence != null) {
    globalThis.openai ??= {};
    globalThis.openai.statePersistence = initialGlobals.statePersistence;
    globalThis.openai.stateModelContext = initialGlobals.stateModelContext ?? "none";
  }
  if (!__CODEX_VISUALIZATION_SYNC_HOST_STYLES__) {
    return;
  }
  let appliedProperties = [];
  const applyHostStyleVariables = (styleVariables) => {
    if (styleVariables == null || typeof styleVariables !== "object") {
      return;
    }
    for (const property of appliedProperties) {
      styleForProperty(property).removeProperty(property);
    }
    appliedProperties = [];
    for (const [property, value] of Object.entries(styleVariables)) {
      if (property.startsWith("--") && typeof value === "string") {
        styleForProperty(property).setProperty(property, value);
        appliedProperties.push(property);
      }
    }
  };

  const syncHostStyles = (globals) => {
    applyHostStyleVariables(globals?.visualizationStyleVariables);
    const sandboxDocument = globalThis.frameElement?.ownerDocument;
    if (sandboxDocument != null && globals?.visualizationTheme != null) {
      let colorSchemeMeta = sandboxDocument.querySelector(
        'meta[name="color-scheme"]',
      );
      if (colorSchemeMeta == null) {
        colorSchemeMeta = sandboxDocument.createElement("meta");
        colorSchemeMeta.name = "color-scheme";
        sandboxDocument.head.appendChild(colorSchemeMeta);
      }
      colorSchemeMeta.content = globals.visualizationTheme;
      sandboxDocument.documentElement.style.colorScheme =
        globals.visualizationTheme;
      // Paint the host surface behind transparent saved visualization documents.
      sandboxDocument.documentElement.style.backgroundColor =
        hostStyle.getPropertyValue("--background");
    }
  };

  syncHostStyles(initialGlobals);
  globalThis.addEventListener("openai:set_globals", (event) => {
    syncHostStyles(event.detail?.globals);
  });
})();
<\/script>`]))})))()}export{U as n,x as t};
//# sourceMappingURL=visualization-sandbox-html-b6985ba8aa1f.js.map