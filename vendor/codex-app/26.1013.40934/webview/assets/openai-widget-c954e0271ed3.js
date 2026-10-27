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
//#region OpenaiWidget.dil.tsx
	function OpenaiWidget(props) {
		const { resolutionComplete, state } = useResolvedComponentResult("OpenaiWidget", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: 320,
			height: 260
		});
		return /* @__PURE__ */ __dil.jsx("card", { size: "sm" }, /* @__PURE__ */ __dil.jsx("col", {
			align: "center",
			gap: 3,
			padding: {
				top: 5,
				bottom: 4
			}
		}, /* @__PURE__ */ __dil.jsx("box", { background: "surface-elevated-secondary" }, /* @__PURE__ */ __dil.jsx("image", {
			src: state.image,
			alt: "OpenAI logo",
			fit: "contain",
			width: 260,
			height: 70
		})), /* @__PURE__ */ __dil.jsx("col", {
			align: "center",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("title", { size: "md" }, state.name), /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			textAlign: "center"
		}, state.tagline))), /* @__PURE__ */ __dil.jsx("row", { align: "center" }, /* @__PURE__ */ __dil.jsx("button", { onClick: () => GenUI.dispatchAction({
			type: "link.open",
			payload: { url: state.websiteUrl }
		}) }, "Website"), /* @__PURE__ */ __dil.jsx("button", {
			variant: "outline",
			onClick: () => GenUI.dispatchAction({
				type: "chat.fill",
				payload: { text: state.morePrompt }
			})
		}, "Ask more")));
	}

//#endregion
return OpenaiWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=openai-widget-c954e0271ed3.js.map