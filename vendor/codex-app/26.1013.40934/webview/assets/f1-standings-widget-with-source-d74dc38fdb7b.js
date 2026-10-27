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
//#region F1StandingsWidgetWithSource.dil.tsx
	function ResolvedF1Standings({ state }) {
		const [activeTabId, setActiveTabId] = DIL.useState(state.active_tab_id);
		const [rowsToShow, setRowsToShow] = DIL.useState(5);
		const activeTab = state.tabs.find((tab) => tab.id === activeTabId);
		return /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			padding: 0,
			variant: "soft",
			background: "transparent",
			radius: 0
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 4,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("col", { gap: 1 }, state.subtitle ? /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			weight: "semibold",
			color: "secondary"
		}, "F1"), /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, \`• \${state.subtitle}\`)) : null, /* @__PURE__ */ __dil.jsx("title", { size: "md" }, state.display_title)), state.tabs.length > 1 ? /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			scrollable: true,
			gap: 1,
			width: "100%"
		}, state.tabs.map((tab) => /* @__PURE__ */ __dil.jsx("button", {
			key: tab.id,
			variant: activeTabId === tab.id ? "soft" : "ghost",
			color: "secondary",
			size: "xs",
			pill: true,
			onClick: () => {
				setActiveTabId(tab.id);
				setRowsToShow(5);
			}
		}, tab.label))) : null, activeTab ? /* @__PURE__ */ __dil.jsx("col", { gap: 4 }, /* @__PURE__ */ __dil.jsx("box", {
			direction: "row",
			scrollable: true
		}, /* @__PURE__ */ __dil.jsx("table", null, [/* @__PURE__ */ __dil.jsx("table-row", null, [/* @__PURE__ */ __dil.jsx("table-cell", {
			vAlign: "center",
			colSpan: 2
		}, /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "xs",
			maxLines: 1
		}, activeTab.entity_header)), ...activeTab.headers.map((header) => /* @__PURE__ */ __dil.jsx("table-cell", {
			vAlign: "center",
			align: "center"
		}, /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "xs"
		}, header.text)))]), ...activeTab.rows.slice(0, rowsToShow).map((row) => /* @__PURE__ */ __dil.jsx("table-row", null, [
			/* @__PURE__ */ __dil.jsx("table-cell", {
				vAlign: "center",
				width: "3ch"
			}, /* @__PURE__ */ __dil.jsx("box", {
				flex: 0,
				width: "fit-content",
				padding: { right: .5 }
			}, /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				color: "secondary",
				maxLines: 1
			}, row.rank))),
			/* @__PURE__ */ __dil.jsx("table-cell", {
				vAlign: "center",
				padding: { x: 0 },
				width: "50%"
			}, /* @__PURE__ */ __dil.jsx("row", {
				align: "center",
				gap: 1,
				padding: { y: 1 }
			}, row.flag_emoji ? /* @__PURE__ */ __dil.jsx("box", {
				width: 20,
				align: "center"
			}, /* @__PURE__ */ __dil.jsx("text", {
				size: "md",
				maxLines: 1
			}, row.flag_emoji)) : null, /* @__PURE__ */ __dil.jsx("col", {
				gap: 0,
				align: "start"
			}, /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, row.name), row.subtitle ? /* @__PURE__ */ __dil.jsx("text", {
				color: "tertiary",
				size: "xs",
				maxLines: 1
			}, row.subtitle) : null))),
			...row.values.map((value) => /* @__PURE__ */ __dil.jsx("table-cell", { vAlign: "center" }, /* @__PURE__ */ __dil.jsx("box", { align: "center" }, /* @__PURE__ */ __dil.jsx("box", {
				width: "max-content",
				justify: "center"
			}, /* @__PURE__ */ __dil.jsx("text", {
				size: "xs",
				weight: value.key === "points" ? "medium" : "normal",
				maxLines: 1
			}, value.text)))))
		]))])), activeTab.rows.length > 5 ? /* @__PURE__ */ __dil.jsx("box", { padding: { top: 3 } }, /* @__PURE__ */ __dil.jsx("button", {
			variant: "soft",
			block: true,
			onClick: () => setRowsToShow(rowsToShow === 5 ? 999 : 5)
		}, rowsToShow === 5 ? state.show_more_label : state.show_less_label)) : null) : null));
	}
	function F1StandingsWidgetWithSource(props) {
		const { resolutionComplete, state } = useResolvedComponentResult("F1StandingsWidgetWithSource", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 520
		});
		return /* @__PURE__ */ __dil.jsx(ResolvedF1Standings, { state });
	}

//#endregion
return F1StandingsWidgetWithSource;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=f1-standings-widget-with-source-d74dc38fdb7b.js.map