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
//#region internal/LedgerRecentTransactions.dil.tsx
	function openTransactionDetail(transaction, hidden, maskedValue, related = false) {
		GenUI.dispatchAction({
			handler: "client",
			type: "open_entity_detail",
			payload: {
				category: "ledger_detail_sidebar",
				query: transaction.display_name + " transaction",
				extraParams: {
					detail_type: "transaction",
					displayTitle: transaction.display_name,
					...related ? { disableFollowUpButton: true } : { alwaysShowFollowUpButton: true },
					disableFooterActions: true,
					transaction_id: transaction.transaction_id,
					logo_url: transaction.logo_url ?? "",
					category_icon: transaction.category_icon,
					merchant_name: transaction.merchant_name,
					transaction_date: transaction.date,
					date_label: transaction.date_label,
					amount_label: hidden ? transaction.masked_amount_label : transaction.amount_label,
					amount_value: hidden ? null : transaction.amount_value,
					currency_code: transaction.currency_code,
					account_id: transaction.account_id ?? "",
					account_name: hidden ? maskedValue : transaction.account_detail,
					primary_category: transaction.category_label,
					primary_category_key: transaction.primary_category_key,
					primary_category_id: transaction.primary_category_id,
					category_confidence_level: transaction.category_confidence_level ?? "",
					category_confidence_label: transaction.category_confidence_label ?? "",
					pending: transaction.pending,
					month_start: transaction.month_start,
					sensitive_values_hidden: hidden
				}
			}
		});
	}
	function TransactionLogo({ src, alt, icon, size, iconSize = "lg", rounded = true }) {
		const fallback = /* @__PURE__ */ __dil.jsx("box", {
			size,
			radius: "full",
			background: "alpha-10",
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: icon || "compass",
			size: iconSize,
			color: "primary"
		}));
		return src ? /* @__PURE__ */ __dil.jsx("box", {
			size,
			radius: "full",
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("image", {
			src,
			alt,
			width: size,
			height: size,
			radius: rounded ? "full" : void 0,
			fit: "contain",
			fallback
		})) : fallback;
	}

//#endregion
//#region LedgerLowConfidenceCategoryCorrection.dil.tsx
	function ResolvedCorrection({ state }) {
		const desktop = DIL.useBreakpoint("sm");
		const hidden = state.sensitive_values_hidden === true;
		const [rowsToShow, setRowsToShow] = DIL.useState(3);
		const [categories, setCategories] = DIL.useState(state.transactions.map((transaction) => transaction.draft_primary_category_id));
		const visible = state.transactions.slice(0, rowsToShow);
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			maxWidth: "100%",
			background: "surface-elevated",
			padding: 6,
			radius: "4xl",
			border: 1,
			clip: true
		}, /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			padding: { bottom: 4 }
		}, /* @__PURE__ */ __dil.jsx("title", { size: "md" }, state.title)), /* @__PURE__ */ __dil.jsx("box", {
			height: 16,
			width: "100%",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("box", {
			height: 1,
			width: "100%",
			background: "border-subtle"
		})), /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, state.transactions.length === 0 && /* @__PURE__ */ __dil.jsx("row", {
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
			name: "compass",
			size: "lg",
			color: "secondary"
		})), /* @__PURE__ */ __dil.jsx("caption", {
			size: "md",
			color: "secondary"
		}, state.empty_state_label)), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, visible.map((transaction, index) => {
			const details = /* @__PURE__ */ __dil.jsx("row", {
				gap: 4,
				align: "center",
				width: "100%"
			}, /* @__PURE__ */ __dil.jsx("box", {
				width: desktop ? 32 : 40,
				height: desktop ? 4 : 12
			}, /* @__PURE__ */ __dil.jsx(TransactionLogo, {
				src: transaction.logo_url,
				alt: transaction.logo_alt,
				icon: transaction.category_icon,
				size: desktop ? 32 : 40,
				iconSize: desktop ? "lg" : "xl"
			})), /* @__PURE__ */ __dil.jsx("col", {
				flex: 1,
				minWidth: 0,
				gap: 0
			}, /* @__PURE__ */ __dil.jsx("text", {
				size: desktop ? "sm" : "md",
				weight: "normal",
				maxLines: 1
			}, transaction.display_name)), /* @__PURE__ */ __dil.jsx("col", {
				align: "end",
				justify: "center",
				gap: 0,
				width: "max-content"
			}, /* @__PURE__ */ __dil.jsx("text", {
				size: desktop ? "sm" : "md",
				weight: "normal",
				textAlign: "end",
				maxLines: 1,
				color: hidden ? "primary" : transaction.amount_value > 0 ? "green-500" : "primary"
			}, hidden ? transaction.masked_amount_label : transaction.amount_label)));
			return /* @__PURE__ */ __dil.jsx("col", {
				key: transaction.id,
				gap: 0
			}, /* @__PURE__ */ __dil.jsx("box", { padding: index === visible.length - 1 ? { top: desktop ? .5 : 1 } : { y: desktop ? .5 : 1 } }, /* @__PURE__ */ __dil.jsx("grid", {
				columns: desktop ? "32px 1fr" : "40px 1fr",
				columnGap: 4,
				rowGap: 0
			}, /* @__PURE__ */ __dil.jsx("grid-item", { span: 2 }, transaction.detail_sidebar_enabled ? /* @__PURE__ */ __dil.jsx("pressable", {
				variant: "ghost",
				hoverBackground: "surface-tertiary",
				padding: 0,
				radius: "md",
				border: 0,
				ariaLabel: transaction.detail_sidebar_aria_label,
				onClick: () => openTransactionDetail(transaction, hidden, state.labels.masked_value)
			}, details) : /* @__PURE__ */ __dil.jsx("box", {
				padding: 0,
				radius: "md"
			}, details)), /* @__PURE__ */ __dil.jsx("grid-item", null, /* @__PURE__ */ __dil.jsx("box", {
				height: 0,
				ariaHidden: true
			})), /* @__PURE__ */ __dil.jsx("grid-item", null, /* @__PURE__ */ __dil.jsx("col", {
				minWidth: 0,
				gap: 0
			}, /* @__PURE__ */ __dil.jsx("row", {
				align: "center",
				width: "max-content",
				maxWidth: "100%"
			}, /* @__PURE__ */ __dil.jsx("select", {
				name: "category_review_category",
				options: state.category_options,
				value: categories[index],
				onChange: (value) => setCategories(categories.map((category, categoryIndex) => categoryIndex === index ? value : category)),
				variant: "ghost",
				size: "sm",
				searchable: false,
				align: "start"
			})))))), index < visible.length - 1 && /* @__PURE__ */ __dil.jsx("divider", null));
		})), state.transactions.length > 0 && /* @__PURE__ */ __dil.jsx("box", { padding: { top: 3.5 } }, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 3,
			width: "100%"
		}, state.transactions.length > 3 && /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("button", {
			variant: "soft",
			block: true,
			onClick: () => setRowsToShow(rowsToShow === 3 ? 999 : 3)
		}, rowsToShow === 3 ? state.labels.show_more : state.labels.show_less)), /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("button", {
			variant: "solid",
			block: true,
			onClick: () => GenUI.dispatchAction({
				handler: "server",
				type: "ledger_category_review_save",
				payload: { corrections: state.transactions.map((transaction, index) => ({
					transaction_id: transaction.id,
					target_primary_category: categories[index]
				})) }
			})
		}, state.labels.save)))))));
	}
	function LedgerLowConfidenceCategoryCorrection(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("LedgerLowConfidenceCategoryCorrection", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 320
		});
		if (state.has_connected_accounts === false) return /* @__PURE__ */ __dil.jsx(LedgerNoAccounts, { labels: state.labels });
		return /* @__PURE__ */ __dil.jsx(ResolvedCorrection, { state });
	}

//#endregion
return LedgerLowConfidenceCategoryCorrection;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=ledger-low-confidence-category-correction-e74b7e666ba2.js.map