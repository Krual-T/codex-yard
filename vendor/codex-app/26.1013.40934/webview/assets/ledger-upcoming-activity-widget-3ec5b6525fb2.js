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
	function LedgerAvatar({ item, size = 32 }) {
		const fallback = /* @__PURE__ */ __dil.jsx("box", {
			size,
			radius: "full",
			background: "alpha-10",
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: item.icon ?? "compass",
			size: size > 32 ? "xl" : "lg"
		}));
		return item.logo_url ? /* @__PURE__ */ __dil.jsx("box", {
			size,
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("image", {
			src: item.logo_url,
			width: size,
			height: size,
			fit: "contain",
			fallback
		})) : fallback;
	}
	function LedgerEmpty({ label, icon = "calendar" }) {
		return /* @__PURE__ */ __dil.jsx("row", {
			gap: 3,
			align: "center",
			padding: { y: 6 }
		}, /* @__PURE__ */ __dil.jsx("box", {
			size: 36,
			radius: "full",
			background: "alpha-10",
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: icon,
			size: "lg",
			color: "secondary"
		})), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, label));
	}
	function LedgerActivityRow({ item, state, mode, activeView, title }) {
		const wide = DIL.useBreakpoint("sm");
		const hidden = state.sensitive_values_hidden ?? false;
		const amountIsUnknown = mode === "upcoming" && item.amount_is_unknown === true;
		const metadata = mode === "recurring" ? item.frequency : item.next_payment;
		const body = /* @__PURE__ */ __dil.jsx("row", {
			gap: 4,
			align: "center",
			width: "100%",
			padding: { y: wide ? 2 : 2.5 }
		}, /* @__PURE__ */ __dil.jsx(LedgerAvatar, {
			item,
			size: wide ? 32 : 40
		}), /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0,
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			maxLines: 1,
			size: wide ? "sm" : "md"
		}, item.name ?? ""), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1,
			minWidth: 0,
			width: "100%",
			wrap: "nowrap"
		}, metadata ? /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary",
			maxLines: 1,
			truncate: true
		}, metadata) : null, metadata && item.account_detail ? /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.labels.separator_dot) : null, item.account_detail ? /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary",
			maxLines: 1,
			truncate: true
		}, item.account_detail)) : null)), /* @__PURE__ */ __dil.jsx("text", {
			textAlign: "end",
			size: wide ? "sm" : "md",
			maxLines: 1
		}, hidden && !amountIsUnknown && item.amount != null ? state.labels.masked_value : item.amount ?? ""));
		if (!item.detail_sidebar_enabled) return body;
		return /* @__PURE__ */ __dil.jsx("pressable", {
			variant: "ghost",
			hoverBackground: "surface-tertiary",
			padding: 0,
			radius: "md",
			ariaLabel: \`View details for \${item.name ?? title}\`,
			onClick: () => {
				const name = item.name ?? title;
				GenUI.dispatchAction({
					handler: "client",
					type: "open_entity_detail",
					payload: {
						category: "ledger_detail_sidebar",
						query: \`\${name} \${mode === "recurring" ? "recurring" : "upcoming"} activity\`,
						...mode === "upcoming" ? { clientParams: { entitySidebarPresentation: {
							titlePlacement: "content",
							leadingBarBorder: "hidden"
						} } } : {},
						extraParams: {
							detail_type: mode === "recurring" ? "recurring_transaction" : "upcoming_activity",
							displayTitle: name,
							activity_name: name,
							disableFollowUpButton: true,
							disableFooterActions: true,
							flow_scope: mode === "recurring" ? item.flow_type === "inflow" ? "incoming" : "outgoing" : activeView,
							recurring_transaction_id: item.id,
							next_payment: item.next_payment ?? "",
							predicted_next_date: item.predicted_next_date ?? "",
							monetary_value_references_enabled: state.monetary_value_references_enabled ?? false,
							amount_is_unknown: amountIsUnknown,
							amount_label: amountIsUnknown || state.monetary_value_references_enabled || !hidden ? mode === "recurring" ? item.occurrence_amount ?? item.amount ?? "" : item.amount ?? "" : state.labels.masked_value,
							account_name: item.account_detail_expanded || item.account_detail || "",
							frequency: item.frequency ?? "",
							transaction_ids: item.transaction_ids ?? [],
							sensitive_values_hidden: hidden
						}
					}
				});
			}
		}, body);
	}

//#endregion
//#region LedgerUpcomingActivityWidget.dil.tsx
	function LedgerUpcomingActivityWidget(props) {
		const result = useResolvedComponentResult("LedgerUpcomingActivityWidget", props);
		if (!result.state) return result.resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 300
		});
		if (result.state.has_connected_accounts === false) return /* @__PURE__ */ __dil.jsx(LedgerNoAccounts, { labels: result.state.labels });
		return /* @__PURE__ */ __dil.jsx(Resolved, { state: result.state });
	}
	function Resolved({ state }) {
		const wide = DIL.useBreakpoint("sm");
		const [view, setView] = DIL.useState(state.active_view);
		const [expanded, setExpanded] = DIL.useState(state.expanded ?? false);
		const top = view === state.active_view ? state.top : view === "incoming" ? state.incoming_top : state.outgoing_top;
		const initialOthers = view === state.active_view ? state.others : view === "incoming" ? state.incoming_others : state.outgoing_others;
		const expandedOthers = (view === "incoming" ? state.incoming_expanded_others : state.outgoing_expanded_others) ?? [];
		const canExpand = expandedOthers.length > initialOthers.length;
		const others = expanded && canExpand ? expandedOthers : initialOthers;
		const items = top ? [top, ...others] : others;
		return /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			background: "surface-elevated",
			padding: 0
		}, /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx("col", {
			gap: 2,
			padding: {
				x: 6,
				top: 5,
				bottom: 3
			}
		}, /* @__PURE__ */ __dil.jsx("title", { size: "md" }, state.title), state.show_flow_tabs ? /* @__PURE__ */ __dil.jsx("segmented-control", {
			options: [{
				value: "outgoing",
				label: state.labels.outgoing
			}, {
				value: "incoming",
				label: state.labels.incoming
			}],
			value: view,
			onChange: (value) => {
				setView(value);
				setExpanded(false);
			},
			block: !wide,
			variant: "soft",
			size: "md",
			pill: true
		}) : /* @__PURE__ */ __dil.jsx("box", {
			height: 24,
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: "secondary"
		}, view === "incoming" ? state.labels.incoming : state.labels.outgoing))), /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			padding: {
				x: 6,
				bottom: 5
			}
		}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, items.length === 0 ? /* @__PURE__ */ __dil.jsx(LedgerEmpty, { label: state.labels.no_upcoming_activity }) : items.map((item, index) => /* @__PURE__ */ __dil.jsx("col", {
			key: item.id,
			gap: 0
		}, /* @__PURE__ */ __dil.jsx(LedgerActivityRow, {
			item,
			state,
			mode: "upcoming",
			activeView: view,
			title: state.title
		}), index < items.length - 1 ? /* @__PURE__ */ __dil.jsx("divider", null) : null))), canExpand ? /* @__PURE__ */ __dil.jsx("box", { padding: { top: 5 } }, /* @__PURE__ */ __dil.jsx("button", {
			variant: "soft",
			block: true,
			onClick: () => setExpanded(!expanded)
		}, expanded ? state.labels.show_less : state.labels.show_more)) : null)));
	}

//#endregion
return LedgerUpcomingActivityWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=ledger-upcoming-activity-widget-3ec5b6525fb2.js.map