import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


//#region internal/CalendarEventRows.dil.tsx
	function CalendarEventRows({ events, locations = false }) {
		return /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, events.map((event, index) => /* @__PURE__ */ __dil.jsx("row", {
			key: event.id ?? index,
			align: "center",
			padding: {
				x: 3,
				y: 2
			},
			gap: 3,
			radius: "xl",
			background: event.isNew ? "none" : "surface-secondary",
			border: event.isNew ? {
				size: 1,
				color: event.color,
				style: "dashed"
			} : void 0
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: 4,
			height: 40,
			radius: "full",
			background: event.color
		}), /* @__PURE__ */ __dil.jsx("col", null, /* @__PURE__ */ __dil.jsx("text", null, event.title), locations && event.location != null ? /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "tertiary"
		}, event.location) : null, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "tertiary"
		}, event.time)), locations || event.isNew ? /* @__PURE__ */ __dil.jsx("spacer", null) : null, event.isNew ? /* @__PURE__ */ __dil.jsx("button", { onClick: () => GenUI.dispatchAction({
			type: "client",
			payload: {
				action: "add_to_calendar",
				item: event
			}
		}) }, "Add") : null)));
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
//#region CalendarEventsWidget.dil.tsx
	function CalendarEventsWidget(props) {
		const { resolutionComplete, state } = useResolvedComponentResult("CalendarEventsWidget", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 140
		});
		return /* @__PURE__ */ __dil.jsx("card", { size: "md" }, /* @__PURE__ */ __dil.jsx("row", { align: "start" }, /* @__PURE__ */ __dil.jsx("col", {
			align: "start",
			gap: 1,
			width: 80
		}, /* @__PURE__ */ __dil.jsx("caption", {
			size: "lg",
			color: "secondary"
		}, state.date.header), /* @__PURE__ */ __dil.jsx("title", { size: "3xl" }, state.date.subheader)), /* @__PURE__ */ __dil.jsx("col", { flex: "auto" }, /* @__PURE__ */ __dil.jsx(CalendarEventRows, {
			events: state.events,
			locations: true
		}))));
	}

//#endregion
return CalendarEventsWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=calendar-events-widget-586e2ba0f0ed.js.map