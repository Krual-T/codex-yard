import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


//#region learning-viz-dil/lottie-playback.dil.ts
	function positionAt(playback, now, duration) {
		const elapsed = playback.startedAt === null ? 0 : (now - playback.startedAt) / 1e3;
		return Math.min(duration, playback.position + Math.max(0, elapsed));
	}
	function useLottiePlayback(source, animated) {
		const duration = (Number(source.op) - Number(source.ip)) / Number(source.fr);
		const [playback, setPlayback] = DIL.useState(() => ({
			position: 0,
			startedAt: animated ? Date.now() : null
		}));
		const now = DIL.useNow(playback.startedAt !== null);
		const playing = playback.startedAt !== null && positionAt(playback, now, duration) < duration;
		DIL.useEffect(() => {
			if (playback.startedAt !== null && !playing) setPlayback({
				position: duration,
				startedAt: null
			});
		}, [
			playing,
			playback.startedAt,
			duration
		]);
		const currentTime = DIL.useMemo(() => positionAt(playback, Date.now(), duration), [source, playback]);
		const toggle = () => {
			const timestamp = Date.now();
			setPlayback((previous) => {
				const position = positionAt(previous, timestamp, duration);
				return previous.startedAt !== null && position < duration ? {
					position,
					startedAt: null
				} : {
					position: position === duration ? 0 : position,
					startedAt: timestamp
				};
			});
		};
		return {
			playing,
			currentTime,
			toggle
		};
	}

//#endregion
//#region learning-viz-dil/lottie-diagram.dil.tsx
	function LottieDiagram({ data }) {
		const { theme } = DIL.useTheme();
		const playback = useLottiePlayback(data.src[theme], data.animated);
		return /* @__PURE__ */ __dil.jsx("col", {
			width: "100vw",
			maxWidth: "100%",
			align: "center",
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			maxWidth: 480
		}, /* @__PURE__ */ __dil.jsx("lottie", {
			key: theme,
			src: data.src,
			alt: data.alt,
			width: "100%",
			aspectRatio: "8/5",
			currentTime: playback.currentTime,
			advanceRate: playback.playing ? 1 : 0,
			loop: false
		})), data.animated ? /* @__PURE__ */ __dil.jsx("row", {
			width: "100%",
			maxWidth: 480,
			align: "end",
			justify: "end",
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("box", { padding: {
			bottom: 3,
			right: 3
		} }, /* @__PURE__ */ __dil.jsx("pressable", {
			onClick: playback.toggle,
			ariaLabel: playback.playing ? data.pause_label : data.play_label,
			size: 36,
			radius: "full",
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("box", {
			key: theme,
			size: 24,
			ariaHidden: true
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: playback.playing ? "pause-sm" : "play-sm",
			size: "2xl",
			color: theme === "dark" ? "#ffffff" : "#0d0d0d"
		}))))) : null);
	}

//#endregion
//#region shared.dil.ts
	function useResolvedComponentResult(componentName, props) {
		const opGenui = DIL.useAppData((appData) => appData.opGenui);
		if (props.__state !== void 0) return {
			status: "resolved",
			resolutionComplete: true,
			state: props.__state
		};
		const key = componentDataKey(componentName, props);
		const result = (typeof props.__resolutionId === "string" ? opGenui?.componentResults?.[props.__resolutionId] : void 0) ?? opGenui?.componentResults?.[key];
		if (isComponentResultEnvelope(result)) {
			if (result.status === "pending") return {
				status: "pending",
				resolutionComplete: false,
				state: void 0
			};
			return result.status === "resolved" ? {
				status: "resolved",
				resolutionComplete: true,
				state: result.state
			} : {
				status: "failed",
				resolutionComplete: true,
				state: void 0
			};
		}
		const legacyState = opGenui?.componentData?.[key];
		if (legacyState !== void 0) return {
			status: "resolved",
			resolutionComplete: true,
			state: legacyState
		};
		if (opGenui?.componentResults !== void 0) return {
			status: "failed",
			resolutionComplete: true,
			state: void 0
		};
		if (opGenui?.componentData !== void 0) return {
			status: "resolved",
			resolutionComplete: true,
			state: void 0
		};
		return {
			status: "pending",
			resolutionComplete: false,
			state: void 0
		};
	}
	function isComponentResultEnvelope(value) {
		if (typeof value !== "object" || value == null || Array.isArray(value)) return false;
		const result = value;
		if (result.status === "pending") return true;
		if (result.status === "resolved") return typeof result.state === "object" && result.state != null && !Array.isArray(result.state);
		return result.status === "failed" && (result.code === "component_unavailable" || result.code === "tool_failed" || result.code === "invalid_tool_result") && typeof result.retryable === "boolean";
	}
	function componentDataKey(componentName, props) {
		return JSON.stringify([componentName, normalizeComponentProps(props)]);
	}
	function normalizeComponentProps(props) {
		const normalized = {};
		for (const key of Object.keys(props).sort()) {
			if (key === "__resolutionId" || key === "__state" || key === "children" || key === "fallback") continue;
			const value = normalizeComponentValue(props[key]);
			if (value !== void 0) normalized[key] = value;
		}
		return normalized;
	}
	function normalizeComponentValue(value) {
		if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
		if (Array.isArray(value)) return value.map(normalizeComponentValue);
		if (typeof value === "object") {
			const normalized = {};
			for (const key of Object.keys(value).sort()) {
				const nestedValue = normalizeComponentValue(value[key]);
				if (nestedValue !== void 0) normalized[key] = nestedValue;
			}
			return normalized;
		}
	}

//#endregion
//#region LearningVizDil.dil.tsx
	function LearningVizDil(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("LearningVizDil", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 300
		});
		return /* @__PURE__ */ __dil.jsx(LottieDiagram, { data: state.block_data });
	}

//#endregion
return LearningVizDil;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=learning-viz-dil-bbd81946145c.js.map