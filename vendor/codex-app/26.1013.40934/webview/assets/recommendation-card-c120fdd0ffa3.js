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
//#region RecommendationCard.dil.tsx
	function RecommendationCard(props) {
		const canOpenConversation = DIL.useAppData((data) => data.opGenui?.supportedClientActions?.includes("open_conversation") === true);
		const { state, resolutionComplete } = useResolvedComponentResult("RecommendationCard", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 88
		});
		return /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			padding: 0
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			padding: 4,
			radius: "3xl",
			variant: "ghost",
			align: "stretch",
			ariaLabel: state.title,
			disabled: !canOpenConversation,
			onClick: () => GenUI.dispatchAction({
				handler: "client",
				type: "open_conversation",
				payload: { conversation_id: state.conversation_id }
			})
		}, /* @__PURE__ */ __dil.jsx("row", {
			width: "100%",
			align: "center",
			gap: 4
		}, state.icon_url ? /* @__PURE__ */ __dil.jsx("box", {
			width: 40,
			height: 40,
			flex: "none"
		}, /* @__PURE__ */ __dil.jsx("image", {
			src: state.icon_url,
			alt: "",
			width: 40,
			height: 40,
			fit: "contain",
			hideOnFailure: true
		})) : state.emoji ? /* @__PURE__ */ __dil.jsx("box", {
			width: 40,
			flex: "none",
			ariaHidden: true
		}, /* @__PURE__ */ __dil.jsx("title", {
			size: "2xl",
			weight: "normal"
		}, state.emoji)) : null, /* @__PURE__ */ __dil.jsx("col", {
			flex: "auto",
			minWidth: 0,
			gap: 1,
			align: "start"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			weight: "semibold",
			color: "primary"
		}, state.title), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.description)))));
	}

//#endregion
return RecommendationCard;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=recommendation-card-c120fdd0ffa3.js.map