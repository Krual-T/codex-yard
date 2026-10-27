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
//#region FlightTracker.dil.tsx
	function FlightDetails({ details, isDesktop, arrival }) {
		return /* @__PURE__ */ __dil.jsx("grid", {
			columns: isDesktop ? 3 : [
				1.4,
				1,
				1
			],
			gap: isDesktop ? 4 : 3
		}, details.map((detail, index) => {
			const alignEnd = isDesktop ? arrival : index > 0;
			return /* @__PURE__ */ __dil.jsx("grid-item", { key: index }, /* @__PURE__ */ __dil.jsx("col", {
				gap: .5,
				align: alignEnd ? "end" : "start"
			}, /* @__PURE__ */ __dil.jsx("caption", {
				size: "sm",
				color: "secondary",
				textAlign: alignEnd ? "end" : "start"
			}, detail.title), /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				weight: "medium",
				textAlign: alignEnd ? "end" : "start"
			}, detail.value)));
		}));
	}
	function ResolvedFlightTracker({ state }) {
		const liveActivity = useIsLiveActivity();
		const isDesktop = DIL.useBreakpoint("sm");
		if (liveActivity) return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			padding: 2,
			theme: "dark",
			background: "surface"
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: .5,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			justify: "between",
			width: "100%",
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary",
			truncate: true
		}, state.header_label), /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			weight: "medium",
			truncate: true
		}, state.badge_label)), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			justify: "between",
			width: "100%",
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("title", {
			size: "sm",
			weight: "semibold"
		}, state.origin_code), /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary",
			truncate: true
		}, state.departure_time_label)), /* @__PURE__ */ __dil.jsx("icon", {
			name: "plane",
			size: "sm",
			color: "secondary"
		}), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary",
			truncate: true
		}, state.arrival_time_label), /* @__PURE__ */ __dil.jsx("title", {
			size: "sm",
			weight: "semibold"
		}, state.destination_code)))));
		const completedDots = isDesktop ? state.completed_progress_dot_count : state.mobile_completed_progress_dot_count;
		const progressLeft = isDesktop ? state.flight_progress_left : state.mobile_flight_progress_left;
		const progressDots = isDesktop ? [
			0,
			1,
			2,
			3,
			4,
			5,
			6,
			7,
			8,
			9
		] : [
			0,
			1,
			2,
			3,
			4,
			5,
			6,
			7
		];
		const departureDetails = [
			{
				title: state.departure_detail_title,
				value: state.departure_detail_value
			},
			{
				title: state.departure_terminal_title,
				value: state.departure_terminal_value
			},
			{
				title: state.departure_gate_title,
				value: state.departure_gate_value
			}
		];
		const arrivalDetails = [
			{
				title: state.arrival_detail_title,
				value: state.arrival_detail_value
			},
			{
				title: state.arrival_terminal_title,
				value: state.arrival_terminal_value
			},
			{
				title: state.arrival_gate_title,
				value: state.arrival_gate_value
			}
		];
		return /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			variant: "soft",
			background: "transparent",
			radius: 0,
			padding: 0
		}, /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx("box", { padding: {
			top: 0,
			bottom: 4
		} }, /* @__PURE__ */ __dil.jsx("col", { gap: 3 }, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2,
			flex: "auto",
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			truncate: true
		}, state.header_label)), /* @__PURE__ */ __dil.jsx("badge", {
			color: state.badge_color,
			variant: "soft",
			size: "sm"
		}, state.badge_label)), /* @__PURE__ */ __dil.jsx("col", { gap: 1.5 }, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 4
		}, /* @__PURE__ */ __dil.jsx("title", {
			size: isDesktop ? "xl" : "lg",
			weight: "medium"
		}, state.origin_code), /* @__PURE__ */ __dil.jsx("col", {
			flex: "auto",
			align: "center",
			justify: "center",
			gap: 0,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			justify: "center",
			width: "100%",
			height: 28
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			maxWidth: "400px",
			height: "100%",
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			justify: "between",
			width: "100%",
			height: "100%"
		}, progressDots.flatMap((item) => [!state.show_progress_plane && state.progress_center_label !== "" && item === progressDots.length / 2 && /* @__PURE__ */ __dil.jsx("box", {
			key: "duration",
			background: "surface",
			padding: { x: 1 },
			flex: "none"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			weight: "medium"
		}, state.progress_center_label)), state.show_progress_plane && progressLeft !== "" && item === completedDots ? /* @__PURE__ */ __dil.jsx("box", {
			key: item,
			width: 4,
			height: 28,
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: 28,
			height: 28,
			align: "center",
			justify: "center",
			background: "surface",
			radius: "full"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "plane",
			size: "2xl",
			color: "default"
		}))) : /* @__PURE__ */ __dil.jsx("box", {
			key: item,
			width: 4,
			height: 4,
			radius: "full",
			background: item < completedDots ? "surface-inverted" : "border-subtle"
		})]))))), /* @__PURE__ */ __dil.jsx("title", {
			size: isDesktop ? "xl" : "lg",
			weight: "medium",
			textAlign: "end"
		}, state.destination_code)), /* @__PURE__ */ __dil.jsx("row", {
			align: "start",
			gap: 4
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: .5,
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			maxLines: 2
		}, state.origin_city), /* @__PURE__ */ __dil.jsx("row", {
			align: "baseline",
			gap: 1,
			wrap: "wrap"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: isDesktop ? "md" : "sm",
			weight: "medium",
			color: state.departure_time_color
		}, state.departure_time_label), state.departure_scheduled_time_label !== "" && /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary",
			lineThrough: true
		}, state.departure_scheduled_time_label))), /* @__PURE__ */ __dil.jsx("col", {
			gap: .5,
			align: "end",
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			textAlign: "end",
			maxLines: 2
		}, state.destination_city), /* @__PURE__ */ __dil.jsx("row", {
			align: "baseline",
			gap: 1,
			wrap: "wrap",
			justify: "end"
		}, state.arrival_scheduled_time_label !== "" && /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary",
			textAlign: "end",
			lineThrough: true
		}, state.arrival_scheduled_time_label), /* @__PURE__ */ __dil.jsx("text", {
			size: isDesktop ? "md" : "sm",
			weight: "medium",
			textAlign: "end",
			color: state.arrival_time_color
		}, state.arrival_time_label))))))), /* @__PURE__ */ __dil.jsx("divider", {
			flush: true,
			color: "subtle"
		}), /* @__PURE__ */ __dil.jsx("box", { padding: { y: 3 } }, /* @__PURE__ */ __dil.jsx("row", {
			align: "baseline",
			gap: .5,
			wrap: "wrap"
		}, state.summary_lead !== "" && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium"
		}, state.summary_lead), state.summary_emphasis !== "" && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: state.summary_emphasis_color
		}, state.summary_emphasis), state.summary_trail !== "" && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium"
		}, state.summary_trail))), /* @__PURE__ */ __dil.jsx("divider", {
			flush: true,
			color: "subtle"
		}), /* @__PURE__ */ __dil.jsx("box", { padding: { y: 4 } }, /* @__PURE__ */ __dil.jsx("grid", {
			columns: isDesktop ? 2 : 1,
			gap: isDesktop ? 8 : 4
		}, /* @__PURE__ */ __dil.jsx("grid-item", null, /* @__PURE__ */ __dil.jsx(FlightDetails, {
			details: departureDetails,
			isDesktop,
			arrival: false
		})), /* @__PURE__ */ __dil.jsx("grid-item", null, /* @__PURE__ */ __dil.jsx(FlightDetails, {
			details: arrivalDetails,
			isDesktop,
			arrival: true
		})))), /* @__PURE__ */ __dil.jsx("divider", {
			flush: true,
			color: "subtle"
		}), /* @__PURE__ */ __dil.jsx("box", { padding: {
			top: 4,
			bottom: 0
		} }, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, state.attribution_label))));
	}
	function FlightTracker(props) {
		const { resolutionComplete, state } = useResolvedComponentResult("FlightTracker", props);
		if (state?.is_loading === true || !state && !resolutionComplete) return /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 376
		});
		if (!state) return props.fallback ?? null;
		return /* @__PURE__ */ __dil.jsx(ResolvedFlightTracker, { state });
	}

//#endregion
return FlightTracker;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=flight-tracker-widget-1350d409f04b.js.map