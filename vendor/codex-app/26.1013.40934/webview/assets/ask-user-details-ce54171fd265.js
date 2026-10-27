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
//#region AskUserDetails.dil.tsx
	function AskUserDetails(props) {
		const supportedActions = DIL.useAppData((data) => data.opGenui?.supportedClientActions);
		const { state, resolutionComplete } = useResolvedComponentResult("AskUserDetails", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: 180,
			height: 40
		});
		if (!state.show_details_cta) return null;
		const enabled = supportedActions?.includes("request_user_input") === true;
		return /* @__PURE__ */ __dil.jsx("box", {
			direction: "col",
			align: "start",
			onVisible: () => GenUI.logEvent?.({ event_name: "ask_user_details_impression" })
		}, state.invitation !== "" ? /* @__PURE__ */ __dil.jsx("text", null, state.invitation) : null, /* @__PURE__ */ __dil.jsx("box", {
			align: "start",
			onVisibleWhen: enabled,
			onVisible: () => GenUI.logEvent?.({ event_name: "ask_user_details_enabled_impression" })
		}, /* @__PURE__ */ __dil.jsx("button", {
			size: "lg",
			variant: "outline",
			color: "primary",
			disabled: !enabled,
			onClick: () => GenUI.dispatchAction({
				handler: "client",
				type: "request_user_input",
				payload: {
					questions: state.questions,
					submit_label: state.submit_label,
					event_name: "ask_user_details_clicked"
				}
			})
		}, /* @__PURE__ */ __dil.jsx("icon", { name: "tasks" }), state.display_button_label)));
	}

//#endregion
return AskUserDetails;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=ask-user-details-ce54171fd265.js.map