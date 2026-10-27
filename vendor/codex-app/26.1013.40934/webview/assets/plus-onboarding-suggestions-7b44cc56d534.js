import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


//#region internal/text-only-markdown.dil.tsx
/** Host-rendered text formatting, without link navigation or image loading. */
	function TextOnlyMarkdown({ children }) {
		return /* @__PURE__ */ __dil.jsx("text-only-markdown", null, children);
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
//#region OnboardingSelectionCard.dil.tsx
	function selectItem(state, item, actionTarget) {
		const analytics = {
			event_name: state.analytics_context ? "chatgpt_widget_action" : null,
			event_data: state.analytics_context ? {
				widget_affordance: "OPTION",
				widget_action_target: actionTarget ?? (state.layout === "follow_up_pills" ? "plus_onboarding_welcome" : "plus_onboarding_task"),
				widget_action_value: item.action_id,
				surface_location: "RESPONSE",
				content_reference_type: "onboarding_selection_card"
			} : null
		};
		if (item.client_action != null) GenUI.dispatchAction({
			handler: "client",
			type: item.client_action,
			payload: item.client_action === "navigate_to_feature" ? {
				feature_id: item.action_id,
				effort: item.action_id === "work" ? "extended" : null,
				...state.layout === "editorial" ? { prompt: item.query } : {},
				...analytics
			} : item.client_action === "set_thinking_effort" ? {
				effort: "extended",
				fallback_effort: "standard",
				prompt: item.query,
				...analytics
			} : {
				prompt: item.query,
				...analytics
			}
		});
		else GenUI.issueNewTurn(item.query, {
			append_to_current_leaf: true,
			...analytics,
			followup_metadata: item.message_metadata || typeof item.onboarding_event === "string" ? {
				...item.message_metadata ? {
					followups_v2_followup_clicked: true,
					followups_v2_followup_source: item.message_metadata.followups_v2_followup_source
				} : {},
				...typeof item.onboarding_event === "string" ? { onboarding: { framework: {
					state: "answer",
					event: item.onboarding_event,
					inputs: {}
				} } } : {}
			} : void 0
		});
	}
	function ResolvedSelection({ state }) {
		const isXs = DIL.useBreakpoint("xs");
		const isMobile = DIL.useIsMobile();
		const supportedActions = DIL.useAppData((data) => data.opGenui?.supportedClientActions);
		const isUnavailable = (item) => (item.client_action === "prefill_composer" || item.client_action === "set_thinking_effort") && supportedActions?.includes(item.client_action) !== true;
		const desktop = isXs && !isMobile;
		const pills = state.layout === "follow_up_pills";
		return /* @__PURE__ */ __dil.jsx("box", {
			direction: "col",
			width: pills && state.welcome_heading == null ? "100%" : "40rem",
			maxWidth: "100%",
			gap: 6,
			align: "start",
			...GenUI.logEvent ? {
				onVisibleWhen: state.analytics_context != null,
				onVisible: () => GenUI.logEvent?.({
					event_name: "chatgpt_conversational_onboarding_stage_shown",
					event_data: {
						flow_id: state.analytics_context?.flow_id,
						stage_id: state.analytics_context?.stage_id,
						...state.analytics_context?.stage_id === "personalized_tasks" ? {
							generation_outcome: state.analytics_context.generation_outcome ?? null,
							generated_feature_ids: state.analytics_context.generated_feature_ids ?? null,
							shown_feature_ids: state.items.map((item) => item.action_id)
						} : {}
					}
				})
			} : {}
		}, state.welcome_heading != null && /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			width: "100%",
			align: "start"
		}, /* @__PURE__ */ __dil.jsx("box", { size: 24 }, /* @__PURE__ */ __dil.jsx("text", null, "👋")), /* @__PURE__ */ __dil.jsx("title", {
			size: "xl",
			color: "primary"
		}, state.welcome_heading), state.welcome_body != null ? /* @__PURE__ */ __dil.jsx(TextOnlyMarkdown, null, state.welcome_body) : null), /* @__PURE__ */ __dil.jsx("col", {
			gap: pills ? 4 : desktop ? 10 : 3,
			width: "100%",
			align: "start"
		}, state.items.map((item) => pills ? /* @__PURE__ */ __dil.jsx("box", {
			key: item.action_id,
			width: "fit-content",
			maxWidth: "100%",
			minWidth: 0,
			radius: 22
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: item.label,
			width: "fit-content",
			height: 44,
			padding: { x: 4 },
			radius: "full",
			border: {
				size: 1,
				color: "default"
			},
			background: "surface-primary",
			disabled: isUnavailable(item),
			onClick: () => selectItem(state, item)
		}, /* @__PURE__ */ __dil.jsx("row", {
			gap: 2,
			align: "center",
			height: "100%",
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: item.icon,
			size: "sm",
			color: item.accent ? {
				light: "blue-400",
				dark: "blue-200"
			} : "primary"
		}), /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			color: item.accent ? {
				light: "blue-400",
				dark: "blue-200"
			} : "primary",
			maxLines: 1
		}, item.label), item.client_action === "navigate_to_feature" && item.action_id !== "file_uploads" && /* @__PURE__ */ __dil.jsx("icon", {
			name: "arrow-top-right-sm",
			size: "sm",
			color: "secondary"
		})))) : desktop ? /* @__PURE__ */ __dil.jsx("row", {
			key: item.action_id,
			gap: 5,
			align: "center",
			width: "100%",
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx("box", {
			size: 32,
			minWidth: 32,
			minHeight: 32,
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: item.icon,
			size: "3xl",
			color: "primary"
		})), /* @__PURE__ */ __dil.jsx("col", {
			gap: .5,
			align: "start",
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			weight: "semibold",
			color: "primary",
			maxLines: 2
		}, item.label), item.description != null && /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			color: "secondary",
			maxLines: 2
		}, item.description)), /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: item.accessibility_label ?? \`\${state.cta_label}: \${item.label}\`,
			height: 44,
			padding: { x: "18.62px" },
			radius: "full",
			border: {
				size: 1,
				color: "default"
			},
			align: "center",
			justify: "center",
			disabled: isUnavailable(item),
			onClick: () => selectItem(state, item)
		}, /* @__PURE__ */ __dil.jsx("row", {
			gap: 2,
			align: "center",
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx("text", { weight: "medium" }, state.cta_label), item.client_action === "navigate_to_feature" && item.action_id !== "file_uploads" && /* @__PURE__ */ __dil.jsx("icon", {
			name: "arrow-top-right-sm",
			size: "lg"
		})))) : /* @__PURE__ */ __dil.jsx("box", {
			key: item.action_id,
			width: "100%",
			minHeight: 140,
			background: "surface-primary",
			border: {
				size: 1,
				color: "default"
			},
			radius: 28
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: item.accessibility_label ?? item.label,
			width: "100%",
			height: "100%",
			flex: 1,
			align: "stretch",
			padding: {
				x: 5,
				y: 5
			},
			radius: 28,
			disabled: isUnavailable(item),
			onClick: () => selectItem(state, item)
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 1.5,
			align: "start",
			width: "100%",
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("row", {
			gap: 1,
			align: "center",
			width: "100%",
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: item.icon,
			size: "md",
			color: "primary"
		}), item.feature_label != null && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: "primary",
			maxLines: 1
		}, item.feature_label), /* @__PURE__ */ __dil.jsx("spacer", null), item.client_action === "navigate_to_feature" && item.action_id !== "file_uploads" && /* @__PURE__ */ __dil.jsx("icon", {
			name: "arrow-top-right-sm",
			size: "sm",
			color: "secondary"
		})), /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			weight: "semibold",
			color: "primary",
			maxLines: 2
		}, item.label), item.description != null && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary",
			maxLines: 2
		}, item.description)))))), state.footer_action != null ? /* @__PURE__ */ __dil.jsx("col", {
			gap: 6,
			width: "100%",
			align: "start"
		}, /* @__PURE__ */ __dil.jsx("divider", {
			spacing: 0,
			color: "subtle"
		}), /* @__PURE__ */ __dil.jsx("box", {
			width: "fit-content",
			maxWidth: "100%",
			radius: 22,
			background: {
				light: "surface",
				dark: "surface-tertiary"
			}
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: state.footer_action.label,
			width: "fit-content",
			height: 44,
			padding: { x: 4 },
			radius: "full",
			border: {
				size: 1,
				color: "subtle"
			},
			onClick: () => selectItem(state, {
				...state.footer_action,
				client_action: null
			}, "plus_onboarding_footer")
		}, /* @__PURE__ */ __dil.jsx("row", {
			gap: 2,
			align: "center",
			height: "100%",
			wrap: "nowrap"
		}, state.footer_action.accent ? /* @__PURE__ */ __dil.jsx("icon", {
			name: state.footer_action.icon,
			size: "sm",
			color: {
				light: "blue-400",
				dark: "blue-200"
			}
		}) : null, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			maxLines: 1,
			color: state.footer_action.accent ? {
				light: "blue-400",
				dark: "blue-200"
			} : "primary"
		}, state.footer_action.label))))) : null);
	}
	function OnboardingSelectionCard(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("OnboardingSelectionCard", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 140
		});
		return /* @__PURE__ */ __dil.jsx(ResolvedSelection, { state });
	}

//#endregion
//#region PlusOnboardingSuggestions.dil.tsx
	function PlusOnboardingSuggestions(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("PlusOnboardingSuggestions", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 140
		});
		return /* @__PURE__ */ __dil.jsx(OnboardingSelectionCard, {
			...state,
			__state: state
		});
	}

//#endregion
return PlusOnboardingSuggestions;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=plus-onboarding-suggestions-7b44cc56d534.js.map