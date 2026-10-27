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
//#region CopyWordsWidget.dil.tsx
	function CopyWordRow({ item, copyLabel }) {
		return /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			padding: {
				left: 2,
				right: 2,
				y: 2
			}
		}, /* @__PURE__ */ __dil.jsx("col", null, /* @__PURE__ */ __dil.jsx("title", null, item.value), /* @__PURE__ */ __dil.jsx("text", null, item.description)), /* @__PURE__ */ __dil.jsx("spacer", null), /* @__PURE__ */ __dil.jsx("button", {
			color: "secondary",
			size: "xs",
			onClick: () => GenUI.dispatchAction({
				handler: "client",
				type: "copy",
				payload: {
					action: "copy",
					value: item.value
				}
			})
		}, copyLabel)), /* @__PURE__ */ __dil.jsx("divider", null));
	}
	function ResolvedCopyWords({ state }) {
		const [expanded, setExpanded] = DIL.useState(false);
		const hasOverflow = state.words.length > 2;
		const visibleWords = expanded ? state.words : state.words.slice(0, 2);
		return /* @__PURE__ */ __dil.jsx("card", { size: "full" }, /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, hasOverflow ? /* @__PURE__ */ __dil.jsx("animate-group", null, visibleWords.map((item, index) => /* @__PURE__ */ __dil.jsx(CopyWordRow, {
			key: index,
			item,
			copyLabel: state.copy_label ?? "Copy"
		}))) : /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, visibleWords.map((item, index) => /* @__PURE__ */ __dil.jsx(CopyWordRow, {
			key: index,
			item,
			copyLabel: state.copy_label ?? "Copy"
		}))), hasOverflow && /* @__PURE__ */ __dil.jsx("box", {
			width: 120,
			padding: { top: 2.5 }
		}, /* @__PURE__ */ __dil.jsx("button", {
			color: "secondary",
			variant: "outline",
			block: true,
			pill: true,
			size: "lg",
			onClick: () => setExpanded(!expanded)
		}, expanded ? "Show less" : \`Show \${state.words.length - 2} more\`))));
	}
	function CopyWordsWidget(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("CopyWordsWidget", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 160
		});
		return /* @__PURE__ */ __dil.jsx(ResolvedCopyWords, { state });
	}

//#endregion
return CopyWordsWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=copy-words-widget-47474d88b058.js.map