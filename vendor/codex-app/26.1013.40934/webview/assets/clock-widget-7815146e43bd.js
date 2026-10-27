import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


//#region shared.dil.ts
	function useIsLiveActivity() {
		return DIL.useAppData((appData) => appData.opGenui?.surface === "live-activity");
	}
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
//#region ClockWidget.dil.tsx
	const Svg = "svg";
	const SvgText = "text";
	const SvgLine = "line";
	const SvgCircle = "circle";
	function ResolvedClock({ state }) {
		const liveActivity = useIsLiveActivity();
		const isLive = state.fixed_tick == null;
		const now = DIL.useNow(isLive);
		const isMobile = DIL.useIsMobile();
		const isWide = DIL.useBreakpoint("sm");
		const tick = state.fixed_tick ?? now;
		const localSeconds = Math.floor((tick + state.tz_offset_minutes * 6e4) / 1e3);
		const second = (localSeconds % 60 + 60) % 60;
		const minute = (Math.floor(localSeconds / 60) % 60 + 60) % 60;
		const hour = (Math.floor(localSeconds / 3600) % 24 + 24) % 24;
		const timeLabel = (state.time_format === "24h" ? String(hour).padStart(2, "0") : String(hour % 12 || 12)) + ":" + String(minute).padStart(2, "0") + (state.time_format === "12h" ? hour >= 12 ? " PM" : " AM" : "");
		const hourAngle = hour % 12 * 30 + minute * .5;
		const minuteAngle = minute * 6 + second * .1;
		if (liveActivity) return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			padding: 2,
			theme: "dark",
			background: "surface"
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 3,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "globe",
			size: "xl",
			color: "secondary"
		}), /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("title", {
			size: "lg",
			weight: "medium"
		}, timeLabel), /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary",
			truncate: true
		}, state.relative_offset_label ? \`\${state.location} · \${state.relative_offset_label}\` : state.location))));
		return /* @__PURE__ */ __dil.jsx("card", {
			size: isMobile || !isWide ? "full" : "sm",
			padding: {
				left: 6,
				right: 4,
				y: 5
			},
			background: "#1c1c1c",
			theme: "dark"
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			justify: "between",
			gap: 3
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 1.5,
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("title", {
			size: "xl",
			weight: "semibold"
		}, timeLabel), /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "sm"
		}, state.location), isLive && state.relative_offset_label && /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "sm"
		}, state.relative_offset_label))), /* @__PURE__ */ __dil.jsx("box", {
			width: 95,
			height: 95,
			flex: "none",
			ariaHidden: true
		}, /* @__PURE__ */ __dil.jsx(Svg, {
			viewBox: "0 0 95 95",
			size: 95,
			fill: "none"
		}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, [
			1,
			2,
			3,
			4,
			5,
			6,
			7,
			8,
			9,
			10,
			11,
			12
		].map((mark) => /* @__PURE__ */ __dil.jsx(SvgText, {
			key: mark,
			x: 47.5 + Math.sin(mark * Math.PI / 6) * 40,
			y: 47.5 - Math.cos(mark * Math.PI / 6) * 40,
			fill: "#f5f5f5",
			fontSize: 12,
			fontWeight: 600,
			textAnchor: "middle",
			dominantBaseline: "central"
		}, mark))), /* @__PURE__ */ __dil.jsx(SvgLine, {
			x1: 47.5,
			y1: 47.5,
			x2: 47.5,
			y2: 23.5,
			stroke: "#f5f5f5",
			strokeWidth: 4,
			strokeLinecap: "round",
			transform: \`rotate(\${hourAngle} 47.5 47.5)\`
		}), /* @__PURE__ */ __dil.jsx(SvgLine, {
			x1: 47.5,
			y1: 47.5,
			x2: 47.5,
			y2: 13.5,
			stroke: "#f5f5f5",
			strokeWidth: 3,
			strokeLinecap: "round",
			transform: \`rotate(\${minuteAngle} 47.5 47.5)\`
		}), isLive && /* @__PURE__ */ __dil.jsx(SvgLine, {
			x1: 47.5,
			y1: 53.5,
			x2: 47.5,
			y2: 5.5,
			stroke: "#ffb141",
			strokeWidth: 1.5,
			strokeLinecap: "round",
			transform: \`rotate(\${second * 6} 47.5 47.5)\`
		}), /* @__PURE__ */ __dil.jsx(SvgCircle, {
			cx: 47.5,
			cy: 47.5,
			r: 3,
			fill: "#f5f5f5"
		}), /* @__PURE__ */ __dil.jsx(SvgCircle, {
			cx: 47.5,
			cy: 47.5,
			r: 2,
			fill: "#ffb141"
		})))));
	}
	function ClockWidget(props) {
		const { resolutionComplete, state } = useResolvedComponentResult("ClockWidget", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 135
		});
		return /* @__PURE__ */ __dil.jsx(ResolvedClock, { state });
	}

//#endregion
return ClockWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=clock-widget-7815146e43bd.js.map