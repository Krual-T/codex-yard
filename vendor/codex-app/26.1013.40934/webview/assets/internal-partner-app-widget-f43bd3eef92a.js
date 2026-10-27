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
//#region InternalPartnerAppWidget.dil.tsx
	function InternalPartnerAppWidget(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("InternalPartnerAppWidget", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 116
		});
		return /* @__PURE__ */ __dil.jsx("box", { width: "100%" }, /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			width: 476,
			padding: {
				x: 4,
				y: 3.5
			}
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2.5,
			width: "100%",
			minWidth: 0
		}, state.provider_logo != null && state.provider_logo !== "" && /* @__PURE__ */ __dil.jsx("box", {
			align: "center",
			justify: "center",
			width: 32,
			height: 32,
			padding: 1,
			radius: "md",
			background: "surface-elevated"
		}, /* @__PURE__ */ __dil.jsx("image", {
			src: state.provider_logo,
			alt: state.title,
			width: 24,
			height: 24,
			fit: "contain",
			hideOnFailure: true
		})), /* @__PURE__ */ __dil.jsx("title", {
			size: "md",
			weight: "semibold",
			color: "primary",
			maxLines: 2
		}, state.title)), /* @__PURE__ */ __dil.jsx("button", {
			variant: "outline",
			color: "primary",
			size: "lg",
			block: true,
			disabled: state.launcher_payload == null,
			onClick: () => {
				if (state.launcher_payload != null) GenUI.dispatchAction({
					type: "launch_ecosystem_widget",
					handler: "client",
					payload: state.launcher_payload
				});
			}
		}, state.button_name))));
	}

//#endregion
return InternalPartnerAppWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=internal-partner-app-widget-f43bd3eef92a.js.map