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
//#region internal/ledger-overview.dil.tsx
	function LedgerConversionNote({ state }) {
		const note = state.currency_conversion?.currency_conversion_note;
		return note ? /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, note) : null;
	}

//#endregion
//#region LedgerSpendByCategoryWidget.dil.tsx
	function LedgerSpendByCategoryWidget(props) {
		const result = useResolvedComponentResult("LedgerSpendByCategoryWidget", props);
		if (!result.state) return result.resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 380
		});
		if (result.state.has_connected_accounts === false) return /* @__PURE__ */ __dil.jsx(LedgerNoAccounts, { labels: result.state.labels });
		return /* @__PURE__ */ __dil.jsx(Resolved, { state: result.state });
	}
	function Resolved({ state }) {
		const wide = DIL.useBreakpoint("sm");
		const [selected, setSelected] = DIL.useState(state.selected_month_index);
		const [showMore, setShowMore] = DIL.useState(false);
		const month = state.month_views[selected];
		const hidden = state.sensitive_values_hidden ?? false;
		const categories = month ? showMore ? month.categories : month.top_categories : [];
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			background: "surface-elevated",
			padding: 0,
			radius: "4xl",
			border: true
		}, /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx("col", {
			gap: 1,
			padding: {
				x: 6,
				top: 5,
				bottom: 3
			}
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "start",
			gap: 4
		}, /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0,
			gap: .5,
			align: "start"
		}, /* @__PURE__ */ __dil.jsx("title", null, wide ? state.title : state.labels.spending), state.month_views.length > 1 ? /* @__PURE__ */ __dil.jsx("select", {
			name: "selected_month",
			options: state.month_option_groups.length ? state.month_option_groups : state.month_views.map((item) => ({
				label: item.option_label,
				value: item.option_value
			})),
			value: month.option_value,
			onChange: (value) => {
				setSelected(state.month_views.findIndex((item) => item.option_value === value));
				setShowMore(false);
			},
			variant: "ghost",
			size: "sm"
		}) : month ? /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, month.month) : null, /* @__PURE__ */ __dil.jsx(LedgerConversionNote, { state })), /* @__PURE__ */ __dil.jsx("title", {
			textAlign: "end",
			maxLines: 1
		}, hidden ? state.labels.masked_value : month?.total ?? ""))), /* @__PURE__ */ __dil.jsx("box", {
			gap: 0,
			padding: { x: 6 }
		}, /* @__PURE__ */ __dil.jsx("divider", { spacing: 0 })), month && month.top_categories.length === 0 ? /* @__PURE__ */ __dil.jsx("box", { padding: {
			x: 6,
			bottom: 5
		} }, /* @__PURE__ */ __dil.jsx("row", {
			gap: 3,
			align: "center",
			padding: { y: 2 }
		}, /* @__PURE__ */ __dil.jsx("box", {
			size: 36,
			background: "alpha-10",
			radius: "full",
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "receipt",
			size: "lg",
			color: "secondary"
		})), /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0,
			gap: .5
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium"
		}, state.labels.no_spending_title), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.labels.no_spending_description)))) : month ? /* @__PURE__ */ __dil.jsx("col", {
			gap: 6,
			padding: {
				x: 6,
				top: 6,
				bottom: 4
			}
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: .5
		}, month.segments.map((item, index) => /* @__PURE__ */ __dil.jsx("box", {
			key: item.id,
			ariaLabel: item.primary_category,
			radius: {
				topLeft: index === 0 ? "md" : "2xs",
				bottomLeft: index === 0 ? "md" : "2xs",
				topRight: index === month.segments.length - 1 ? "md" : "2xs",
				bottomRight: index === month.segments.length - 1 ? "md" : "2xs"
			},
			background: item.color,
			flex: item.weight,
			minWidth: 3,
			height: 40
		}))), /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, categories.map((item, index) => {
			const row = /* @__PURE__ */ __dil.jsx("row", {
				gap: 4,
				align: "center",
				width: "100%",
				padding: { y: wide ? 2 : 1 }
			}, /* @__PURE__ */ __dil.jsx("box", {
				size: 32,
				background: "alpha-10",
				radius: "full",
				align: "center",
				justify: "center"
			}, /* @__PURE__ */ __dil.jsx("icon", {
				name: item.icon ?? "compass",
				size: [
					"basket",
					"wine-and-cloche",
					"gift"
				].includes(item.icon ?? "") ? "md" : "lg"
			})), /* @__PURE__ */ __dil.jsx("col", {
				flex: 1,
				minWidth: 0,
				gap: 1,
				height: 40,
				justify: "center"
			}, /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, item.primary_category), /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx("box", {
				height: 4,
				radius: "full",
				width: "100%",
				background: "alpha-10",
				clip: true
			}, /* @__PURE__ */ __dil.jsx("box", {
				width: \`\${item.filled_pct}%\`,
				height: 4,
				radius: "full",
				background: item.color
			})), /* @__PURE__ */ __dil.jsx("box", { height: 3 }))), /* @__PURE__ */ __dil.jsx("text", {
				textAlign: "end",
				size: "sm",
				color: hidden ? "secondary" : "primary",
				maxLines: 1
			}, hidden ? item.pct_short_label : item.amount));
			return /* @__PURE__ */ __dil.jsx("col", {
				key: item.id,
				gap: 0
			}, index ? /* @__PURE__ */ __dil.jsx("divider", { spacing: 0 }) : null, item.detail_sidebar_enabled ? /* @__PURE__ */ __dil.jsx("pressable", {
				variant: "ghost",
				hoverBackground: "surface-tertiary",
				padding: 0,
				radius: "md",
				ariaLabel: item.detail_sidebar_aria_label,
				onClick: () => GenUI.dispatchAction({
					handler: "client",
					type: "open_entity_detail",
					payload: {
						category: "ledger_detail_sidebar",
						query: \`\${month.month} - \${item.primary_category}\`,
						clientParams: { entitySidebarPresentation: {
							titlePlacement: "content",
							leadingBarBorder: "hidden"
						} },
						extraParams: {
							detail_type: "spend_by_category",
							displayTitle: item.primary_category,
							alwaysShowFollowUpButton: true,
							disableFooterActions: true,
							primary_category: item.primary_category,
							primary_category_key: item.primary_category_key,
							month_label: month.month,
							month_start: month.month_start,
							sensitive_values_hidden: hidden,
							monetary_value_references_enabled: state.monetary_value_references_enabled ?? false,
							total_label: state.monetary_value_references_enabled || !hidden ? item.amount : state.labels.masked_value,
							top_detail_label: item.top_detail_label,
							top_detail_amount: state.monetary_value_references_enabled || !hidden ? item.top_detail_amount : state.labels.masked_value,
							top_detail_share_label: item.top_detail_share_label
						}
					}
				})
			}, row) : row);
		}))), month.has_more_categories ? /* @__PURE__ */ __dil.jsx("button", {
			variant: "soft",
			block: true,
			onClick: () => setShowMore(!showMore)
		}, showMore ? state.labels.show_less : state.labels.show_more) : null) : null));
	}

//#endregion
return LedgerSpendByCategoryWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=ledger-spend-by-category-widget-85962eead5d1.js.map