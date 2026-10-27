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
//#region internal/suggest-automation.dil.tsx
	function SuggestAutomationView({ state }) {
		const [locallySubmitted, setLocallySubmitted] = DIL.useState(false);
		const submitted = state.submitted || locallySubmitted;
		return /* @__PURE__ */ __dil.jsx("box", {
			align: "start",
			maxWidth: "100%",
			minWidth: 0,
			...GenUI.logEvent ? { onVisible: () => {
				GenUI.logEvent?.({ event_data: { elicitation_metadata: {
					elicitation_type: "automation_schedule",
					stage: "shown"
				} } });
			} } : {}
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			align: "stretch",
			background: {
				light: "surface",
				dark: "surface-elevated"
			},
			border: {
				size: 1,
				color: "default"
			},
			disabled: submitted,
			minHeight: 48,
			justify: "center",
			maxWidth: "100%",
			padding: {
				left: "13px",
				right: "15px",
				y: "10px"
			},
			radius: "4xl",
			onClick: () => {
				if (submitted) return;
				setLocallySubmitted(true);
				if (state.task_opt_in_accept) {
					GenUI.dispatchAction({
						handler: "server",
						type: "task_opt_in_accept",
						payload: { elicitation_metadata: {
							elicitation_type: "automation_schedule",
							stage: "interacted",
							action: "accept"
						} }
					});
					return;
				}
				GenUI.issueNewTurn(state.creation_guidelines, {
					followup_metadata: {
						is_visually_hidden_from_conversation: true,
						suggestion_type: "reply",
						suggested_automation_lifecycle: true,
						suggested_automation_origin_surface: state.origin_surface === "chat" || state.origin_surface === "work" ? state.origin_surface : null,
						suggested_automation_pill_ui_variant: "refreshed"
					},
					event_name: "chatgpt_widget_action",
					statsig_event_name: "suggest_automation_widget_clicked",
					event_data: {
						elicitation_metadata: {
							elicitation_type: "automation_schedule",
							stage: "interacted",
							action: "accept"
						},
						widget_affordance: "OPTION",
						widget_action_target: "automation_suggestion",
						widget_action_value: state.label,
						surface_location: "RESPONSE",
						content_reference_type: "suggest_automation"
					}
				});
			}
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1.5,
			maxWidth: "100%",
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: submitted ? "check" : "clock",
			size: "xl"
		}), /* @__PURE__ */ __dil.jsx("box", {
			flex: "auto",
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			weight: "medium"
		}, state.label)))));
	}

//#endregion
//#region OfferSiteSchedule.dil.tsx
	function OfferSiteSchedule(props) {
		const { resolutionComplete, state } = useResolvedComponentResult("OfferSiteSchedule", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: 280,
			height: 56
		});
		return /* @__PURE__ */ __dil.jsx(SuggestAutomationView, { state });
	}

//#endregion
return OfferSiteSchedule;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=offer-site-schedule-fd878d601b26.js.map