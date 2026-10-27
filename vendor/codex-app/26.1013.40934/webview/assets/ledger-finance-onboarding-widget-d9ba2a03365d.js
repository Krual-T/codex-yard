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
//#region LedgerFinanceOnboardingWidget.dil.tsx
	function LedgerFinanceOnboardingWidget(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("LedgerFinanceOnboardingWidget", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 124
		});
		return /* @__PURE__ */ __dil.jsx("pressable", { onClick: () => GenUI.dispatchAction({
			handler: "client",
			type: "mattress_onboarding_card_click",
			payload: {
				card_id: state.id,
				title: state.title,
				thread_mode: state.thread_mode,
				system_hint: state.system_hint,
				...state.action != null ? { action: state.action } : { prompt: state.prompt }
			}
		}) }, /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			background: "surface-elevated",
			padding: 0
		}, /* @__PURE__ */ __dil.jsx("box", {
			height: 124,
			width: "100%",
			padding: {
				x: 4,
				y: 4
			}
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			height: "100%",
			justify: "start"
		}, /* @__PURE__ */ __dil.jsx("row", { align: "center" }, state.icon_url ? /* @__PURE__ */ __dil.jsx("image", {
			src: state.icon_url,
			alt: "",
			width: 24,
			height: 24,
			fit: "contain",
			hideOnFailure: true
		}) : /* @__PURE__ */ __dil.jsx("icon", {
			name: state.icon,
			size: "xl",
			color: "primary"
		})), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 3
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			flex: "auto"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "semibold",
			maxLines: 1
		}, state.title), /* @__PURE__ */ __dil.jsx("caption", {
			size: "md",
			color: "secondary",
			maxLines: 2
		}, state.description)))))));
	}

//#endregion
return LedgerFinanceOnboardingWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=ledger-finance-onboarding-widget-d9ba2a03365d.js.map