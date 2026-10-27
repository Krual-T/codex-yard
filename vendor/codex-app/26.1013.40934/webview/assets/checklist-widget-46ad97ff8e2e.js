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
//#region ChecklistWidget.dil.tsx
	function ChecklistWidget(props) {
		const { resolutionComplete, state } = useResolvedComponentResult("ChecklistWidget", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 140
		});
		return /* @__PURE__ */ __dil.jsx("card", { size: "full" }, state.sections.map((section, index) => /* @__PURE__ */ __dil.jsx(ChecklistSectionView, {
			key: index,
			section
		})));
	}
	function ChecklistSectionView({ section }) {
		const [expanded, setExpanded] = DIL.useState(false);
		const [checked, setChecked] = DIL.useState(section.items.map(() => false));
		const hasOverflow = section.items.length > 4;
		const visibleItems = expanded ? section.items : section.items.slice(0, 4);
		return /* @__PURE__ */ __dil.jsx("col", null, /* @__PURE__ */ __dil.jsx("text", null, section.name), /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx("animate-group", null, visibleItems.map((item, index) => /* @__PURE__ */ __dil.jsx("row", {
			key: index,
			padding: 2.5,
			align: "center"
		}, /* @__PURE__ */ __dil.jsx("checkbox", {
			shape: "square",
			lineThrough: false,
			checked: checked[index] ?? false,
			onChange: (value) => setChecked((previous) => section.items.map((_, itemIndex) => itemIndex === index ? value : previous[itemIndex] ?? false))
		}), /* @__PURE__ */ __dil.jsx("text", null, item)))), hasOverflow ? /* @__PURE__ */ __dil.jsx("box", {
			width: 120,
			padding: { top: 2.5 }
		}, /* @__PURE__ */ __dil.jsx("button", {
			block: true,
			pill: true,
			size: "lg",
			color: "secondary",
			variant: "outline",
			onClick: () => setExpanded(!expanded)
		}, expanded ? "Show less" : \`Show \${section.items.length - 4} more\`)) : null));
	}

//#endregion
return ChecklistWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=checklist-widget-46ad97ff8e2e.js.map