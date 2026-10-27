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
//#region DigitalStopwatchWidget.dil.tsx
	function DigitalStopwatchWidget(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("DigitalStopwatchWidget", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 84
		});
		return /* @__PURE__ */ __dil.jsx(Stopwatch, { state });
	}
	function Stopwatch({ state }) {
		const mobile = DIL.useIsMobile();
		const [localBaseMs, setBaseMs] = DIL.useState(void 0);
		const baseMs = localBaseMs ?? (state.elapsedBaseMs != null && state.elapsedBaseMs >= 0 ? state.elapsedBaseMs : state.start_time * 1e3);
		const [localRunning, setRunning] = DIL.useState(void 0);
		const running = localRunning ?? state.running ?? state.auto_start;
		const [startedAt, setStartedAt] = DIL.useState(state.startTimestamp ?? null);
		const now = DIL.useNow(running, 50);
		DIL.useEffect(() => {
			if (running && startedAt == null) setStartedAt(now);
		}, [
			running,
			startedAt,
			now
		]);
		const elapsedMs = baseMs + (running && startedAt != null ? now - startedAt : 0);
		const label = \`\${String(Math.trunc(elapsedMs / 6e4)).padStart(2, "0").slice(-2)}:\${String(Math.trunc(elapsedMs / 1e3) % 60).padStart(2, "0")}.\${String(Math.trunc(elapsedMs % 1e3 / 10)).padStart(2, "0")}\`;
		return /* @__PURE__ */ __dil.jsx("card", {
			size: mobile ? "full" : "sm",
			padding: 5,
			theme: "dark"
		}, /* @__PURE__ */ __dil.jsx("row", {
			justify: "between",
			align: "center",
			gap: 3
		}, /* @__PURE__ */ __dil.jsx("title", {
			size: "2xl",
			tabularNums: true
		}, label), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("button", {
			uniform: true,
			onClick: () => {
				const timestamp = Date.now();
				if (running) {
					setBaseMs(baseMs + (startedAt != null ? timestamp - startedAt : 0));
					setStartedAt(null);
				} else setStartedAt(timestamp);
				setRunning(!running);
			}
		}, running ? "⏸︎" : "▶"), /* @__PURE__ */ __dil.jsx("button", {
			color: "secondary",
			size: "xl",
			uniform: true,
			disabled: !running && baseMs === 0,
			onClick: () => {
				setBaseMs(0);
				setRunning(false);
				setStartedAt(null);
			}
		}, /* @__PURE__ */ __dil.jsx("icon", { name: "reload" })))));
	}

//#endregion
return DigitalStopwatchWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=digital-stopwatch-widget-cd5681f31ddf.js.map