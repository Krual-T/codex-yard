// One iframe owns one module/worker pool and retained avatar/editor presentations.
// Removing the iframe releases the runtime, including failed WASM initialization.
import { createPresentation } from "./presentation.mjs";

/**
 * @typedef {import("./presentation.mjs").PresentationLease} PresentationLease
 * @typedef {import("./presentation.mjs").RecordStartup} RecordStartup
 */

const parameters = new URLSearchParams(location.search);
const preloadOnly = parameters.has("preload");
const legacyPresentation =
  parameters.get("animation") === "activity" ? "avatar" : "editor";
// https://github.com/openai/orbit-character-engine/pull/139
const threaded =
  crossOriginIsolated && typeof SharedArrayBuffer !== "undefined";
const runtime = threaded ? "../runtime/" : "../runtime/single-thread/";
const documentLoadedAt = performance.now();
/** @type {Map<PresentationLease["mode"], ReturnType<typeof createPresentation>>} */
const presentations = new Map();
const events = new AbortController();
/** @type {PresentationLease | undefined} */
let currentLease;
/** @type {Promise<import("../runtime/orbit-characters.mjs").OrbitModule | undefined> | undefined} */
let initialization;
let disposed = false;

/** @param {Record<string, unknown>} message @param {PresentationLease | undefined} lease */
function send(message, lease) {
  if (disposed || lease !== currentLease) {
    return;
  }
  parent.postMessage(
    lease?.ownerId === undefined
      ? message
      : { ...message, ownerId: lease.ownerId },
    location.origin,
  );
}

function dispose() {
  if (disposed) {
    return;
  }
  disposed = true;
  events.abort();
  performance.mark("orbit-character.dispose");
  let presentationsDisposed = 0;
  let retainedCharactersDisposed = 0;
  let disposalErrors = 0;
  for (const presentation of presentations.values()) {
    try {
      if (presentation.dispose()) {
        retainedCharactersDisposed += 1;
      }
      presentationsDisposed += 1;
    } catch {
      disposalErrors += 1;
      // The frame owner also removes the document and its native resources.
    }
  }
  presentations.clear();
  currentLease = undefined;
  // oxlint-disable-next-line no-console -- One content-free summary proves retained native cleanup during live navigation checks.
  console.debug(
    "Character frame disposed",
    JSON.stringify({
      presentationsDisposed,
      retainedCharactersDisposed,
      disposalErrors,
    }),
  );
}

/** @param {import("./presentation.mjs").FailureReason} [reason] @param {import("./presentation.mjs").PresentationPhase} [phase] */
function fail(
  reason = "runtime",
  phase = (currentLease && presentations.get(currentLease.mode)?.phase) ??
    "initializing",
) {
  send(
    { type: "orbit-character", status: "failed", reason, phase },
    currentLease,
  );
  dispose();
}

/** @param {PresentationLease["mode"]} mode */
function presentationFor(mode) {
  let presentation = presentations.get(mode);
  if (!presentation) {
    const canvas =
      presentations.size === 0
        ? document.querySelector("canvas")
        : document.createElement("canvas");
    if (!canvas) {
      throw new Error("Character canvas is missing");
    }
    if (presentations.size > 0) {
      canvas.id = `character-${mode}`;
      canvas.setAttribute("aria-hidden", "true");
      document.body.append(canvas);
    }
    presentation = createPresentation({
      canvas,
      activityAnimation: mode === "avatar",
      threaded,
      initializeRuntime,
      send,
      onFailure: fail,
    });
    presentations.set(mode, presentation);
  }
  return presentation;
}

/** @param {MessageEvent<Record<string, unknown>>} event */
function receive(event) {
  const { source, origin, data } = event;
  if (disposed || source !== parent || origin !== location.origin || !data) {
    return;
  }
  if (data.type === "orbit-character-dispose") {
    if (data.ownerId === currentLease?.ownerId) {
      dispose();
    }
    return;
  }
  if (data.type === "orbit-character") {
    const owned = typeof data.ownerId === "string";
    if (data.ownerId !== undefined && !owned) {
      return;
    }
    if (!owned && currentLease?.ownerId !== undefined) {
      return;
    }
    const mode = owned ? data.presentation : legacyPresentation;
    if (mode !== "avatar" && mode !== "editor") {
      return;
    }
    if (
      !currentLease ||
      currentLease.ownerId !== data.ownerId ||
      currentLease.mode !== mode
    ) {
      if (
        typeof data.active !== "boolean" ||
        typeof data.reducedMotion !== "boolean" ||
        !(data.state instanceof Uint8Array) ||
        data.state.length > 65536 ||
        (owned && data.requestReady !== true)
      ) {
        return;
      }
      if (currentLease) {
        presentations.get(currentLease.mode)?.setLease(undefined);
      }
      currentLease = {
        ownerId: typeof data.ownerId === "string" ? data.ownerId : undefined,
        mode,
      };
      presentationFor(mode).setLease(currentLease);
      performance.mark(`orbit-character.presentation.${mode}`);
    }
  }
  if (!currentLease || data.ownerId !== currentLease.ownerId) {
    return;
  }
  const lease = currentLease;
  void presentations
    .get(lease.mode)
    ?.receive(event)
    .catch(() => {
      if (currentLease === lease) {
        fail();
      }
    });
}

function preloadRuntime() {
  return Promise.all(
    ["mjs", "wasm", "data"].map(
      (extension) =>
        new Promise((resolve) => {
          const preload = document.createElement("link");
          preload.rel = extension === "mjs" ? "modulepreload" : "preload";
          if (extension !== "mjs") {
            preload.as = "fetch";
          }
          preload.crossOrigin = "anonymous";
          preload.href = new URL(
            `${runtime}orbit-characters.${extension}`,
            import.meta.url,
          ).href;
          preload.onload = preload.onerror = () => resolve(undefined);
          document.head.append(preload);
        }),
    ),
  );
}

/** @param {RecordStartup} recordStartup */
function initializeRuntime(recordStartup) {
  initialization = initialization ?? loadRuntime(recordStartup);
  return initialization;
}

/** @param {RecordStartup} recordStartup */
async function loadRuntime(recordStartup) {
  recordStartup("document", 0, documentLoadedAt);
  recordStartup("owner_wait", documentLoadedAt);
  const importStartedAt = performance.now();
  performance.mark("orbit-character.module-start");
  void preloadRuntime();
  const { default: createOrbitModule } = threaded
    ? await import("../runtime/orbit-characters.mjs")
    : await import("../runtime/single-thread/orbit-characters.mjs");
  if (disposed) {
    return;
  }
  recordStartup("module_import", importStartedAt);
  const engineStartedAt = performance.now();
  performance.mark("orbit-character.engine-initialize");
  const engine = await createOrbitModule({
    locateFile: (file) => new URL(`${runtime}${file}`, import.meta.url).href,
    onAbort: () => fail(),
  });
  // oxlint-disable-next-line no-console -- One fixed message per resolved module proves runtime reuse across presentation handoffs.
  console.debug("Character engine initialized");
  if (disposed) {
    return;
  }
  recordStartup("engine_initialization", engineStartedAt);
  for (const extension of ["mjs", "wasm", "data"]) {
    const url = new URL(
      `${runtime}orbit-characters.${extension}`,
      import.meta.url,
    ).href;
    const resource = performance.getEntriesByName(url, "resource").at(-1);
    if (resource instanceof PerformanceResourceTiming) {
      recordStartup(
        `runtime_${extension}`,
        resource.startTime,
        resource.startTime + resource.duration,
        resource,
      );
    }
  }
  performance.measure(
    "orbit-character.module-initialization",
    "orbit-character.module-start",
  );
  return engine;
}

if (preloadOnly) {
  void preloadRuntime().then(() =>
    parent.postMessage("orbit-character-preloaded", location.origin),
  );
} else {
  addEventListener("message", receive, { signal: events.signal });
  addEventListener("pagehide", dispose, { once: true, signal: events.signal });
  // Emscripten can surface late worker failures as global errors.
  for (const type of ["error", "unhandledrejection"]) {
    addEventListener(
      type,
      (event) => {
        event.preventDefault();
        fail();
      },
      { signal: events.signal },
    );
  }
  send({ type: "orbit-character", status: "loaded" }, undefined);
}
