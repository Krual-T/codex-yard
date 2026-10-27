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
//#region ConversationalOnboardingFollowUpPills.dil.tsx
	function ConversationalOnboardingFollowUpPills(props) {
		const componentKey = DIL.useAppData((appData) => typeof props.__resolutionId === "string" && appData.opGenui?.componentResults?.[props.__resolutionId] != null ? props.__resolutionId : componentDataKey("ConversationalOnboardingFollowUpPills", props));
		const { state, resolutionComplete } = useResolvedComponentResult("ConversationalOnboardingFollowUpPills", {
			...props,
			__resolutionId: componentKey
		});
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 80
		});
		return /* @__PURE__ */ __dil.jsx("col", {
			role: "group",
			ariaLabel: "Suggested follow-ups",
			gap: 2,
			width: "100%",
			align: "start"
		}, state.actions.map((item, index) => /* @__PURE__ */ __dil.jsx("box", {
			key: item.onboarding_action_id,
			width: "fit-content",
			height: 40,
			flex: "0 1 auto",
			...GenUI.logEvent ? { onVisible: () => GenUI.logEvent?.({
				event_name: "chatgpt_conversational_onboarding_action_shown",
				statsig_event_name: "chatgpt_conversational_onboarding_action_shown",
				event_data: {
					renderer: item.onboarding_renderer,
					level: item.onboarding_level,
					use_case: item.onboarding_use_case,
					action_id: item.onboarding_action_id,
					source: item.source
				}
			}) } : {}
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			width: "fit-content",
			height: 40,
			flex: "0 1 auto",
			padding: {
				top: 2,
				right: 4,
				bottom: 2,
				left: 2
			},
			radius: "full",
			border: {
				size: 1,
				color: "default"
			},
			background: "surface-primary",
			clip: true,
			ariaLabel: item.label,
			onClick: () => {
				const options = {
					append_to_current_leaf: true,
					event_name: "chatgpt_conversational_onboarding_action_clicked",
					statsig_event_name: "chatgpt_conversational_onboarding_action_clicked",
					event_data: {
						renderer: item.onboarding_renderer,
						level: item.onboarding_level,
						use_case: item.onboarding_use_case,
						action_id: item.onboarding_action_id,
						source: item.source
					}
				};
				const followupMetadata = {
					followups_v2_followup_clicked: true,
					followups_v2_followup_source: item.source
				};
				if (item.onboarding_client_action === "start_voice_mode") GenUI.dispatchAction({
					handler: "client",
					type: "start_voice_mode",
					loadingBehavior: "none",
					payload: {
						...options,
						component_key: componentKey,
						action_index: index,
						query: item.query,
						event_source: "conversational_onboarding",
						voice_landing: "conversational_onboarding_voice_v1",
						message_metadata: followupMetadata
					}
				});
				else GenUI.issueNewTurn(item.query, {
					...options,
					event_source: null,
					voice_landing: null,
					followup_metadata: followupMetadata
				});
			}
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2,
			width: "100%",
			height: "100%"
		}, item.icon_url && /* @__PURE__ */ __dil.jsx("box", {
			flex: "0 0 auto",
			width: 24,
			height: 24
		}, /* @__PURE__ */ __dil.jsx("image", {
			src: item.icon_url,
			alt: "",
			fit: "contain",
			width: 24,
			height: 24,
			hideOnFailure: true
		})), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "normal",
			color: "primary",
			maxLines: 1
		}, item.label))))));
	}

//#endregion
return ConversationalOnboardingFollowUpPills;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=conversational-onboarding-follow-up-pills-d9e96e69639b.js.map