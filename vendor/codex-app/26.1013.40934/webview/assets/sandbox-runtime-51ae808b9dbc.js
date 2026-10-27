import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-call, typescript/no-unsafe-return */
// Runs only inside the preview sandbox; import with ?raw in the host.
(() => {
  const nodeAttribute = "data-sites-preview-node";
  const nodeSelector = "[" + nodeAttribute + "]";
  let state = { mode: "interact", revision: 0, targets: [] };
  let hovered = null;
  let gesture = null;
  let suppressClick = false;
  let frame = 0;
  const overlay = document.createElement("div");
  overlay.setAttribute("data-sites-preview-runtime", "");
  overlay.setAttribute("aria-hidden", "true");
  overlay.setAttribute("popover", "manual");
  const shadow = overlay.attachShadow({ mode: "closed" });
  const styles = document.createElement("style");
  styles.textContent = \`
:host {
  position: fixed;
  inset: 0;
  width: auto;
  height: auto;
  margin: 0;
  padding: 0;
  border: 0;
  overflow: visible;
  background: transparent;
  pointer-events: none;
}
div {
  /* Match Sites' SitePreviewAnnotations.module.css outline. */
  position: fixed;
  box-sizing: border-box;
  pointer-events: none;
  border: 2px solid #0285ff;
  border-radius: 3px;
  background: rgb(2 133 255 / 8%);
}
\`;
  shadow.append(styles);
  const annotationCursorStyle = document.createElement("style");
  annotationCursorStyle.setAttribute("data-sites-preview-runtime", "");
  annotationCursorStyle.textContent =
    ":root, :root * { cursor: " +
    (document.currentScript?.getAttribute("data-annotation-cursor") ||
      "crosshair") +
    " !important; }";
  annotationCursorStyle.media = "not all";

  const getId = (element) => element.getAttribute(nodeAttribute);
  const excluded =
    "[data-sites-preview-runtime],script,style,template,noscript,iframe,object,embed,link,meta,svg,canvas,video,audio,input,textarea,select,option";
  const selectable = (element) =>
    element?.nodeType === 1 &&
    !element.closest(excluded) &&
    element.closest(nodeSelector);
  const getNode = (target) => {
    if (target.rendered) {
      try {
        return document.querySelector(target.rendered.selector);
      } catch {
        return null;
      }
    }
    return [...document.querySelectorAll(nodeSelector)].find(
      (node) => getId(node) === target.nodeId,
    );
  };
  const getTarget = (element) => {
    const source = element.closest(nodeSelector);
    if (!source) {
      return null;
    }
    const nodeId = getId(source);
    if (source === element) {
      return { nodeId };
    }
    const path = [];
    let current = element;
    while (current && current !== document.body) {
      const parent = current.parentElement;
      if (!parent) {
        return null;
      }
      path.unshift(
        ":nth-child(" + ([...parent.children].indexOf(current) + 1) + ")",
      );
      current = parent;
    }
    path.unshift("body");
    const selector = path.join(" > ");
    if (selector.length > 2000) {
      return null;
    }
    return {
      nodeId,
      rendered: {
        selector,
        tagName: element.tagName.toLowerCase().slice(0, 64),
        text: (
          element.getAttribute("aria-label") ||
          element.getAttribute("alt") ||
          element.textContent ||
          ""
        )
          .replace(/\\s+/g, " ")
          .trim()
          .slice(0, 200),
        html: element.outerHTML.slice(0, 1500),
      },
    };
  };
  const targetAt = (event) => (selectable(event.target) ? event.target : null);
  const active = () => state.mode === "select";
  const isDragging = (value) =>
    value.dragging ||
    Math.hypot(value.x - value.startX, value.y - value.startY) >= 4;
  const cancelEvent = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const select = (nodes, event) => {
    const targets = nodes.slice(0, 20).map(getTarget).filter(Boolean);
    state = { ...state, targets };
    if (window.openai && typeof window.openai.setWidgetState === "function") {
      Promise.resolve(
        window.openai.setWidgetState({
          ...state,
          editorEvent: {
            revision: state.revision,
            event: {
              type: "select",
              targets,
              anchor: event
                ? {
                    x: Math.max(
                      0,
                      Math.min(1, event.clientX / window.innerWidth),
                    ),
                    y: Math.max(
                      0,
                      Math.min(1, event.clientY / window.innerHeight),
                    ),
                  }
                : undefined,
            },
          },
        }),
      ).catch(() => {});
    }
    paint();
  };
  const box = (rect, kind) => {
    const element = document.createElement("div");
    if (kind) {
      element.setAttribute("data-" + kind, "");
    }
    Object.assign(element.style, {
      left: rect.left + "px",
      top: rect.top + "px",
      width: rect.width + "px",
      height: rect.height + "px",
    });
    shadow.append(element);
  };
  const regionRect = (value) => ({
    left: Math.min(value.startX, value.x),
    top: Math.min(value.startY, value.y),
    width: Math.abs(value.startX - value.x),
    height: Math.abs(value.startY - value.y),
  });
  function paint() {
    shadow.replaceChildren(styles);
    if (!active()) {
      return;
    }
    const selectedNodes = state.targets.map(getNode);
    for (const element of selectedNodes) {
      if (element) {
        box(element.getBoundingClientRect());
      }
    }
    if (hovered?.isConnected && !selectedNodes.includes(hovered)) {
      box(hovered.getBoundingClientRect(), "hover");
    }
    if (gesture && isDragging(gesture)) {
      box(regionRect(gesture), "hover");
    }
  }
  const queuePaint = () => {
    if (frame) {
      return;
    }
    frame = requestAnimationFrame(() => {
      frame = 0;
      paint();
    });
  };
  const update = (next) => {
    if (
      !next ||
      !Number.isSafeInteger(next.revision) ||
      !["select", "interact"].includes(next.mode) ||
      !Array.isArray(next.targets)
    ) {
      return;
    }
    if (next.revision !== state.revision || next.mode !== state.mode) {
      cancelGesture();
      hovered = null;
      suppressClick = false;
    }
    state = next;
    annotationCursorStyle.media = active() ? "all" : "not all";
    paint();
  };
  window.addEventListener("openai:set_globals", (event) => {
    if (event.detail?.globals) {
      update(event.detail.globals.widgetState);
    }
  });
  update(window.openai?.widgetState);

  window.addEventListener(
    "pointermove",
    (event) => {
      if (!active()) {
        return;
      }
      if (gesture && gesture.pointerId === event.pointerId) {
        cancelEvent(event);
        gesture.x = event.clientX;
        gesture.y = event.clientY;
        if (!gesture.dragging && isDragging(gesture)) {
          gesture.dragging = true;
          hovered = null;
          if (
            typeof document.documentElement.setPointerCapture === "function"
          ) {
            document.documentElement.setPointerCapture(event.pointerId);
          }
        }
      } else {
        hovered = targetAt(event);
      }
      queuePaint();
    },
    true,
  );
  window.addEventListener(
    "pointerdown",
    (event) => {
      if (!active() || event.button !== 0) {
        return;
      }
      cancelEvent(event);
      suppressClick = false;
      gesture = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        dragging: false,
      };
    },
    true,
  );
  window.addEventListener(
    "pointerup",
    (event) => {
      if (!active()) {
        return;
      }
      cancelEvent(event);
      if (!gesture || event.pointerId !== gesture.pointerId) {
        return;
      }
      gesture.x = event.clientX;
      gesture.y = event.clientY;
      if (!isDragging(gesture)) {
        cancelGesture();
        paint();
        return;
      }
      const rect = regionRect(gesture);
      cancelGesture();
      hovered = null;
      suppressClick = true;
      const nodes = [...document.body.querySelectorAll("*")].filter(
        (element) => {
          if (!selectable(element)) {
            return false;
          }
          const bounds = element.getBoundingClientRect();
          return (
            bounds.width > 0 &&
            bounds.height > 0 &&
            bounds.left >= rect.left &&
            bounds.top >= rect.top &&
            bounds.right <= rect.left + rect.width &&
            bounds.bottom <= rect.top + rect.height
          );
        },
      );
      const enclosed = new Set(nodes);
      select(
        nodes.filter((node) => {
          let parent = node.parentElement;
          while (parent) {
            if (enclosed.has(parent)) {
              return false;
            }
            parent = parent.parentElement;
          }
          return true;
        }),
        event,
      );
    },
    true,
  );
  window.addEventListener(
    "pointercancel",
    () => {
      cancelGesture();
      paint();
    },
    true,
  );
  window.addEventListener(
    "click",
    (event) => {
      if (!active()) {
        return;
      }
      cancelEvent(event);
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      const element = targetAt(event);
      if (element) {
        select([element], event);
      }
    },
    true,
  );
  window.addEventListener(
    "keydown",
    (event) => {
      if (!active() || event.isComposing) {
        return;
      }
      if (event.key === "Escape") {
        cancelEvent(event);
        cancelGesture();
        select([]);
      }
      if (event.key === "Enter") {
        cancelEvent(event);
        const element = targetAt(event);
        if (element) {
          select([element]);
        }
      }
    },
    true,
  );
  function cancelGesture() {
    if (
      gesture &&
      typeof document.documentElement.hasPointerCapture === "function" &&
      document.documentElement.hasPointerCapture(gesture.pointerId)
    ) {
      document.documentElement.releasePointerCapture(gesture.pointerId);
    }
    gesture = null;
  }
  window.addEventListener("blur", () => {
    cancelGesture();
    hovered = null;
    paint();
  });
  for (const type of ["dblclick", "submit", "dragstart", "beforeinput"]) {
    window.addEventListener(
      type,
      (event) => {
        if (active()) {
          cancelEvent(event);
        }
      },
      true,
    );
  }
  window.addEventListener("scroll", queuePaint, true);
  window.addEventListener("resize", queuePaint);

  const mountOverlay = () => {
    document.documentElement.append(overlay, annotationCursorStyle);
    if (typeof overlay.showPopover === "function") {
      overlay.showPopover();
    }
    paint();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountOverlay, { once: true });
  } else {
    mountOverlay();
  }
})();
`})))()}n();export{t as default};
//# sourceMappingURL=sandbox-runtime-51ae808b9dbc.js.map