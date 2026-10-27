import {
  ActivityKind,
  Category,
  Quality,
  ReactionKind,
  ReactionResult,
} from "../runtime/orbit-enums.mjs";
import { CharacterActivityController } from "./activity.mjs";
import { presetMotion, PresetPreviews } from "./preset-previews.mjs";

/**
 * @typedef {{mode: "avatar" | "editor", ownerId: string | undefined}} PresentationLease
 * @typedef {"initializing" | "preparing" | "ready"} PresentationPhase
 * @typedef {"runtime" | "renderer" | "appearance" | "context-lost"} FailureReason
 * @typedef {(stage: string, start: number, end?: number, resource?: PerformanceResourceTiming) => void} RecordStartup
 */

/**
 * One retained native presentation; runtime ownership stays with the iframe.
 * @param {{
 *   canvas: HTMLCanvasElement,
 *   activityAnimation: boolean,
 *   threaded: boolean,
 *   initializeRuntime: (recordStartup: RecordStartup) => Promise<import("../runtime/orbit-characters.mjs").OrbitModule | undefined>,
 *   send: (message: Record<string, unknown>, lease: PresentationLease | undefined) => void,
 *   onFailure: (reason: FailureReason, phase: PresentationPhase) => void,
 * }} options
 */
export function createPresentation({
  canvas,
  activityAnimation,
  threaded,
  initializeRuntime,
  send,
  onFailure,
}) {
  /** @type {PresentationLease | undefined} */
  let lease;
  let presented = false;
  /** @type {Promise<void> | undefined} */
  let initialization;
  /** @type {(() => void) | undefined} */
  let cancelThumbnailFrame;
  /** @param {Record<string, unknown>} message @param {string} _origin @param {PresentationLease} [targetLease] */
  function postMessage(message, _origin, targetLease = lease) {
    if (presented && lease === targetLease) {
      send(message, targetLease);
    }
  }
  /** @param {PresentationLease | undefined} nextLease */
  function setLease(nextLease) {
    presented = false;
    active = false;
    cancelPointer();
    finishFrameSample("interrupted");
    if (animation != null) {
      cancelAnimationFrame(animation);
    }
    animation = undefined;
    cancelThumbnailFrame?.();
    pending = undefined;
    disposeSnapshot();
    clearResizePreview();
    completingEdit = false;
    editSubmitted = false;
    presetPreviews?.dispose();
    presetPreviews = undefined;
    visiblePresets.clear();
    attemptedThumbnails.clear();
    failedThumbnails.clear();
    customThumbnailState = undefined;
    hoverResumeAt = 0;
    editorListening = false;
    lastPreparation = undefined;
    updateActive();
    lease = nextLease;
    presented = nextLease != null;
    canvas.hidden = !presented;
    canvas.classList.remove("ready");
    if (presented && !activityAnimation) {
      const custom = thumbnailUrls.get("custom");
      if (custom) {
        URL.revokeObjectURL(custom);
      }
      thumbnailUrls.delete("custom");
      // Each editor lease starts from committed state, even after a cancelled
      // draft whose original appearance matches the next owner's input bytes.
      restoredAppearance = undefined;
      ready = false;
      quality = Quality.Automatic;
      constrained = false;
      character?.setQuality(quality);
      character?.setConstrained(constrained);
    }
  }

  const startupStages = new Set();
  /** @type {number | undefined} */
  let appearanceRestoredAt;
  /** @type {number | undefined} */
  let firstFrameAt;

  /** Record each startup stage once; resource timings overlap engine initialization. @type {RecordStartup} */
  function recordStartup(stage, start, end = performance.now(), resource) {
    if (startupStages.has(stage)) {
      return;
    }
    startupStages.add(stage);
    performance.measure(`orbit-character.startup.${stage}`, { start, end });
    let diagnostics;
    if (stage === "first_frame") {
      const preparation = character.preparationStats();
      const cache = character.characterCacheStats();
      const stats = character.stats();
      diagnostics = {
        preparationCpuMs: preparation.lastCpuPrepareMs,
        compiled: Number(cache.compiled),
        bundledHits: Number(cache.bundledHits),
        diskHits: Number(cache.diskHits),
        source: cache.lastSource,
        quality: stats.effectiveQuality,
        vertices: stats.vertices,
        triangles: stats.triangles,
      };
    }
    postMessage(
      {
        type: "orbit-character",
        status: "startup-stage",
        diagnostics,
        stage,
        runtime: threaded ? "threaded" : "single_thread",
        durationMs: end - start,
        hidden: !active || document.hidden,
        transferBytes: resource?.transferSize,
        decodedBytes: resource?.decodedBodySize,
      },
      location.origin,
    );
  }

  /** @type {PresetPreviews | undefined} */
  let presetPreviews;

  const activity = new CharacterActivityController();
  /** @type {import("../runtime/orbit-characters.mjs").Character | undefined} */
  let character;
  /** @type {{character: import("../runtime/orbit-characters.mjs").Character, canvas: HTMLCanvasElement, state: Uint8Array} | undefined} */
  let snapshot;
  /** @type {import("../runtime/orbit-characters.mjs").OrbitModule["PointerPhase"] | undefined} */
  let pointerPhases;
  /** @type {number | undefined} */
  let pointerId;
  let hoverResumeAt = 0;
  /** @type {number | undefined} */
  let hoverTransitionStartedAt;
  /** @type {{id: number, x: number, y: number} | undefined} */
  let deferredHover;
  const pointerEvents = new AbortController();
  let started = false;
  /** @type {Uint8Array | undefined} */
  let requestedAppearance;
  /** @type {Uint8Array | undefined} */
  let restoredAppearance;
  let disposed = false;
  let active = true;
  let reducedMotion = false;
  let ready = false;
  /** @type {PresentationPhase} */
  let phase = "initializing";
  let firstFrameCompleted = false;
  let frameSampleRequested = false;
  let frameSampleVisible = false;
  /** @type {{startedAt?: number, previousAt?: number, frameIntervalCount: number, longFrameIntervalCount: number, maxFrameIntervalMs: number, sampleDurationMs: number} | undefined} */
  let frameSample;
  let framing = "content";
  let needsFraming = false;
  let framingSubmitted = false;
  let fitReadbackRetries = 0;
  let contentScale = 1;
  /** @type {{image: HTMLCanvasElement, probe: HTMLCanvasElement, size: number, checks: number} | undefined} */
  let resizePreview;
  /** @type {boolean | undefined} */
  let readbackAvailable;
  /** @type {import("../runtime/orbit-characters.mjs").OrbitModule | undefined} */
  let engine;
  /** @type {Array<Array<import("../runtime/orbit-characters.mjs").CatalogItem & {retired: boolean}>> | undefined} */
  let catalog;
  /** @type {Map<string, string | undefined>} */
  const thumbnailUrls = new Map();
  /** @type {import("../runtime/orbit-characters.mjs").PreparationStats | undefined} */
  let lastPreparation;
  let editorListening = false;
  let generatingThumbnails = false;
  /** @type {Array<import("../runtime/orbit-characters.mjs").CharacterPreset>} */
  const presets = [];
  /** @type {Set<string>} */
  const visiblePresets = new Set();
  /** @type {Set<string>} */
  const attemptedThumbnails = new Set();
  /** @type {Set<string>} */
  const failedThumbnails = new Set();
  /** @type {Uint8Array | undefined} */
  let customThumbnailState;
  let completingEdit = false;
  let editSubmitted = false;
  /** @type {import("../runtime/orbit-enums.mjs").Quality} */
  let quality = Quality.Automatic;
  let constrained = false;
  /** @type {{id: number, renderOffscreen?: boolean, submitted?: boolean, encoding?: boolean} | undefined} */
  let pending;
  /** @type {number | undefined} */
  let animation;
  const notify = (status, state) =>
    postMessage(
      state == null
        ? { type: "orbit-character", status }
        : { type: "orbit-character", status, state },
      location.origin,
    );

  /** @param {FailureReason} [reason] */
  function fail(reason = "renderer") {
    if (!disposed) {
      onFailure(reason, phase);
    }
  }

  function dispose() {
    setLease(undefined);
    finishFrameSample("interrupted");
    pointerEvents.abort();
    disposed = true;
    if (animation != null) {
      cancelAnimationFrame(animation);
    }
    observer.disconnect();
    presetPreviews?.dispose();
    presetPreviews = undefined;
    const retainedCharacter = character;
    retainedCharacter?.delete();
    if (retainedCharacter) {
      performance.mark(
        `orbit-character.delete.${activityAnimation ? "avatar" : "editor"}`,
      );
    }
    character = undefined;
    disposeSnapshot();
    for (const url of thumbnailUrls.values()) {
      if (url) {
        URL.revokeObjectURL(url);
      }
    }
    thumbnailUrls.clear();
    engine = undefined;
    return retainedCharacter != null;
  }

  function render(seconds) {
    animation = undefined;
    if (
      disposed ||
      !presented ||
      !character ||
      (!active && !pending && !completingEdit) ||
      document.hidden
    ) {
      return;
    }
    try {
      const admitted = character.render(seconds / 1000);
      if (character.renderError()) {
        return fail();
      }
      if (resizePreview) {
        // Cosmetic recovery must not add unbounded readback if drawing stalls.
        if (resizePreview.checks-- === 0) {
          clearResizePreview();
        } else if (
          canvas.width === resizePreview.size &&
          canvas.height === resizePreview.size
        ) {
          try {
            const context = resizePreview.probe.getContext("2d", {
              willReadFrequently: true,
            });
            if (!context) {
              clearResizePreview();
            } else {
              context.globalCompositeOperation = "copy";
              context.drawImage(canvas, 0, 0);
              const pixels = context.getImageData(
                0,
                0,
                resizePreview.size,
                resizePreview.size,
              ).data;
              for (let index = 3; index < pixels.length; index += 4) {
                if (pixels[index] > 8) {
                  clearResizePreview();
                  break;
                }
              }
            }
          } catch {
            // Readback failure must not take down an otherwise healthy renderer.
            clearResizePreview();
          }
        }
      }
      const preparation = character.preparationStats();
      if (frameSample) {
        sampleFrame(
          seconds,
          admitted,
          frameSampleVisible &&
            active &&
            !reducedMotion &&
            phase === "ready" &&
            !preparation.pending &&
            !needsFraming &&
            !pending &&
            !completingEdit,
        );
      }
      if (!ready && preparation.failed) {
        return fail();
      }
      if (
        editorListening &&
        (preparation.revision !== lastPreparation?.revision ||
          preparation.generation !== lastPreparation?.generation ||
          preparation.pending !== lastPreparation?.pending)
      ) {
        reply(0, { preview: preview() });
      }
      if (preparation.failed) {
        needsFraming = false;
        framingSubmitted = false;
      }
      // Ready remains drawable while the engine prepares activity props.
      // https://github.com/openai/orbit-character-engine/pull/150
      if (
        needsFraming &&
        admitted &&
        (preparation.background ||
          (!preparation.pending && !character.hasPendingUpdate()))
      ) {
        if (!framingSubmitted && canReadback()) {
          // Measure a drawn frame in a neutral pose, including reduced motion.
          framingSubmitted = true;
          character.setReducedMotion(true);
          schedule();
          return;
        }
        const snapshot = fittedFrame(canvas);
        if (snapshot) {
          applyPresentation(snapshot.presentation, snapshot.raw);
        } else if (snapshot === false && fitReadbackRetries < 2) {
          fitReadbackRetries += 1;
          character.setReducedMotion(true);
          schedule();
          return;
        }
        needsFraming = false;
        framingSubmitted = false;
        fitReadbackRetries = 0;
        if (activityAnimation && !activity.apply(character, false)) {
          return fail();
        }
        if (!reducedMotion) {
          character.setReducedMotion(false);
        }
      }
      if (
        completingEdit &&
        !preparation.pending &&
        (admitted || preparation.failed)
      ) {
        if (admitted && !editSubmitted) {
          // Admission queues the frame. Pump once more before sleeping so a
          // reduced-motion or offscreen preview displays the committed edit.
          editSubmitted = true;
          character.setReducedMotion(reducedMotion);
        } else {
          completingEdit = false;
          if (!activityAnimation) {
            hoverResumeAt = performance.now() + 300;
          }
          character.setActive(active || pending != null);
        }
      }
      if (
        deferredHover &&
        pointerPhases &&
        performance.now() >= hoverResumeAt
      ) {
        const now = performance.now();
        if (hoverTransitionStartedAt == null) {
          hoverTransitionStartedAt = now;
        }
        const progress = reducedMotion
          ? 1
          : Math.min(1, (now - hoverTransitionStartedAt) / 200);
        const eased = progress * progress * (3 - 2 * progress);
        // Match the engine's clamped pointer range before easing; a cursor far
        // outside the preview must not reach the edge early and appear to snap.
        const x = Math.max(0, Math.min(1, deferredHover.x));
        const y = Math.max(0, Math.min(1, deferredHover.y));
        character.pointer(
          pointerPhases.Move,
          deferredHover.id,
          0.5 + (x - 0.5) * eased,
          0.5 + (y - 0.5) * eased,
          now / 1000,
        );
        if (progress === 1) {
          deferredHover = undefined;
          hoverTransitionStartedAt = undefined;
          hoverResumeAt = 0;
        }
      }
      if (pending && !pending.encoding && !preparation.pending) {
        try {
          if (snapshot) {
            renderSnapshot();
          } else {
            captureSnapshot(pending);
          }
        } catch {
          finishSnapshot(pending, { error: true });
        }
      }
      if (
        !ready &&
        firstFrameCompleted &&
        !needsFraming &&
        (preparation.background ||
          (!preparation.pending && !character.hasPendingUpdate()))
      ) {
        // Give WebGL a presentation opportunity before replacing the saved PNG.
        ready = true;
        const presentedAppearance = restoredAppearance;
        const readyLease = lease;
        requestAnimationFrame(() => {
          if (
            !disposed &&
            presented &&
            lease === readyLease &&
            ready &&
            presentedAppearance === restoredAppearance
          ) {
            if (firstFrameAt != null) {
              recordStartup("presentation", firstFrameAt);
            }
            performance.measure("orbit-character.first-frame", { start: 0 });
            phase = "ready";
            canvas.classList.add("ready");
            notify("ready", presentedAppearance);
          }
        });
      }
      // Keep polling while visible, including in reduced motion: the engine skips
      // idle frames, but gaze smoothing and drag release still need time to settle.
      // https://github.com/openai/orbit-character-engine/blob/99e40752539923873e2e17808e532b90b4c2b319/sdk/web/README.md#pointer-input
      schedule();
    } catch {
      fail();
    }
  }

  /** @param {NonNullable<typeof pending>} request */
  function captureSnapshot(request) {
    if (!character || !engine) {
      throw new Error("Character is unavailable");
    }
    const state = character.state();
    const displayScale =
      512 / Math.max(1, Math.min(innerWidth, innerHeight)) / contentScale;
    // The prepared scene supplies a neutral frame without changing live animation.
    // An idle preview does not need to submit another frame before readback.
    const pixels = character.preparationStats().failed
      ? null
      : character.captureNeutral(512, 512, displayScale);
    const capture = document.createElement("canvas");
    if (pixels != null) {
      capture.width = 512;
      capture.height = 512;
      const context = capture.getContext("2d");
      if (!context) {
        throw new Error("Snapshot canvas is unavailable");
      }
      const image = context.createImageData(512, 512);
      image.data.set(pixels);
      context.putImageData(image, 0, 0);
      encodeSnapshot(request, capture, state);
      return;
    }
    // Rebuild the rolled-back appearance after a failed edit, or preserve export
    // quality when a small Automatic preview has different geometry from 512px.
    capture.id = `${canvas.id}-snapshot`;
    capture.hidden = true;
    document.body.append(capture);
    try {
      snapshot = {
        canvas: capture,
        state,
        character: new engine.Character(`#${capture.id}`, 512, 512),
      };
    } catch (error) {
      capture.remove();
      throw error;
    }
    if (snapshot.character.restore(state)) {
      throw new Error("Snapshot appearance is unavailable");
    }
    snapshot.character.setQuality(quality);
    snapshot.character.setConstrained(constrained);
    snapshot.character.setDisplayScale(displayScale);
    snapshot.character.setReducedMotion(true);
  }

  /** Scalar aggregation only; the existing render loop supplies the clock. */
  function sampleFrame(timestamp, admitted, eligible) {
    const sample = frameSample;
    if (!sample) {
      return;
    }
    if (sample.startedAt == null) {
      // Arming requires first-frame readiness. Start the wall window
      // even if an edit or idle skip begins before this next callback.
      if (!frameSampleVisible || !active || reducedMotion) {
        return;
      }
      sample.startedAt = timestamp;
    }
    if (eligible && admitted && sample.previousAt != null) {
      const interval = timestamp - sample.previousAt;
      if (interval > 0) {
        sample.frameIntervalCount += 1;
        // A fixed long-interval budget, not an inferred display dropped-frame rate.
        sample.longFrameIntervalCount += interval > 50 ? 1 : 0;
        sample.maxFrameIntervalMs = Math.max(
          sample.maxFrameIntervalMs,
          interval,
        );
      }
    }
    // Preparation, idle skips and offscreen capture cannot create slow intervals.
    sample.previousAt = eligible && admitted ? timestamp : undefined;
    sample.sampleDurationMs = timestamp - sample.startedAt;
    // The final callback can arrive late; retain its full interval instead of
    // hiding a stall at the window boundary. No timer or extra rAF is installed.
    if (timestamp - sample.startedAt >= 5000) {
      finishFrameSample("complete");
    }
  }

  function finishFrameSample(sampleStatus) {
    const sample = frameSample;
    frameSample = undefined;
    if (sample) {
      try {
        postMessage(
          {
            type: "orbit-character",
            status: "frame-sample",
            sampleStatus,
            frameIntervalCount: sample.frameIntervalCount,
            longFrameIntervalCount: sample.longFrameIntervalCount,
            maxFrameIntervalMs: sample.maxFrameIntervalMs,
            sampleDurationMs: sample.sampleDurationMs,
          },
          location.origin,
        );
      } catch {
        // Telemetry must not turn a healthy renderer or cleanup into a failure.
      }
    }
  }

  function renderSnapshot() {
    if (!snapshot || !pending) {
      return;
    }
    const capture = snapshot;
    const admitted = capture.character.render(0);
    if (
      capture.character.renderError() ||
      capture.character.preparationStats().failed
    ) {
      throw new Error("Snapshot rendering failed");
    }
    if (!admitted || capture.character.hasPendingUpdate()) {
      return;
    }
    if (!pending.submitted) {
      // Admission queues a frame; pump again before reading the drawing buffer.
      pending.submitted = true;
      capture.character.setReducedMotion(true);
      return;
    }
    encodeSnapshot(pending, capture.canvas, capture.state);
  }

  /**
   * @param {NonNullable<typeof pending>} request
   * @param {HTMLCanvasElement} canvas
   * @param {Uint8Array} state
   */
  function encodeSnapshot(request, canvas, state) {
    request.encoding = true;
    const frame = fittedFrame(canvas);
    const image = frame && uploadThumbnail(frame);
    disposeSnapshot();
    if (!image) {
      finishSnapshot(request, { error: true });
      return;
    }
    image.toBlob((blob) => {
      if (disposed || pending !== request) {
        return;
      }
      if (!blob) {
        finishSnapshot(request, { error: true });
        return;
      }
      void blob.arrayBuffer().then(
        (bytes) =>
          finishSnapshot(request, { state, png: new Uint8Array(bytes) }),
        () => finishSnapshot(request, { error: true }),
      );
    }, "image/png");
  }

  /**
   * @param {typeof pending} request
   * @param {{error?: boolean, state?: Uint8Array, png?: Uint8Array}} [result]
   */
  function finishSnapshot(request, result) {
    if (disposed || !request || pending !== request) {
      return;
    }
    disposeSnapshot();
    pending = undefined;
    updateActive();
    resize();
    if (result) {
      reply(request.id, result);
    }
  }

  function disposeSnapshot() {
    snapshot?.character.delete();
    snapshot?.canvas.remove();
    snapshot = undefined;
  }

  function clearResizePreview() {
    resizePreview?.image.remove();
    resizePreview = undefined;
  }

  function updateActive() {
    if (!presented || !active || document.hidden) {
      clearResizePreview();
    }
    character?.setActive(
      presented &&
        !document.hidden &&
        (active || pending != null || completingEdit),
    );
    snapshot?.character.setActive(presented && !document.hidden);
  }

  function schedule() {
    if (
      animation == null &&
      !disposed &&
      presented &&
      !pending?.renderOffscreen &&
      (active || pending || completingEdit) &&
      !document.hidden
    ) {
      animation = requestAnimationFrame(render);
    }
  }

  function pixelSize() {
    return Math.max(
      1,
      Math.min(
        1024,
        Math.round(
          Math.min(innerWidth, innerHeight) * devicePixelRatio * contentScale,
        ),
      ),
    );
  }

  function resize() {
    if (!character || disposed || pending != null || !active) {
      return;
    }
    const size = pixelSize();
    setSize(size);
    schedule();
  }

  function watchPixelDensity() {
    // A density change can leave the canvas's CSS dimensions unchanged.
    matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener(
      "change",
      () => {
        watchPixelDensity();
        resize();
      },
      { once: true, signal: pointerEvents.signal },
    );
  }

  const observer = new ResizeObserver(resize);
  {
    watchPixelDensity();
    observer.observe(canvas);
    canvas.addEventListener("webglcontextlost", () => fail("context-lost"));
    addEventListener("blur", cancelPointer, { signal: pointerEvents.signal });
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) {
          finishFrameSample("interrupted");
          cancelPointer();
        }
        updateActive();
        if (document.hidden && animation != null) {
          cancelAnimationFrame(animation);
          animation = undefined;
        }
        schedule();
      },
      { signal: pointerEvents.signal },
    );
    canvas.addEventListener(
      "pointerdown",
      (event) => {
        if (!event.isPrimary || event.button !== 0 || pointerId != null) {
          return;
        }
        if (movePointer("Down", event)) {
          pointerId = event.pointerId;
          canvas.setPointerCapture(pointerId);
        }
      },
      { signal: pointerEvents.signal },
    );
    canvas.addEventListener(
      "pointermove",
      (event) => movePointer("Move", event),
      {
        signal: pointerEvents.signal,
      },
    );
    canvas.addEventListener(
      "pointerup",
      (event) => {
        if (event.pointerId !== pointerId) {
          return;
        }
        movePointer("Up", event);
        pointerId = undefined;
        if (canvas.hasPointerCapture(event.pointerId)) {
          canvas.releasePointerCapture(event.pointerId);
        }
        const bounds = canvas.getBoundingClientRect();
        if (
          event.pointerType === "touch" ||
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        ) {
          sendPointer("Move", event.pointerId, 0.5, 0.5);
        }
      },
      { signal: pointerEvents.signal },
    );
    canvas.addEventListener(
      "pointerleave",
      (event) => {
        if (event.isPrimary && pointerId == null) {
          sendPointer("Move", event.pointerId, 0.5, 0.5);
        }
      },
      { signal: pointerEvents.signal },
    );
    for (const type of ["pointercancel", "lostpointercapture"]) {
      canvas.addEventListener(
        type,
        (event) => {
          if (event.pointerId === pointerId) {
            cancelPointer();
          }
        },
        { signal: pointerEvents.signal },
      );
    }
  }

  /**
   * @param {"Down" | "Move" | "Up" | "Cancel"} phase
   * @param {number} id
   * @param {number} x
   * @param {number} y
   */
  function sendPointer(phase, id, x, y) {
    if (
      !character ||
      !pointerPhases ||
      !ready ||
      disposed ||
      !presented ||
      !active ||
      document.hidden
    ) {
      return false;
    }
    if (activityAnimation) {
      if (phase !== "Move") {
        return false;
      }
      // Native attention preserves the underlying Ready clock and blends back on release.
      // https://github.com/openai/orbit-character-engine/pull/117
      character.setReadyGaze(x, y, performance.now() / 1000);
    } else {
      if (phase === "Move" && pointerId == null && hoverResumeAt > 0) {
        deferredHover = { id, x, y };
        schedule();
        return false;
      }
      deferredHover = undefined;
      hoverTransitionStartedAt = undefined;
      hoverResumeAt = 0;
      character.pointer(
        pointerPhases[phase],
        id,
        x,
        y,
        performance.now() / 1000,
      );
    }
    schedule();
    return true;
  }

  /**
   * @param {"Down" | "Move" | "Up"} phase
   * @param {PointerEvent} event
   */
  function movePointer(phase, event) {
    if (
      !event.isPrimary ||
      (pointerId != null && pointerId !== event.pointerId)
    ) {
      return false;
    }
    const bounds = canvas.getBoundingClientRect();
    return (
      bounds.width > 0 &&
      bounds.height > 0 &&
      sendPointer(
        phase,
        event.pointerId,
        (event.clientX - bounds.left) / bounds.width,
        (event.clientY - bounds.top) / bounds.height,
      )
    );
  }

  function cancelPointer() {
    deferredHover = undefined;
    hoverTransitionStartedAt = undefined;
    if (!character || !pointerPhases || disposed) {
      return;
    }
    if (activityAnimation) {
      character.clearReadyGaze(performance.now() / 1000);
      schedule();
      return;
    }
    const id = pointerId;
    pointerId = undefined;
    if (id != null) {
      character.pointer(
        pointerPhases.Cancel,
        id,
        0,
        0,
        performance.now() / 1000,
      );
      if (canvas.hasPointerCapture(id)) {
        canvas.releasePointerCapture(id);
      }
    }
    character.pointer(
      pointerPhases.Move,
      id ?? 0,
      0.5,
      0.5,
      performance.now() / 1000,
    );
    schedule();
  }

  /** @param {MessageEvent<Record<string, unknown>>} event */
  async function receive({ source, origin, data }) {
    const requestLease = lease;
    /** @param {number} id @param {Record<string, unknown>} result */
    const respond = (id, result) => reply(id, result, requestLease);
    if (source !== parent || origin !== location.origin || disposed) {
      return;
    }
    if (data?.type === "orbit-character-gesture") {
      const { id, x, y } = data;
      if (
        typeof id !== "number" ||
        !Number.isInteger(id) ||
        id < 0 ||
        id > 0xffffffff ||
        typeof x !== "number" ||
        !Number.isFinite(x) ||
        typeof y !== "number" ||
        !Number.isFinite(y)
      ) {
        return;
      }
      let phase;
      switch (data.phase) {
        case "down":
          phase = "Down";
          break;
        case "move":
          phase = "Move";
          break;
        case "up":
          phase = "Up";
          break;
        case "cancel":
          phase = "Cancel";
          break;
        default:
          return;
      }
      const bounds = canvas.getBoundingClientRect();
      if (
        bounds.width > 0 &&
        bounds.height > 0 &&
        sendPointer(
          phase,
          id,
          (x * innerWidth - bounds.left) / bounds.width,
          (y * innerHeight - bounds.top) / bounds.height,
        )
      ) {
        if (phase === "Down") {
          pointerId = id;
        } else if (phase === "Up" || phase === "Cancel") {
          pointerId = undefined;
        }
      }
      return;
    }
    if (data?.type === "orbit-character-pause") {
      active = false;
      cancelPointer();
      finishFrameSample("interrupted");
      updateActive();
      return;
    }
    if (data?.type === "orbit-character-pointer-cancel") {
      cancelPointer();
      return;
    }
    if (data?.type === "orbit-character-pointer") {
      const { x, y } = data;
      if (
        pointerId == null &&
        typeof x === "number" &&
        typeof y === "number" &&
        Number.isFinite(x) &&
        Number.isFinite(y)
      ) {
        // Owner coordinates are relative to the iframe; account for fitted canvas zoom.
        const bounds = canvas.getBoundingClientRect();
        if (bounds.width > 0 && bounds.height > 0) {
          sendPointer(
            "Move",
            0,
            (x * innerWidth - bounds.left) / bounds.width,
            (y * innerHeight - bounds.top) / bounds.height,
          );
        }
      }
      return;
    }
    if (data?.type === "orbit-character-editor") {
      if (
        typeof data.id !== "number" ||
        !Number.isSafeInteger(data.id) ||
        data.id <= 0
      ) {
        return;
      }
      if (data.action === "snapshot-frame") {
        if (pending?.id === data.id && pending.renderOffscreen) {
          render(performance.now());
        }
        return;
      }
      if (data.action === "snapshot-cancel") {
        if (pending?.id === data.id) {
          finishSnapshot(pending);
        }
        return;
      }
      if (data.action === "preset-preview-stop") {
        if (typeof data.value === "string") {
          presetPreviews?.remove(data.value);
        }
        return respond(data.id, {});
      }
      if (data.action === "preset-preview") {
        if (
          !engine ||
          typeof data.value !== "string" ||
          !(data.port instanceof MessagePort)
        ) {
          return respond(data.id, { error: true });
        }
        try {
          if (!presetPreviews) {
            presetPreviews = new PresetPreviews(engine, fittedFrame);
          }
          const index = presets.findIndex((preset) => preset.id === data.value);
          if (index < 0) {
            data.port.close();
            return respond(data.id, { error: true });
          }
          await presetPreviews.add(data.value, data.port, index);
          respond(data.id, {});
        } catch {
          respond(data.id, { error: true });
        }
        return;
      }
      if (data.action === "reaction") {
        const reaction =
          ready &&
          character &&
          !pending &&
          !needsFraming &&
          !completingEdit &&
          active &&
          !document.hidden
            ? character.playReaction(ReactionKind.Signature)
            : ReactionResult.Unavailable;
        respond(data.id, { reaction });
        if (reaction === ReactionResult.Accepted) {
          schedule();
        }
        return;
      }
      if (data.action === "preset-thumbnail") {
        if (
          typeof data.value !== "string" ||
          typeof data.visible !== "boolean" ||
          !presets.some((preset) => preset.id === data.value)
        ) {
          return respond(data.id, { error: true });
        }
        if (data.visible) {
          visiblePresets.add(data.value);
          void generateThumbnails();
        } else {
          visiblePresets.delete(data.value);
          attemptedThumbnails.delete(data.value);
          const clearedFailure = failedThumbnails.delete(data.value);
          if (trimPresetThumbnails() || clearedFailure) {
            reply(0, { preview: preview() });
          }
        }
        return respond(data.id, {});
      }
      if (!ready || !character || pending) {
        return respond(data.id, { error: true });
      }
      if (data.action === "catalog" || data.action === "custom-thumbnail") {
        const state = data.action === "catalog" ? data.customState : data.state;
        if (state != null || data.action === "custom-thumbnail") {
          if (!(state instanceof Uint8Array) || state.length > 65536) {
            return respond(data.id, { error: true });
          }
          customThumbnailState = state;
        }
      }
      if (data.action === "custom-thumbnail") {
        void generateThumbnails();
        return respond(data.id, {});
      }
      if (data.action === "catalog") {
        if (
          data.savedSelections != null &&
          !addSavedSelections(data.savedSelections)
        ) {
          return respond(data.id, { error: true });
        }
        try {
          if (presets.length === 0) {
            // Load metadata without preparing hidden portraits.
            presets.push(...engine.hereCharacters());
          }
        } catch {
          return respond(data.id, { error: true });
        }
        if (
          Array.isArray(data.presetThumbnails) &&
          data.presetThumbnails.length <= 16
        ) {
          /** @type {Array<unknown>} */
          const thumbnails = data.presetThumbnails;
          for (const item of thumbnails) {
            if (
              item != null &&
              typeof item === "object" &&
              "id" in item &&
              "blob" in item &&
              typeof item.id === "string" &&
              presets.some((preset) => preset.id === item.id) &&
              item.blob instanceof Blob &&
              item.blob.size <= 1024 * 1024 &&
              !thumbnailUrls.has(`preset:${item.id}`)
            ) {
              thumbnailUrls.set(
                `preset:${item.id}`,
                URL.createObjectURL(item.blob),
              );
            }
          }
        }
        editorListening = true;
        if (data.thumbnails !== false) {
          void generateThumbnails();
        }
        return respond(data.id, {
          state: character.state(),
          preview: preview(),
        });
      }
      if (data.action === "snapshot") {
        finishFrameSample("interrupted");
        pending = {
          id: data.id,
          renderOffscreen: data.renderOffscreen === true,
        };
        if (pending.renderOffscreen && animation != null) {
          cancelAnimationFrame(animation);
          animation = undefined;
        }
        updateActive();
        schedule();
        return;
      }
      let accepted = false;
      const { value, accessory, seed } = data;
      try {
        switch (data.action) {
          case "preset":
            accepted =
              typeof value === "string" &&
              value.length <= 63 &&
              engine != null &&
              !character.restore(engine.presetAppearance(value));
            break;
          case "restore":
            accepted =
              data.state instanceof Uint8Array &&
              data.state.length <= 65536 &&
              !character.restore(data.state);
            break;
          case "select": {
            const category = Object.values(Category).find(
              (category) => category === data.category,
            );
            accepted =
              category !== undefined &&
              typeof value === "string" &&
              value.length <= 63 &&
              character.select(category, value);
            break;
          }
          case "color":
            accepted =
              typeof accessory === "string" &&
              accessory.length <= 63 &&
              typeof value === "string" &&
              value.length <= 63 &&
              (value === ""
                ? character.clearAccessoryColor(accessory)
                : character.setAccessoryColor(accessory, value));
            break;
          case "depth":
            if (typeof value === "number") {
              character.setDepth(value);
              accepted = true;
            }
            break;
          case "quality": {
            const selectedQuality = Object.values(Quality).find(
              (quality) => quality === value,
            );
            if (
              selectedQuality !== undefined &&
              character.setQuality(selectedQuality)
            ) {
              quality = selectedQuality;
              accepted = true;
            }
            break;
          }
          case "constrained":
            if (typeof value === "boolean") {
              character.setConstrained(value);
              constrained = value;
              accepted = true;
            }
            break;
          case "reset":
            character.reset();
            accepted = true;
            break;
          case "randomize":
            if (engine && typeof seed === "bigint") {
              const state = engine.generateCuratedAppearance(seed);
              accepted = !character.restore(state);
            }
            break;
          default:
            break;
        }
      } catch {
        // Native generation rejects malformed/out-of-range seeds without changing state.
        accepted = false;
      }
      if (accepted) {
        if (!activityAnimation) {
          // Discard the old gaze and wait for fresh movement plus a settled preview.
          cancelPointer();
          hoverResumeAt = Infinity;
        }
        needsFraming = true;
        framingSubmitted = false;
        fitReadbackRetries = 0;
        completingEdit = true;
        editSubmitted = false;
        character.setActive(true);
        schedule();
      }
      respond(data.id, { rejected: !accepted, preview: preview() });
      return;
    }
    if (data?.type !== "orbit-character") {
      return;
    }
    if (
      typeof data.active !== "boolean" ||
      typeof data.reducedMotion !== "boolean" ||
      (data.framing != null &&
        data.framing !== "content" &&
        data.framing !== "activity")
    ) {
      return;
    }
    if (activityAnimation && data.activity != null) {
      if (
        !Object.values(ActivityKind).some(
          (kind) => kind === data.activity.kind,
        ) ||
        (data.activity.turnId != null &&
          typeof data.activity.turnId !== "string")
      ) {
        return;
      }
      activity.requested = {
        kind: data.activity.kind,
        turnId: data.activity.turnId ?? null,
      };
    }
    if (data.state != null) {
      if (!(data.state instanceof Uint8Array) || data.state.length > 65536) {
        return;
      }
      requestedAppearance = data.state;
    } else if (!started) {
      return;
    }
    frameSampleVisible = data.frameSampleVisible === true;
    if (
      data.frameSample === true &&
      !frameSampleRequested &&
      ready &&
      frameSampleVisible &&
      data.active &&
      !data.reducedMotion
    ) {
      frameSampleRequested = true;
      frameSample = {
        frameIntervalCount: 0,
        longFrameIntervalCount: 0,
        maxFrameIntervalMs: 0,
        sampleDurationMs: 0,
      };
    }
    if (
      frameSample != null &&
      (!data.active || data.reducedMotion || !frameSampleVisible)
    ) {
      finishFrameSample("interrupted");
    }
    if (!data.active) {
      cancelPointer();
    }
    const nextFraming = data.framing ?? framing;
    if (framing !== nextFraming) {
      framing = nextFraming;
      needsFraming = true;
      framingSubmitted = false;
      fitReadbackRetries = 0;
      contentScale = 1;
      canvas.style.transform = "";
      clearResizePreview();
      if (started) {
        ready = false;
        canvas.classList.remove("ready");
      }
      setSize(pixelSize());
    }
    active = data.active;
    reducedMotion = data.reducedMotion;
    if (!started) {
      started = true;
    }
    if (!engine) {
      initialization = initialization ?? initialize();
      await initialization;
    }
    if (!engine || disposed || !presented || lease !== requestLease) {
      return;
    }
    // Use the latest owner state, including updates received during WASM startup.
    // Visibility messages repeat these bytes; they must not reset editor changes.
    const state = requestedAppearance;
    if (
      state &&
      (restoredAppearance?.length !== state.length ||
        !state.every((byte, index) => byte === restoredAppearance[index]))
    ) {
      if (engine.validateAppearance(state)) {
        return fail("appearance");
      }
      // Validate and normalize before creating a renderer; keep supported historical fields.
      const normalized = engine.normalizeAppearance(state);
      createCharacter();
      ready = false;
      canvas.classList.remove("ready");
      clearResizePreview();
      needsFraming = true;
      framingSubmitted = false;
      fitReadbackRetries = 0;
      const restoreStartedAt = performance.now();
      if (character.restore(normalized)) {
        return fail();
      }
      recordStartup("appearance_restore", restoreStartedAt);
      appearanceRestoredAt = appearanceRestoredAt ?? performance.now();
      restoredAppearance = state;
      phase = "preparing";
    }
    if (character) {
      if (activityAnimation && !activity.apply(character, needsFraming)) {
        return fail();
      }
      updateActive();
      character.setReducedMotion(reducedMotion);
      // A new owner needs a fresh presentation acknowledgement without restoring
      // or recompiling the same character. Reuse the normal readiness checks.
      if (data.requestReady === true && ready) {
        clearResizePreview();
        ready = false;
        canvas.classList.remove("ready");
        resize();
      }
      schedule();
    }
  }

  async function initialize() {
    engine = await initializeRuntime(recordStartup);
    if (disposed || !engine) {
      return;
    }
    pointerPhases = engine.PointerPhase;
    catalog = Object.values(Category).map((category) =>
      engine.catalog(category).map((item) => ({ ...item, retired: false })),
    );
  }

  function createCharacter() {
    if (character || !engine || disposed) {
      return;
    }
    const size = pixelSize();
    const creationStartedAt = performance.now();
    character = new engine.Character(`#${canvas.id}`, size, size, {
      activities: activityAnimation,
      readyFirst: activityAnimation,
    });
    performance.mark(
      `orbit-character.create.${activityAnimation ? "avatar" : "editor"}`,
    );
    recordStartup("character_creation", creationStartedAt);
    character.onFirstFrame(() => {
      if (firstFrameAt == null && appearanceRestoredAt != null) {
        firstFrameAt = performance.now();
        recordStartup("first_frame", appearanceRestoredAt);
      }
      firstFrameCompleted = true;
    });
    if (activityAnimation && !activity.bind(character)) {
      fail();
      return;
    }
    character.setQuality(quality);
    character.setConstrained(constrained);
    setSize(size);
  }

  /** @param {number} size */
  function setSize(size) {
    character?.resize(size, size);
    character?.setDisplayScale(
      size / Math.max(1, Math.min(innerWidth, innerHeight)) / contentScale,
    );
  }

  /** @param {unknown} selections */
  function addSavedSelections(selections) {
    if (
      !engine ||
      !catalog ||
      !Array.isArray(selections) ||
      selections.length !== 5
    ) {
      return false;
    }
    for (const category of Object.values(Category)) {
      /** @type {unknown} */
      const ids = selections[category];
      if (!Array.isArray(ids) || ids.length > 32) {
        return false;
      }
      for (const id of ids) {
        if (typeof id !== "string" || id.length > 63) {
          return false;
        }
        if (catalog[category].some((item) => item.id === id)) {
          continue;
        }
        const item = engine.findSupportedItem(category, id);
        if (item) {
          catalog[category].push({ ...item, retired: true });
        }
      }
    }
    return true;
  }

  function preview() {
    if (!catalog || !character || !engine) {
      throw new Error("Character is not initialized");
    }
    lastPreparation = character.preparationStats();
    return {
      state: character.state(),
      customThumbnail: thumbnailUrls.get("custom"),
      presets: presets.map((preset) => ({
        ...preset,
        thumbnail:
          thumbnailUrls.get(`preset:${preset.id}`) ??
          (!canReadback() || failedThumbnails.has(preset.id)
            ? null
            : undefined),
      })),
      depth: character.depth(),
      quality,
      constrained,
      preparation: lastPreparation,
      catalog: catalog.map((options, category) =>
        options
          .filter(
            (item) => !item.retired || character.isSelected(category, item.id),
          )
          .map((item) => ({
            id: item.id,
            title: item.title,
            slot: item.slot,
            retired: item.retired,
            selected: character.isSelected(category, item.id),
            available: character.isAvailable(category, item.id),
            thumbnail:
              category === Category.Shape
                ? thumbnail(item.thumbnail)
                : undefined,
            color: category === Category.Color ? swatch(item).color : undefined,
            colors:
              category === Category.Accessory
                ? engine.accessoryColorsFor(item.id).map(swatch)
                : undefined,
            colorOverride:
              category === Category.Accessory
                ? character.accessoryColor(item.id)
                : undefined,
          })),
      ),
    };
  }

  /** @param {import("../runtime/orbit-characters.mjs").CatalogItem} item */
  function swatch(item) {
    return {
      id: item.id,
      title: item.title,
      color: `#${[item.red, item.green, item.blue]
        .map((value) =>
          Math.round(value * 255)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")}`,
    };
  }

  /** @param {string} path */
  function thumbnail(path) {
    if (!engine || !path) {
      return undefined;
    }
    if (!thumbnailUrls.has(path)) {
      let url;
      try {
        const bytes = engine.FS.readFile(`/orbit/${path}`);
        url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
      } catch {
        // Historical metadata may refer to artwork absent from the current bundle.
        // The choice remains usable with its title; availability belongs to the engine.
      }
      thumbnailUrls.set(path, url);
    }
    return thumbnailUrls.get(path);
  }

  /** Keep 40 cached portraits, plus any additional currently visible tiles. */
  function trimPresetThumbnails() {
    const cached = [...thumbnailUrls.keys()].filter((key) =>
      key.startsWith("preset:"),
    );
    let remaining = cached.length;
    for (const key of cached) {
      if (remaining <= 40) {
        break;
      }
      if (!visiblePresets.has(key.slice("preset:".length))) {
        const url = thumbnailUrls.get(key);
        if (url) {
          URL.revokeObjectURL(url);
        }
        thumbnailUrls.delete(key);
        remaining--;
      }
    }
    return remaining < cached.length;
  }

  /** Render portraits one at a time, matching each preset's static and animated view. */
  async function generateThumbnails() {
    if (generatingThumbnails || !presented || !engine || !canReadback()) {
      return;
    }
    generatingThumbnails = true;
    const thumbnailLease = lease;
    let portrait;
    let renderer;
    let activityBound = false;
    try {
      while (!disposed && presented && lease === thumbnailLease) {
        const state = customThumbnailState;
        customThumbnailState = undefined;
        const waitingPresets = state
          ? []
          : presets.filter(
              (item) =>
                visiblePresets.has(item.id) &&
                !attemptedThumbnails.has(item.id) &&
                !thumbnailUrls.has(`preset:${item.id}`),
            );
        // Reuse the current camera binding before creating another WebGL context.
        const preset =
          waitingPresets.find(
            (item) =>
              renderer != null &&
              activityBound ===
                (presetMotion(presets.indexOf(item)) === "gaze"),
          ) ?? waitingPresets[0];
        if (!state && !preset) {
          break;
        }
        if (preset) {
          attemptedThumbnails.add(preset.id);
        }
        try {
          const needsActivity =
            preset != null && presetMotion(presets.indexOf(preset)) === "gaze";
          if (!renderer || activityBound !== needsActivity) {
            renderer?.delete();
            renderer = undefined;
            portrait?.remove();
            portrait = document.createElement("canvas");
            portrait.id = `${canvas.id}-portrait`;
            portrait.style.display = "none";
            document.body.append(portrait);
            renderer = new engine.Character(`#${portrait.id}`, 256, 256, {
              activities: needsActivity,
            });
            renderer.setQuality(Quality.Compact);
            renderer.setReducedMotion(true);
            activityBound = false;
          }
          let key;
          if (state) {
            key = "custom";
            if (renderer.restore(state)) {
              continue;
            }
          } else {
            if (!preset) {
              break;
            }
            key = `preset:${preset.id}`;
            if (renderer.restore(engine.presetAppearance(preset.id))) {
              continue;
            }
          }
          if (needsActivity && !activityBound) {
            // Match Ready's camera and ground shadow before the first portrait frame.
            // https://github.com/openai/orbit-character-engine/blob/5ba3b5359729aa7c25728a380d5b6b669fd5f3b9/sdk/native/CharacterRenderer.cpp#L1612
            if (!new CharacterActivityController().bind(renderer)) {
              throw new Error("Could not initialize preset portrait");
            }
            activityBound = true;
          }
          const deadline = performance.now() + 15_000;
          let submitted = false;
          while (
            !disposed &&
            presented &&
            lease === thumbnailLease &&
            performance.now() < deadline
          ) {
            // oxlint-disable-next-line eslint/no-await-in-loop -- A single GPU renderer is pumped sequentially.
            await new Promise(
              /** @param {() => void} resolve */ (resolve) => {
                const frame = requestAnimationFrame(() => resolve());
                cancelThumbnailFrame = () => {
                  cancelAnimationFrame(frame);
                  resolve();
                };
              },
            );
            cancelThumbnailFrame = undefined;
            if (disposed || !presented || lease !== thumbnailLease) {
              return;
            }
            if (
              (state && customThumbnailState) ||
              (preset && !visiblePresets.has(preset.id))
            ) {
              break;
            }
            const admitted = renderer.render(performance.now() / 1000);
            const preparation = renderer.preparationStats();
            if (preparation.failed || renderer.renderError()) {
              break;
            }
            if (
              !admitted ||
              preparation.pending ||
              renderer.hasPendingUpdate()
            ) {
              continue;
            }
            if (!submitted) {
              submitted = true;
              renderer.setReducedMotion(true);
              continue;
            }
            const fitted = fittedFrame(portrait);
            const image = fitted && uploadThumbnail(fitted, preset ? 256 : 512);
            if (!image) {
              renderer.setReducedMotion(true);
              continue;
            }
            // oxlint-disable-next-line eslint/no-await-in-loop -- Capture this portrait before reusing its renderer.
            const blob = await new Promise(
              /** @param {(value: Blob | null) => void} resolve */
              (resolve) => image.toBlob(resolve, "image/png"),
            );
            if (disposed || !presented || lease !== thumbnailLease) {
              return;
            }
            if (
              (state && customThumbnailState) ||
              (preset && !visiblePresets.has(preset.id))
            ) {
              break;
            }
            if (blob) {
              if (preset) {
                // Retain canonical artwork in the owner, beyond this iframe's lifetime.
                postMessage(
                  {
                    type: "orbit-character",
                    status: "preset-thumbnail",
                    presetId: preset.id,
                    thumbnail: blob,
                  },
                  location.origin,
                );
              }
              const previous = thumbnailUrls.get(key);
              thumbnailUrls.set(key, URL.createObjectURL(blob));
              if (previous) {
                URL.revokeObjectURL(previous);
              }
              trimPresetThumbnails();
              reply(0, { preview: preview() });
            }
            break;
          }
        } catch {
          // Release a failed renderer, then continue with the remaining visible tiles.
          renderer?.delete();
          renderer = undefined;
          portrait?.remove();
          portrait = undefined;
        } finally {
          if (
            !disposed &&
            presented &&
            lease === thumbnailLease &&
            preset &&
            visiblePresets.has(preset.id) &&
            !thumbnailUrls.has(`preset:${preset.id}`)
          ) {
            failedThumbnails.add(preset.id);
            reply(0, { preview: preview() });
          }
        }
      }
    } finally {
      generatingThumbnails = false;
      renderer?.delete();
      portrait?.remove();
      if (!disposed && presented && editorListening) {
        reply(0, { preview: preview() });
        if (lease !== thumbnailLease) {
          void generateThumbnails();
        }
      }
    }
  }

  /** @param {number} id @param {Record<string, unknown>} result @param {PresentationLease} [responseLease] */
  function reply(id, result, responseLease = lease) {
    postMessage(
      { type: "orbit-character-editor", id, ...result },
      location.origin,
      responseLease,
    );
  }

  function canReadback() {
    if (readbackAvailable === undefined) {
      try {
        readbackAvailable = !!document
          .createElement("canvas")
          .getContext("2d", {
            willReadFrequently: true,
          });
      } catch {
        readbackAvailable = false;
      }
    }
    return readbackAvailable;
  }

  /**
   * @param {{scale: number, translateX: number, translateY: number}} presentation
   * @param {HTMLCanvasElement} raw
   */
  function applyPresentation({ scale, translateX, translateY }, raw) {
    // Match the centered, half-size saved portrait while leaving room for reactions.
    const frameScale = framing === "activity" ? 0.5 : 1;
    const inset = (1 - frameScale) / 2;
    contentScale = scale * frameScale;
    const x = translateX * frameScale + inset;
    const y = translateY * frameScale + inset;
    canvas.style.transform = `translate(${x * 100}%, ${y * 100}%) scale(${contentScale})`;
    captureTransitionSnapshot(contentScale, x, y);
    // A queued resize clears the live canvas before the next GPU frame arrives.
    // Retain this editor's already-read pixels until the resized canvas is drawn.
    const size = pixelSize();
    if (
      ready &&
      active &&
      editorListening &&
      (size !== canvas.width || resizePreview)
    ) {
      // fittedFrame only supplies a nonempty image, including during rapid edits.
      clearResizePreview();
      const probe = document.createElement("canvas");
      probe.width = probe.height = size;
      raw.className = "ready resize-preview";
      raw.style.transform = canvas.style.transform;
      canvas.after(raw);
      resizePreview = { image: raw, probe, size, checks: 8 };
    }
    // Rasterize at the fitted size so CSS enlargement preserves display density.
    setSize(size);
  }

  /** @param {number} scale @param {number} x @param {number} y */
  function captureTransitionSnapshot(scale, x, y) {
    const state = restoredAppearance;
    const snapshotFraming = framing;
    const snapshotLease = lease;
    // Unsaved editor changes no longer belong to the parent's appearance bytes.
    if (!state || editorListening) {
      return;
    }
    try {
      const image = document.createElement("canvas");
      image.width = image.height = 512;
      const context = image.getContext("2d");
      if (!context) {
        return;
      }
      // Preserve the full renderer viewport, including its transparent margins.
      // Read the neutral frame before resizing clears the drawing buffer.
      context.drawImage(canvas, x * 512, y * 512, scale * 512, scale * 512);
      image.toBlob((blob) => {
        if (!blob || disposed) {
          return;
        }
        void blob.arrayBuffer().then(
          (bytes) => {
            if (
              !disposed &&
              presented &&
              lease === snapshotLease &&
              state === restoredAppearance &&
              snapshotFraming === framing
            ) {
              postMessage(
                {
                  type: "orbit-character",
                  status: "snapshot",
                  state,
                  framing: snapshotFraming,
                  png: new Uint8Array(bytes),
                },
                location.origin,
              );
            }
          },
          () => {},
        );
      }, "image/png");
    } catch {
      // Optional readback or encoding must never delay or fail the live renderer.
    }
  }

  // Match Android's neutral content fit and full-footprint presentation:
  // https://github.com/openai/openai-android/blob/c94fd093c4e3b3cd6e02a95c1366db54210507a1/feature/orbit-characters/impl/src/main/kotlin/com/openai/feature/orbitcharacters/impl/OrbitAvatarContentFit.kt
  /** @param {HTMLCanvasElement} source */
  function fittedFrame(source) {
    if (!canReadback()) {
      return null;
    }
    try {
      const width = source.width;
      const height = source.height;
      const raw = document.createElement("canvas");
      raw.width = width;
      raw.height = height;
      const rawContext = raw.getContext("2d", { willReadFrequently: true });
      const framed = document.createElement("canvas");
      framed.width = 512;
      framed.height = 512;
      const framedContext = framed.getContext("2d", {
        willReadFrequently: true,
      });
      if (!rawContext || !framedContext || width <= 0 || height <= 0) {
        return false;
      }
      rawContext.drawImage(source, 0, 0);
      const neutralBounds = alphaBounds(
        rawContext.getImageData(0, 0, width, height),
        8,
      );
      if (!neutralBounds) {
        return false;
      }
      const neutralScale =
        Math.min(width / neutralBounds.width, height / neutralBounds.height) *
        0.9;
      const neutralX =
        0.5 -
        ((neutralBounds.left + neutralBounds.right) / (2 * width)) *
          neutralScale;
      const neutralY = 0.95 - (neutralBounds.bottom / height) * neutralScale;
      framedContext.drawImage(
        raw,
        neutralX * 512,
        neutralY * 512,
        neutralScale * 512,
        neutralScale * 512,
      );
      const bounds = alphaBounds(framedContext.getImageData(0, 0, 512, 512), 1);
      if (!bounds) {
        return false;
      }
      const presentationScale = Math.min(
        512 / bounds.width,
        512 / bounds.height,
      );
      const presentationX =
        0.5 - ((bounds.left + bounds.right) / 1024) * presentationScale;
      const presentationY =
        0.5 - ((bounds.top + bounds.bottom) / 1024) * presentationScale;
      return {
        raw,
        framed,
        bounds,
        presentation: {
          scale: neutralScale * presentationScale,
          translateX: neutralX * presentationScale + presentationX,
          translateY: neutralY * presentationScale + presentationY,
        },
      };
    } catch {
      // A readback race must not hide the live character or replace its saved PNG.
      return false;
    }
  }

  /** @param {ImageData} image @param {number} minimumAlpha */
  function alphaBounds(image, minimumAlpha) {
    const { data, width, height } = image;
    let left = width;
    let top = height;
    let right = 0;
    let bottom = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] >= minimumAlpha) {
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x + 1);
          bottom = Math.max(bottom, y + 1);
        }
      }
    }
    return right > left && bottom > top
      ? { left, top, right, bottom, width: right - left, height: bottom - top }
      : null;
  }

  // Android uploads a separate 512px crop of the fitted neutral snapshot:
  // https://github.com/openai/openai-android/blob/c94fd093c4e3b3cd6e02a95c1366db54210507a1/feature/orbit-characters/impl/src/main/kotlin/com/openai/feature/orbitcharacters/impl/OrbitAvatarSnapshotBitmap.kt
  /** @param {{framed: HTMLCanvasElement, bounds: {left: number, top: number, width: number, height: number}}} snapshot */
  function uploadThumbnail({ framed, bounds }, size = 512) {
    try {
      const thumbnail = document.createElement("canvas");
      thumbnail.width = size;
      thumbnail.height = size;
      const context = thumbnail.getContext("2d");
      if (!context) {
        return null;
      }
      context.imageSmoothingQuality = "high";
      const scale = size / Math.max(bounds.width, bounds.height);
      const width = bounds.width * scale;
      const height = bounds.height * scale;
      context.drawImage(
        framed,
        bounds.left,
        bounds.top,
        bounds.width,
        bounds.height,
        (size - width) / 2,
        (size - height) / 2,
        width,
        height,
      );
      return thumbnail;
    } catch {
      return null;
    }
  }

  return {
    receive,
    setLease,
    dispose,
    get phase() {
      return phase;
    },
  };
}
