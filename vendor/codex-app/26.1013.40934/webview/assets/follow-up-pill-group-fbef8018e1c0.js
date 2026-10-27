import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


//#region internal/FollowUpSuggestions.dil.tsx
	function issueSuggestionTurn(action, contentReferenceType) {
		GenUI.issueNewTurn(action.query, {
			prompt: action.query,
			append_to_current_leaf: true,
			event_name: "chatgpt_widget_action",
			event_data: {
				widget_affordance: "OPTION",
				widget_action_target: "follow_up",
				widget_action_value: action.id,
				surface_location: "RESPONSE",
				content_reference_type: contentReferenceType
			},
			followup_metadata: action.source != null ? {
				followups_v2_followup_clicked: true,
				followups_v2_followup_source: action.source
			} : void 0
		});
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
//#region FollowUpPillGroup.dil.tsx
	function FollowUpPillGroup(props) {
		const isMobile = DIL.useIsMobile();
		const { resolutionComplete, state } = useResolvedComponentResult("FollowUpPillGroup", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 120
		});
		return /* @__PURE__ */ __dil.jsx("col", {
			gap: 2,
			width: "100%",
			align: "start"
		}, state.actions.map((action) => /* @__PURE__ */ __dil.jsx("button", {
			key: action.id,
			size: isMobile ? "xl" : "lg",
			variant: "outline",
			color: "secondary",
			onClick: () => issueSuggestionTurn(action, "follow_up_pill_group")
		}, action.icon ? /* @__PURE__ */ __dil.jsx("icon", { name: action.icon }) : null, action.label)));
	}

//#endregion
return FollowUpPillGroup;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=follow-up-pill-group-fbef8018e1c0.js.map