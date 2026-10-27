import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


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
//#region DigitalTimerWidget.dil.tsx
	function DigitalTimerWidget(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("DigitalTimerWidget", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 84
		});
		return /* @__PURE__ */ __dil.jsx(Timer, { state });
	}
	function timeLabel(ms) {
		const seconds = Math.trunc(ms / 1e3);
		return \`\${Math.trunc(seconds / 60)}:\${String(seconds % 60).padStart(2, "0")}\`;
	}
	function Timer({ state }) {
		const mobile = DIL.useIsMobile();
		const initialMs = state.initialMs != null && state.initialMs >= 0 ? state.initialMs : state.start_time * 1e3;
		const [localBaseMs, setBaseMs] = DIL.useState(void 0);
		const baseMs = localBaseMs ?? (state.remainingMs != null && state.remainingMs >= 0 ? state.remainingMs : state.start_time * 1e3);
		const [localRunning, setRunning] = DIL.useState(void 0);
		const running = localRunning ?? state.running ?? state.auto_start;
		const [localComplete, setComplete] = DIL.useState(void 0);
		const complete = localComplete ?? state.complete ?? false;
		const [startedAt, setStartedAt] = DIL.useState(null);
		const now = DIL.useNow(running && !complete && baseMs > 0);
		const remainingMs = running && startedAt != null ? Math.max(0, baseMs - (now - startedAt)) : baseMs;
		DIL.useEffect(() => {
			if (running && !complete && startedAt == null) setStartedAt(now);
			if (running && baseMs > 0 && remainingMs <= 0) {
				setBaseMs(0);
				setRunning(false);
				setComplete(true);
				setStartedAt(null);
			}
		}, [
			running,
			complete,
			startedAt,
			now,
			baseMs,
			remainingMs
		]);
		return /* @__PURE__ */ __dil.jsx("card", {
			size: mobile ? "full" : "sm",
			padding: 5,
			theme: "dark",
			background: complete ? "green-400" : void 0
		}, /* @__PURE__ */ __dil.jsx("row", {
			justify: "between",
			align: "center",
			gap: 3
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "baseline",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("title", {
			size: "2xl",
			tabularNums: true
		}, complete ? state.done_label : timeLabel(remainingMs)), !complete && (running || remainingMs < initialMs) && /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			color: "secondary",
			tabularNums: true
		}, timeLabel(initialMs))), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2
		}, !complete && /* @__PURE__ */ __dil.jsx("button", {
			size: "xl",
			uniform: true,
			onClick: () => {
				setBaseMs(remainingMs);
				setStartedAt(null);
				setRunning(!running);
			}
		}, running ? "⏸︎" : "▶"), /* @__PURE__ */ __dil.jsx("button", {
			size: "xl",
			uniform: true,
			color: complete ? "primary" : "secondary",
			disabled: initialMs === remainingMs,
			onClick: () => {
				setBaseMs(initialMs);
				setRunning(false);
				setComplete(false);
				setStartedAt(null);
			}
		}, /* @__PURE__ */ __dil.jsx("icon", { name: "reload" })))));
	}

//#endregion
return DigitalTimerWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=digital-timer-widget-5baf9ef923c7.js.map