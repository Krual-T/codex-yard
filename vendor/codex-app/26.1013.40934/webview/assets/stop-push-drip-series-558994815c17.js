import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


//#region internal/push-drip.dil.tsx
	function useStopSeries(state) {
		const [confirming, setConfirming] = DIL.useState();
		return {
			confirming: confirming ?? state.confirming,
			setConfirming
		};
	}
	function StopSeriesConfirmation({ state, actionStyle = "text_links", onCancel }) {
		return /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			align: "start"
		}, /* @__PURE__ */ __dil.jsx("text", { weight: "semibold" }, state.confirmation_title), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.confirmation_message), /* @__PURE__ */ __dil.jsx("box", {
			direction: actionStyle === "outline_keep" || actionStyle === "text_links" ? "row" : "col",
			gap: 2,
			align: "start",
			wrap: "wrap"
		}, actionStyle === "text_links" ? /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("pressable", {
			inline: true,
			padding: 0,
			disabled: true
		}, /* @__PURE__ */ __dil.jsx("text", {
			inline: true,
			size: "sm",
			color: "secondary",
			underline: true
		}, state.confirm_label)), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, "·"), /* @__PURE__ */ __dil.jsx("pressable", {
			inline: true,
			padding: 0,
			onClick: onCancel
		}, /* @__PURE__ */ __dil.jsx("text", {
			inline: true,
			size: "sm",
			color: "secondary",
			underline: true
		}, state.cancel_label))) : /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("button", {
			color: actionStyle === "red" ? "danger" : "secondary",
			variant: actionStyle === "outline_keep" ? "ghost" : "solid",
			size: "sm",
			pill: false,
			disabled: true
		}, state.confirm_label), /* @__PURE__ */ __dil.jsx("button", {
			color: "secondary",
			variant: actionStyle === "outline_keep" ? "outline" : "ghost",
			size: "sm",
			pill: false,
			onClick: onCancel
		}, state.cancel_label))), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.native_unavailable_label ?? "This action isn’t available here."));
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
//#region StopPushDripSeries.dil.tsx
	function StopPushDripSeries(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("StopPushDripSeries", props.__resolutionId ? {
			...props,
			__state: void 0
		} : props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: 180,
			height: 24
		});
		return /* @__PURE__ */ __dil.jsx(ResolvedStop, { state });
	}
	function ResolvedStop({ state }) {
		const control = useStopSeries(state);
		if (state.stopped) return /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.stopped_label);
		if (!control.confirming) return /* @__PURE__ */ __dil.jsx("pressable", {
			inline: true,
			padding: 0,
			onClick: () => control.setConfirming(true)
		}, /* @__PURE__ */ __dil.jsx("text", {
			inline: true,
			size: "sm",
			color: "secondary",
			underline: true
		}, state.label));
		const content = /* @__PURE__ */ __dil.jsx(StopSeriesConfirmation, {
			state,
			actionStyle: state.action_style,
			onCancel: () => control.setConfirming(false)
		});
		return state.confirmation_layout === "card" ? /* @__PURE__ */ __dil.jsx("card", { size: "sm" }, content) : content;
	}

//#endregion
return StopPushDripSeries;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=stop-push-drip-series-558994815c17.js.map