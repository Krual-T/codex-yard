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
//#region WhatsNewCapabilityWelcome.dil.tsx
	function WhatsNewCapabilityWelcome(props) {
		const supportedActions = DIL.useAppData((data) => data.opGenui?.supportedClientActions);
		const { state, resolutionComplete } = useResolvedComponentResult("WhatsNewCapabilityWelcome", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 88
		});
		return /* @__PURE__ */ __dil.jsx("col", {
			role: "group",
			gap: 2,
			width: "100%",
			align: "start"
		}, state.items.map((item) => {
			const action = state.whats_new_capability_actions[item.action_id];
			const enabled = action != null && action.type !== "start_voice_mode" && (action.type === "issue_new_turn" || action.type === "open_url" || supportedActions?.includes(action.type));
			return /* @__PURE__ */ __dil.jsx("box", {
				key: item.action_id,
				width: "fit-content",
				maxWidth: "100%",
				onVisible: () => GenUI.logEvent?.({
					event_name: "chatgpt_whats_new_capability_action_shown",
					statsig_event_name: "chatgpt_whats_new_capability_action_shown",
					event_data: {
						renderer: "whats_new_capability",
						level: "welcome",
						use_case: "whats_new_capability",
						action_id: item.action_id,
						source: state.whats_new_capability_campaign_id
					}
				})
			}, /* @__PURE__ */ __dil.jsx(LinkImpression, {
				action,
				width: "fit-content",
				maxWidth: "100%",
				height: 40,
				disabled: !enabled
			}, /* @__PURE__ */ __dil.jsx("pressable", {
				width: "fit-content",
				maxWidth: "100%",
				height: 40,
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
				background: "surface",
				clip: true,
				ariaLabel: item.label,
				disabled: !enabled,
				onClick: () => {
					if (!action) return;
					if (action.type === "issue_new_turn" && typeof action.payload.query === "string") {
						const { query, message_metadata, ...payload } = action.payload;
						GenUI.issueNewTurn(query, {
							...payload,
							followup_metadata: message_metadata
						});
					} else GenUI.dispatchAction(action);
				}
			}, /* @__PURE__ */ __dil.jsx("row", {
				align: "center",
				gap: 2,
				width: "100%",
				height: "100%",
				wrap: "nowrap"
			}, /* @__PURE__ */ __dil.jsx("box", {
				width: 24,
				height: 24,
				flex: "none",
				align: "center",
				justify: "center"
			}, item.icon_url != null ? /* @__PURE__ */ __dil.jsx("image", {
				src: item.icon_url,
				alt: "",
				fit: "contain",
				width: 24,
				height: 24,
				fallback: /* @__PURE__ */ __dil.jsx("icon", {
					name: item.action_id === "search" ? "dining-events" : item.action_id === "images" ? "image-square" : "headphones",
					size: "2xl",
					color: "secondary"
				})
			}) : /* @__PURE__ */ __dil.jsx("icon", {
				name: "heart-filled",
				size: "2xl",
				color: "red-500"
			})), /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				weight: "normal",
				color: "primary",
				maxLines: 1
			}, item.label)))));
		}));
	}

//#endregion
return WhatsNewCapabilityWelcome;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=whats-new-capability-welcome-5b66cbefcd9a.js.map