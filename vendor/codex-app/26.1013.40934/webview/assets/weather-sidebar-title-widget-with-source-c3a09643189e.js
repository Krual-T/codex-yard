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
//#region WeatherSidebarTitleWidgetWithSource.dil.tsx
	function ResolvedWeatherSidebarTitle({ state }) {
		const [selectedUnit, setSelectedUnit] = DIL.useState(null);
		const unit = selectedUnit ?? state.unit;
		return /* @__PURE__ */ __dil.jsx("box", {
			role: "region",
			ariaLabel: state.region_label,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			gap: 2
		}, state.title !== "" && /* @__PURE__ */ __dil.jsx("title", {
			size: "lg",
			weight: "semibold"
		}, state.title), /* @__PURE__ */ __dil.jsx("row", {
			width: "100%",
			minWidth: 0,
			align: "center",
			gap: 1,
			rowGap: 0,
			wrap: "wrap"
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1,
			wrap: "nowrap",
			flex: "none"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			weight: "normal",
			color: "prose"
		}, state.subtitle), state.weather_ready && /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			weight: "normal",
			color: "prose"
		}, "·")), state.weather_ready && /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1,
			wrap: "nowrap",
			flex: "0 1 auto",
			minWidth: 0,
			maxWidth: "100%"
		}, /* @__PURE__ */ __dil.jsx("image", {
			src: state.icon_src,
			alt: state.summary,
			width: 24,
			height: 24,
			hideOnFailure: true
		}), /* @__PURE__ */ __dil.jsx("box", { ariaLabel: unit === "F" ? state.temperature_a11y_label_f : state.temperature_a11y_label_c }, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			weight: "normal",
			color: "prose"
		}, unit === "F" ? state.temperature_f : state.temperature_c)), /* @__PURE__ */ __dil.jsx("box", {
			minWidth: 0,
			flex: "1 1 auto"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			weight: "normal",
			maxLines: 1,
			truncate: true,
			color: "prose"
		}, state.summary)), /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: unit === "F" ? state.unit_toggle_f_selected_label : state.unit_toggle_c_selected_label,
			padding: {
				x: 1,
				y: .5
			},
			onClick: () => {
				const nextUnit = unit === "F" ? "C" : "F";
				setSelectedUnit(nextUnit);
				GenUI.dispatchAction({
					type: "log_event",
					handler: "client",
					payload: {
						event_name: "chatgpt_widget_action",
						event_data: {
							widget_affordance: "OPTION",
							widget_action_target: "unit",
							widget_action_value: nextUnit,
							surface_location: "SIDEBAR",
							content_reference_type: "forecast"
						}
					}
				});
			}
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "end",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: unit === state.initial_unit ? "semibold" : "normal",
			color: unit === state.initial_unit ? "prose" : "tertiary"
		}, state.initial_unit), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "tertiary"
		}, "/"), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: unit === state.initial_unit ? "normal" : "semibold",
			color: unit === state.initial_unit ? "tertiary" : "prose"
		}, state.initial_unit === "F" ? "C" : "F")))))));
	}
	function WeatherSidebarTitleWidgetWithSource(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("WeatherSidebarTitleWidgetWithSource", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 60
		});
		return /* @__PURE__ */ __dil.jsx(ResolvedWeatherSidebarTitle, { state });
	}

//#endregion
return WeatherSidebarTitleWidgetWithSource;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=weather-sidebar-title-widget-with-source-c3a09643189e.js.map