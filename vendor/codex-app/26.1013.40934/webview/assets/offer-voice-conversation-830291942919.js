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
//#region OfferVoiceConversation.dil.tsx
	function OfferVoiceConversation(props) {
		const componentKey = DIL.useAppData((appData) => typeof props.__resolutionId === "string" && appData.opGenui?.componentResults?.[props.__resolutionId] != null ? props.__resolutionId : componentDataKey("OfferVoiceConversation", props));
		const { state, resolutionComplete } = useResolvedComponentResult("OfferVoiceConversation", {
			...props,
			__resolutionId: componentKey
		});
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: 180,
			height: 40
		});
		const startVoice = () => GenUI.dispatchAction({
			handler: "client",
			type: "start_voice_mode",
			payload: {
				component_key: componentKey,
				event_source: "offer_voice_conversation_widget",
				event_name: "chatgpt_widget_action",
				event_data: {
					widget_affordance: "OPTION",
					widget_action_target: "start_voice_mode",
					widget_action_value: "voice",
					surface_location: "RESPONSE",
					content_reference_type: "offer_voice_conversation"
				}
			}
		});
		if (state.presentation === "card") return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			align: "start"
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: state.button_label,
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
			onClick: startVoice
		}, /* @__PURE__ */ __dil.jsx("row", {
			width: "100%",
			align: "center",
			gap: 4
		}, state.icon_url ? /* @__PURE__ */ __dil.jsx("box", { flex: "none" }, /* @__PURE__ */ __dil.jsx("image", {
			src: state.icon_url,
			alt: "",
			width: 36,
			height: 36,
			fit: "contain",
			hideOnFailure: true
		})) : null, /* @__PURE__ */ __dil.jsx("col", {
			flex: "auto",
			minWidth: 0,
			gap: 1,
			align: "start"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			color: "primary"
		}, state.button_label), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "tertiary"
		}, state.description ?? "")))));
		return /* @__PURE__ */ __dil.jsx("box", { align: "start" }, /* @__PURE__ */ __dil.jsx("button", {
			size: "lg",
			variant: "outline",
			color: "primary",
			onClick: startVoice
		}, /* @__PURE__ */ __dil.jsx("icon", { name: "voice-4-bars" }), state.button_label));
	}

//#endregion
return OfferVoiceConversation;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=offer-voice-conversation-830291942919.js.map