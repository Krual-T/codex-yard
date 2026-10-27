import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


//#region internal/LinkImpression.dil.tsx
/** Observe the rendered link without invoking its click action. */
	function LinkImpression({ url, action, careProvider, disabled, unlessSupportedAction, children, ...boxProps }) {
		const opGenui = DIL.useAppData((data) => data.opGenui);
		const shownUrls = DIL.useRef([]);
		const payload = action?.payload;
		const actionUrl = action?.type === "open_url" && (action.handler === void 0 || action.handler === "client") && !(typeof payload === "object" && payload !== null && "action" in payload && typeof payload.action === "string" && payload.action !== "open_url") && typeof payload === "object" && payload !== null && "url" in payload && typeof payload.url === "string" ? payload.url : void 0;
		const destination = action ? actionUrl : url;
		if (disabled || unlessSupportedAction && opGenui?.supportedClientActions?.includes(unlessSupportedAction) || typeof destination !== "string" || !destination.trim() || !opGenui?.supportedClientActions?.includes("genui_link_impressions")) return /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, children);
		const linkType = opGenui.linkMetadataByUrl?.[destination.trim()]?.linkType;
		if (linkType !== void 0 && typeof linkType !== "string") return /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, children);
		return /* @__PURE__ */ __dil.jsx("box", {
			...boxProps,
			onVisibleKey: destination,
			onVisible: () => {
				if (shownUrls.current.includes(destination)) return;
				const careOrigin = careProvider ? /^(https?):\\/\\/(?:[^\\\\/?#]*@)?([^\\\\/?#]+)/i.exec(destination.trim()) : null;
				if (careProvider && !careOrigin) return;
				const telemetryUrl = careOrigin ? \`\${careOrigin[1]}://\${careOrigin[2]}\` : destination;
				shownUrls.current = [...shownUrls.current, destination];
				GenUI.dispatchAction({
					handler: "client",
					type: "log_event",
					payload: {
						event_name: "genui_link_shown",
						event_data: {
							url: telemetryUrl,
							is_care_provider_link: careProvider,
							link_type: linkType?.toLowerCase() ?? "general_external"
						}
					}
				});
			}
		}, children);
	}

//#endregion
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
//#region FollowUpCardGroup.dil.tsx
	function FollowUpCardGroup(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("FollowUpCardGroup", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 88
		});
		return /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			gap: 3
		}, state.actions.map((action) => /* @__PURE__ */ __dil.jsx(LinkImpression, {
			url: action.url,
			key: action.id,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			key: action.id,
			ariaLabel: action.label,
			width: "100%",
			padding: {
				x: 4,
				y: 3
			},
			radius: "4xl",
			border: {
				size: 1,
				color: "subtle"
			},
			variant: "ghost",
			onClick: () => {
				if (action.url != null) {
					GenUI.dispatchAction({
						handler: "client",
						type: "open_url",
						payload: {
							url: action.url,
							event_name: "chatgpt_widget_action",
							event_data: {
								widget_affordance: "OPTION",
								widget_action_target: "follow_up",
								widget_action_value: action.id,
								surface_location: "RESPONSE",
								content_reference_type: "follow_up_card_group"
							}
						}
					});
					return;
				}
				if (action.prefill_new_thread_surface === "work") {
					GenUI.dispatchAction({
						handler: "client",
						type: "navigate_to_feature",
						payload: {
							feature_id: "work",
							prompt: action.query,
							event_name: "chatgpt_widget_action",
							event_data: {
								widget_affordance: "OPTION",
								widget_action_target: "follow_up",
								widget_action_value: action.id,
								surface_location: "RESPONSE",
								content_reference_type: "follow_up_card_group"
							}
						}
					});
					return;
				}
				if (action.query != null) issueSuggestionTurn({
					...action,
					query: action.query
				}, "follow_up_card_group");
			}
		}, /* @__PURE__ */ __dil.jsx("row", {
			width: "100%",
			align: "center",
			gap: 4
		}, action.icon_url ? /* @__PURE__ */ __dil.jsx("box", {
			width: 36,
			height: 36,
			flex: "none"
		}, /* @__PURE__ */ __dil.jsx("image", {
			src: action.icon_url,
			alt: "",
			width: 36,
			height: 36,
			fit: "contain",
			hideOnFailure: true
		})) : action.emoji ? /* @__PURE__ */ __dil.jsx("box", {
			width: 36,
			flex: "none",
			ariaHidden: true
		}, /* @__PURE__ */ __dil.jsx("title", {
			size: "2xl",
			weight: "normal"
		}, action.emoji)) : null, /* @__PURE__ */ __dil.jsx("col", {
			flex: "auto",
			minWidth: 0,
			gap: 1,
			align: "start"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			color: "primary"
		}, action.label), action.description ? /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "tertiary"
		}, action.description) : null))))));
	}

//#endregion
return FollowUpCardGroup;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=follow-up-card-group-ca1a8925d7df.js.map