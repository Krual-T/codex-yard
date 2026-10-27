import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


//#region internal/LedgerNoAccounts.dil.tsx
	function LedgerNoAccounts({ labels }) {
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			background: "surface-elevated",
			padding: 0,
			radius: "4xl",
			border: true
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			justify: "between",
			gap: 4,
			padding: {
				x: 6,
				y: 6
			},
			width: "100%",
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0,
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("title", { size: "md" }, labels.no_accounts_title), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, labels.no_accounts_description)), /* @__PURE__ */ __dil.jsx("button", { onClick: () => {
			const action = JSON.parse(labels.no_accounts_action);
			if (action?.handler === "client" && action.type === "issue_new_turn" && action.fallbackAction === void 0 && (action.payload?.action ?? action.type) === "issue_new_turn" && typeof action.payload?.query === "string" && action.payload.message_metadata?.starter_prompt_id === "ledger-widget-no-accounts" && action.payload.message_metadata?.suggestion_type === "starter") {
				GenUI.issueNewTurn(action.payload.query, { followup_metadata: {
					starter_prompt_id: "ledger-widget-no-accounts",
					suggestion_type: "starter",
					system_hints: ["connector:ledger_onboarding_force", "connector:connector_693864f100e4819093e6ed9b651239f1"]
				} });
				return;
			}
			GenUI.dispatchAction(action);
		} }, labels.no_accounts_cta_label)));
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
//#region LedgerSpendSoFarThisMonthWidget.dil.tsx
	function LedgerSpendSoFarThisMonthWidget(props) {
		const result = useResolvedComponentResult("LedgerSpendSoFarThisMonthWidget", props);
		if (!result.state) return result.resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 420
		});
		if (result.state.has_connected_accounts === false) return /* @__PURE__ */ __dil.jsx(LedgerNoAccounts, { labels: result.state.labels });
		return /* @__PURE__ */ __dil.jsx(Resolved, { state: result.state });
	}
	function Resolved({ state }) {
		const wide = DIL.useBreakpoint("sm");
		const dark = DIL.useTheme().isDark;
		const [monthIndex, setMonthIndex] = DIL.useState(state.selected_month_index);
		const [comparisonIndex, setComparisonIndex] = DIL.useState(state.selected_comparison_index);
		const [hover, setHover] = DIL.useState(null);
		const month = state.month_views[monthIndex];
		const comparison = comparisonIndex === 0 ? state.month_views[monthIndex + 1] ?? state.oldest_previous_month_series : comparisonIndex === 1 ? state.average_series : state.month_views[comparisonIndex - 2] ?? (comparisonIndex - 2 === state.month_views.length ? state.oldest_previous_month_series : state.average_series);
		const hidden = state.sensitive_values_hidden ?? false;
		const comparisonTotal = month.is_current_month ? comparison.points[month.days_elapsed].cumulative_spend : comparison.total_spend;
		const comparisonLabel = month.is_current_month ? comparison.points[month.days_elapsed].formatted_cumulative_spend : comparison.total_spend_label;
		const delta = hover?.delta ?? Math.round((month.total_spend - comparisonTotal) * 100) / 100;
		const deltaLabel = Math.abs(delta) > .005 ? \`\${delta > 0 ? state.labels.delta_currency_positive_prefix : state.labels.delta_currency_negative_prefix}\${new Intl.NumberFormat(void 0, {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2
		}).format(Math.abs(delta))}\${delta > 0 ? state.labels.delta_currency_positive_suffix : state.labels.delta_currency_negative_suffix}\` : "";
		const points = month.points.filter((point) => point.day <= month.day_count).map((point) => {
			const selectedAvailable = !month.is_current_month || point.day <= month.days_elapsed;
			const comparisonAvailable = !comparison.is_current_month || point.day <= comparison.days_elapsed;
			const comparisonPoint = comparison.points[point.day];
			return {
				day: point.day,
				hover_enabled: point.day > 0,
				current_month_spend: selectedAvailable ? point.cumulative_spend : null,
				previous_month_spend: comparisonAvailable ? comparisonPoint.cumulative_spend : null,
				previous_month_spend_elapsed: point.day <= month.days_elapsed && comparisonAvailable ? comparisonPoint.cumulative_spend : null,
				previous_month_spend_future: month.is_current_month && !comparison.is_current_month && point.day >= month.days_elapsed && comparisonAvailable ? comparisonPoint.cumulative_spend : null,
				formatted_current_month_spend: selectedAvailable ? point.formatted_cumulative_spend : month.total_spend_label,
				formatted_previous_month_spend: comparisonAvailable ? comparisonPoint.formatted_cumulative_spend : "",
				delta: point.day > 0 && selectedAvailable && comparisonAvailable ? point.cumulative_spend - comparisonPoint.cumulative_spend : 0
			};
		});
		const currentSummary = /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			justify: "between",
			gap: 3,
			width: "100%",
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx("row", {
			gap: 2.5,
			align: "center",
			flex: "0 1 auto",
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: 4,
			height: 40,
			background: "green-500",
			radius: "full"
		}), /* @__PURE__ */ __dil.jsx("box", {
			flex: "0 1 auto",
			minWidth: 0,
			width: 172,
			align: "start"
		}, state.month_views.length > 1 ? /* @__PURE__ */ __dil.jsx("select", {
			name: "selected_month",
			options: state.month_option_groups.length ? state.month_option_groups : state.month_views.map((item) => ({
				label: item.option_label,
				value: item.option_value
			})),
			value: month.option_value,
			onChange: (value) => {
				const index = state.month_views.findIndex((item) => item.option_value === value);
				setMonthIndex(index);
				if (comparisonIndex === index + 2) setComparisonIndex(0);
				setHover(null);
			},
			variant: "ghost",
			size: "sm"
		}) : /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium"
		}, month.summary_label))), /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			align: "end",
			flex: 1,
			minWidth: wide ? 0 : 68
		}, /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, hidden ? state.labels.masked_value : hover?.formatted_current_month_spend ?? month.total_spend_label), deltaLabel ? /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: delta > 0 ? "danger" : "success"
		}, hidden ? state.labels.masked_value : deltaLabel) : null));
		const comparisonSummary = /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			justify: "between",
			gap: 3,
			width: "100%",
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx("row", {
			gap: 2.5,
			align: "center",
			flex: "0 1 auto",
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: 4,
			height: 40,
			background: {
				light: "gray-300",
				dark: "gray-700"
			},
			radius: "full"
		}), /* @__PURE__ */ __dil.jsx("box", {
			flex: "0 1 auto",
			minWidth: 0,
			width: 208,
			align: "start"
		}, state.comparison_options.length > 1 ? /* @__PURE__ */ __dil.jsx("select", {
			name: "selected_comparison",
			options: state.comparison_option_groups.map((group) => ({
				label: group.label,
				options: group.options.filter((option) => option.value !== String(monthIndex + 2))
			})),
			value: String(comparisonIndex),
			onChange: (value) => {
				setComparisonIndex(Number(value));
				setHover(null);
			},
			variant: "ghost",
			size: "sm"
		}) : /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium"
		}, comparison.summary_label))), /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			align: "end",
			flex: 1,
			minWidth: wide ? 0 : 68
		}, /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, hidden ? state.labels.masked_value : hover?.formatted_previous_month_spend ?? comparisonLabel)));
		const series = [{
			type: "line",
			curveType: "monotoneX",
			dataKey: "previous_month_spend_elapsed",
			color: dark ? "gray-700" : "gray-300",
			label: comparison.comparison_series_label
		}];
		if (month.is_current_month && !comparison.is_current_month) series.push({
			type: "line",
			curveType: "monotoneX",
			dataKey: "previous_month_spend_future",
			color: dark ? "gray-600" : "gray-200",
			label: comparison.comparison_future_series_label
		});
		series.push({
			type: "area",
			curveType: "monotoneX",
			dataKey: "current_month_spend",
			color: "green-500",
			label: month.current_series_label
		});
		return /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			background: "surface-elevated",
			padding: 0
		}, /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx("col", {
			gap: .5,
			padding: {
				x: 6,
				top: 5,
				bottom: 3
			}
		}, /* @__PURE__ */ __dil.jsx("title", {
			size: "md",
			weight: "medium"
		}, state.month_views.length > 1 ? state.labels.spending : wide ? month.title_label : state.labels.spending)), /* @__PURE__ */ __dil.jsx("box", {
			gap: 0,
			padding: {
				x: 6,
				y: 1
			}
		}, /* @__PURE__ */ __dil.jsx("divider", { spacing: 0 })), wide ? /* @__PURE__ */ __dil.jsx("row", {
			align: "start",
			gap: 10,
			wrap: "nowrap",
			padding: {
				x: 6,
				top: 3
			},
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			flex: 1,
			minWidth: 0
		}, currentSummary), /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			flex: 1,
			minWidth: 0
		}, comparisonSummary)) : /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			padding: {
				x: 6,
				top: 3
			},
			width: "100%"
		}, currentSummary, comparisonSummary), month.has_spend_data || comparison.has_spend_data ? /* @__PURE__ */ __dil.jsx("box", { padding: {
			x: 6,
			top: wide ? 4 : 3,
			bottom: 6
		} }, /* @__PURE__ */ __dil.jsx("chart", {
			height: wide ? 235 : 199,
			data: points,
			series,
			xAxis: {
				dataKey: "day",
				hide: true,
				axisLine: false,
				labels: month.x_axis_labels,
				ticks: month.x_axis_ticks,
				tickMargin: 8,
				interval: 0,
				padding: "no-gap"
			},
			yAxis: {
				orientation: "right",
				axisLine: false,
				tickFormatter: {
					type: "currency",
					currency: "USD",
					notation: "compact"
				}
			},
			showYAxis: !hidden,
			showLegend: false,
			showTooltip: false,
			showHoverCursor: true,
			hoverIndicatorDataKey: "hover_enabled",
			showIdleHoverIndicator: true,
			showGrid: true,
			disableAnimation: true,
			showDots: false,
			showHoverDots: true,
			onHover: (snapshot) => {
				const point = snapshot.payload;
				setHover(point?.hover_enabled ? point : null);
			}
		})) : /* @__PURE__ */ __dil.jsx("box", { padding: {
			x: 6,
			top: 4
		} }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.labels.no_spending_title))));
	}

//#endregion
return LedgerSpendSoFarThisMonthWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=ledger-spend-so-far-this-month-widget-510f6d7686bf.js.map