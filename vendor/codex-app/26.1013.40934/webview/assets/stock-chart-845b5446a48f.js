import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


//#region internal/FollowUpActionBar.dil.tsx
	function FollowUpActionBarPresentation({ actions = [], contentReferenceType, outerPadding = 5 }) {
		return /* @__PURE__ */ __dil.jsx(FollowUpFooter, {
			actions,
			outerPadding,
			onAction: (action) => GenUI.issueNewTurn(action.query, {
				prompt: action.query,
				event_name: "chatgpt_widget_action",
				event_data: {
					widget_affordance: "OPTION",
					widget_action_target: "follow_up",
					widget_action_value: action.label,
					surface_location: "RESPONSE",
					content_reference_type: contentReferenceType,
					is_genui: true
				}
			})
		});
	}
	function FollowUpFooter({ actions, onAction, outerPadding = 5 }) {
		const isSm = DIL.useBreakpoint("sm");
		const isXs = DIL.useBreakpoint("xs");
		const visibleActions = actions.slice(0, isSm ? 3 : isXs ? 2 : 1);
		return actions.length ? /* @__PURE__ */ __dil.jsx("box", { width: "100%" }, /* @__PURE__ */ __dil.jsx("box", { padding: {
			x: outerPadding,
			y: 3
		} }, /* @__PURE__ */ __dil.jsx("divider", null)), /* @__PURE__ */ __dil.jsx("box", { padding: {
			bottom: outerPadding,
			left: outerPadding,
			right: outerPadding
		} }, /* @__PURE__ */ __dil.jsx("box", {
			background: "surface-secondary",
			border: {
				color: "alpha-12",
				size: 1
			},
			padding: {
				x: .5,
				y: .5
			},
			radius: "lg"
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			ariaLabel: "Suggested follow-ups",
			gap: 0,
			role: "group",
			width: "100%"
		}, visibleActions.map((action, index) => /* @__PURE__ */ __dil.jsx("box", {
			align: "center",
			direction: "row",
			flex: 1,
			key: \`\${action.query}:\${index}\`,
			minWidth: 0
		}, index > 0 ? /* @__PURE__ */ __dil.jsx("box", {
			ariaHidden: true,
			background: "alpha-10",
			height: 24,
			width: 1
		}) : null, /* @__PURE__ */ __dil.jsx("box", {
			align: "center",
			flex: 1,
			justify: "center",
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("button", {
			block: true,
			color: "secondary",
			onClick: () => onAction(action),
			size: "sm",
			variant: "ghost"
		}, action.icon ? /* @__PURE__ */ __dil.jsx("icon", { name: action.icon }) : null, " ", action.label)))))))) : null;
	}

//#endregion
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
//#region StockChart.dil.tsx
	function ShareButton({ componentKey, label, block = false }) {
		return /* @__PURE__ */ __dil.jsx("button", {
			label,
			block,
			color: "secondary",
			onClick: () => GenUI.dispatchAction({
				type: "share",
				handler: "client",
				payload: { component_key: componentKey }
			}),
			size: "sm",
			uniform: !block,
			variant: block ? "soft" : "ghost"
		}, /* @__PURE__ */ __dil.jsx("icon", { name: "share" }), block ? label : null);
	}
	function ComparisonHeader({ cards, isDesktop }) {
		return /* @__PURE__ */ __dil.jsx("grid", {
			columns: isDesktop ? 2 : 1,
			gap: 4
		}, cards.map((card, index) => /* @__PURE__ */ __dil.jsx("grid-item", { key: \`\${card.ticker ?? card.company_name}:\${index}\` }, /* @__PURE__ */ __dil.jsx("row", {
			gap: 3,
			align: "stretch"
		}, /* @__PURE__ */ __dil.jsx("box", {
			background: \`\${card.color}-400\`,
			radius: "full",
			width: 4
		}), /* @__PURE__ */ __dil.jsx("col", {
			gap: 1,
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "start",
			gap: 4
		}, /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			truncate: true
		}, card.company_name)), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			textAlign: "end",
			tabularNums: true
		}, card.price_text)), /* @__PURE__ */ __dil.jsx("row", {
			align: "start",
			gap: 4,
			justify: "between"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium"
		}, card.ticker && card.ticker !== card.company_name ? \`(\${card.ticker})\` : ""), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			textAlign: "end",
			color: card.price_change_color,
			tabularNums: true
		}, card.price_change_text)))))));
	}
	function ResolvedStockChart({ state, componentKey }) {
		const isDesktop = DIL.useBreakpoint("md");
		const [selectedRange, setSelectedRange] = DIL.useState(state.default_range);
		const [hover, setHover] = DIL.useState(null);
		const range = state.timeframe_configs[selectedRange] ? selectedRange : state.default_range;
		const timeframe = state.timeframe_configs[range];
		const chart = timeframe?.chart;
		const summary = timeframe?.summary ?? state.fallback_summary;
		const hoveredPoint = hover?.range === range ? chart?.data[hover.index] : void 0;
		const comparisonCards = hoveredPoint?.comparison_rows ?? timeframe?.comparison_rows ?? [];
		const metrics = isDesktop ? state.metrics_display : state.metrics_display_mobile;
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			padding: 0
		}, /* @__PURE__ */ __dil.jsx("col", { gap: 2 }, /* @__PURE__ */ __dil.jsx("box", null, /* @__PURE__ */ __dil.jsx("row", {
			gap: 3,
			align: "start"
		}, /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0,
			gap: 1
		}, state.is_comparison_mode ? /* @__PURE__ */ __dil.jsx(ComparisonHeader, {
			cards: comparisonCards,
			isDesktop
		}) : /* @__PURE__ */ __dil.jsx("col", { gap: 1 }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.asset_display_name), /* @__PURE__ */ __dil.jsx("title", {
			size: "xl",
			weight: "medium",
			tabularNums: true
		}, hoveredPoint?.price_formatted ?? state.current_price_text), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: summary.price_change_color
		}, summary.price_change_text), summary.trade_date_text ? /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, summary.trade_date_text) : null, state.after_hours.price_text ? /* @__PURE__ */ __dil.jsx("row", {
			gap: 1,
			align: "center",
			wrap: "wrap"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium"
		}, state.after_hours.price_text), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: state.after_hours.color
		}, state.after_hours.change_text), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: state.after_hours.color
		}, state.after_hours.percent_text), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.after_hours.label)) : null)), state.share_button_variant === "top_right" ? /* @__PURE__ */ __dil.jsx(ShareButton, {
			componentKey,
			label: state.labels.share
		}) : null)), state.timeframe_order.length > 0 ? /* @__PURE__ */ __dil.jsx("col", { gap: 2 }, /* @__PURE__ */ __dil.jsx("divider", null), /* @__PURE__ */ __dil.jsx("segmented-control", {
			block: isDesktop,
			options: state.timeframe_order.map((label) => ({
				value: label,
				label
			})),
			value: range,
			variant: "ghost",
			size: "md",
			onChange: (nextRange) => {
				setSelectedRange(nextRange);
				setHover(null);
				GenUI.dispatchAction({
					type: "log_event",
					handler: "client",
					payload: {
						event_name: "chatgpt_widget_action",
						event_data: {
							widget_affordance: "OPTION",
							widget_action_target: "timeframe",
							widget_action_value: nextRange,
							surface_location: "RESPONSE",
							content_reference_type: "stock"
						}
					}
				});
			}
		})) : null, state.has_timeframe_data && chart ? /* @__PURE__ */ __dil.jsx("box", null, /* @__PURE__ */ __dil.jsx("chart", {
			width: "100%",
			height: isDesktop ? 340 : 240,
			data: chart.data,
			series: chart.series,
			xAxis: chart.xAxis ?? "timestamp",
			yAxis: chart.yAxis ?? void 0,
			tooltipValueFormatter: chart.tooltipValueFormatter,
			disableAnimation: chart.disableAnimation,
			showLegend: false,
			showYAxis: true,
			onHover: (snapshot) => setHover(snapshot.index === null ? null : {
				range,
				index: snapshot.index
			})
		})) : /* @__PURE__ */ __dil.jsx("col", {
			align: "center",
			justify: "center",
			minHeight: 340,
			padding: 6
		}, /* @__PURE__ */ __dil.jsx("text", { color: "secondary" }, state.labels.no_chart_data)), state.show_metrics && (chart?.series.length ?? 0) <= 1 ? /* @__PURE__ */ __dil.jsx("col", {
			gap: 2,
			padding: { top: 2 }
		}, metrics.map((row, index) => /* @__PURE__ */ __dil.jsx("box", { key: index }, /* @__PURE__ */ __dil.jsx("grid", {
			columns: isDesktop ? 3 : 2,
			gap: 8
		}, row.cols.map((metric) => /* @__PURE__ */ __dil.jsx("grid-item", { key: metric.label }, /* @__PURE__ */ __dil.jsx("row", {
			gap: .5,
			justify: "between",
			align: "center"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, metric.label), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			textAlign: "end"
		}, metric.value)))))))) : null, state.share_button_variant === "bottom" ? /* @__PURE__ */ __dil.jsx("box", null, /* @__PURE__ */ __dil.jsx(ShareButton, {
			componentKey,
			label: state.labels.share,
			block: true
		})) : null, /* @__PURE__ */ __dil.jsx(FollowUpActionBarPresentation, {
			actions: state.follow_up_actions,
			contentReferenceType: "stock",
			outerPadding: 0
		})));
	}
	function StockChart(props) {
		const componentKey = DIL.useAppData((appData) => typeof props.__resolutionId === "string" && appData.opGenui?.componentResults?.[props.__resolutionId] != null ? props.__resolutionId : componentDataKey("StockChart", props));
		const canShare = DIL.useAppData((appData) => appData.opGenui?.supportedClientActions?.includes("share") === true);
		const { state, resolutionComplete } = useResolvedComponentResult("StockChart", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 480
		});
		return /* @__PURE__ */ __dil.jsx(ResolvedStockChart, {
			componentKey,
			state: canShare ? state : {
				...state,
				share_button_variant: "none"
			}
		});
	}

//#endregion
return StockChart;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=stock-chart-845b5446a48f.js.map