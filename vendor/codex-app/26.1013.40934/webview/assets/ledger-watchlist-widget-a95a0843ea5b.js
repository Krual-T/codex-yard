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
//#region LedgerWatchlistWidget.dil.tsx
	function ResolvedWatchlist({ state }) {
		const desktop = DIL.useBreakpoint("sm");
		const [rowsToShow, setRowsToShow] = DIL.useState(state.rows_to_show);
		const x = desktop ? 6 : 4;
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			maxWidth: "100%",
			background: "surface-elevated",
			padding: 0,
			radius: "4xl",
			border: 1,
			clip: true
		}, /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx("col", {
			gap: .5,
			padding: {
				x,
				top: 5,
				bottom: 3
			}
		}, /* @__PURE__ */ __dil.jsx("title", { size: "md" }, state.title), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "normal",
			color: "secondary"
		}, state.as_of_label)), /* @__PURE__ */ __dil.jsx("box", {
			gap: 0,
			padding: { x }
		}, /* @__PURE__ */ __dil.jsx("divider", { spacing: 0 })), state.has_entries ? /* @__PURE__ */ __dil.jsx("box", { padding: {
			x,
			bottom: desktop ? 6 : 4
		} }, /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("box", {
			height: 16,
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: 72
		}, /* @__PURE__ */ __dil.jsx("caption", {
			size: "md",
			color: "secondary",
			truncate: true
		}, state.labels.asset)), /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: 72,
			align: "start"
		}, /* @__PURE__ */ __dil.jsx("caption", {
			size: "md",
			color: "secondary",
			truncate: true
		}, state.labels.price)), /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: 72,
			align: "start"
		}, /* @__PURE__ */ __dil.jsx("caption", {
			size: "md",
			color: "secondary",
			truncate: true
		}, state.labels.day_change_percent)))), /* @__PURE__ */ __dil.jsx("divider", null), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, state.rows.slice(0, rowsToShow).map((item, index) => /* @__PURE__ */ __dil.jsx("col", {
			key: item.id,
			gap: 0
		}, index > 0 && /* @__PURE__ */ __dil.jsx("divider", null), /* @__PURE__ */ __dil.jsx("box", { padding: { y: 2 } }, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 72,
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: desktop ? "sm" : "md",
			weight: "normal",
			truncate: true
		}, item.ticker), /* @__PURE__ */ __dil.jsx("caption", {
			size: "md",
			weight: "normal",
			color: "secondary",
			truncate: true,
			maxLines: 1
		}, item.name)), /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: 72,
			align: "start"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: desktop ? "sm" : "md",
			width: "100%",
			weight: "normal",
			truncate: true
		}, item.price_label)), /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: 72,
			align: "start"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: desktop ? "sm" : "md",
			width: "100%",
			weight: "normal",
			truncate: true,
			color: item.day_change_percent_color
		}, (item.day_change_percent_direction === "down" ? state.labels.down_indicator : item.day_change_percent_direction === "up" ? state.labels.up_indicator : "") + item.day_change_percent_label))))))), state.rows.length > 5 && /* @__PURE__ */ __dil.jsx("box", { padding: { top: 5 } }, /* @__PURE__ */ __dil.jsx("button", {
			variant: "soft",
			block: true,
			onClick: () => setRowsToShow(rowsToShow === 5 ? 999 : 5)
		}, rowsToShow === 5 ? state.labels.show_more : state.labels.show_less)))) : /* @__PURE__ */ __dil.jsx("box", { padding: {
			x,
			y: 4
		} }, /* @__PURE__ */ __dil.jsx("caption", { size: "md" }, state.empty_state_label))));
	}
	function LedgerWatchlistWidget(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("LedgerWatchlistWidget", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 320
		});
		return /* @__PURE__ */ __dil.jsx(ResolvedWatchlist, { state });
	}

//#endregion
return LedgerWatchlistWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=ledger-watchlist-widget-a95a0843ea5b.js.map