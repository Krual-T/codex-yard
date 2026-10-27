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
//#region PluginFollowup.dil.tsx
	function PluginFollowup(props) {
		const { isDark } = DIL.useTheme();
		const supportedActions = DIL.useAppData((data) => data.opGenui?.supportedClientActions);
		const { state, resolutionComplete } = useResolvedComponentResult("PluginFollowup", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: 180,
			height: 44
		});
		if (state.hidden || !supportedActions?.includes("plugin_followup.accept")) return null;
		return /* @__PURE__ */ __dil.jsx("box", {
			direction: "col",
			align: "start",
			gap: 4
		}, !state.is_streaming && state.show_contextual_sentence !== false ? /* @__PURE__ */ __dil.jsx("text", { size: "md" }, state.offer.action.contextual_sentence) : null, /* @__PURE__ */ __dil.jsx("pressable", {
			width: "fit-content",
			maxWidth: "100%",
			minHeight: 44,
			padding: {
				y: 3,
				x: 4
			},
			radius: "full",
			border: {
				size: 1,
				color: "default"
			},
			background: "surface",
			ariaLabel: state.offer.action.label,
			disabled: state.pending || state.is_streaming,
			onClick: () => GenUI.dispatchAction({
				handler: "client",
				type: "plugin_followup.accept",
				payload: { offer: state.offer }
			})
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: 20,
			height: 20,
			flex: "none",
			align: "center",
			justify: "center"
		}, state.icon_url || state.icon_url_dark ? /* @__PURE__ */ __dil.jsx("image", {
			src: (isDark ? state.icon_url_dark : state.icon_url) ?? "",
			alt: "",
			fit: "contain",
			width: 20,
			height: 20,
			radius: "none",
			fallback: /* @__PURE__ */ __dil.jsx("icon", {
				name: "plugin",
				color: "secondary",
				size: "xl"
			})
		}) : /* @__PURE__ */ __dil.jsx("icon", {
			name: "plugin",
			color: "secondary",
			size: "xl"
		})), /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			weight: "normal",
			color: "primary"
		}, state.offer.action.label))));
	}

//#endregion
return PluginFollowup;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=plugin-followup-ab805f54685f.js.map