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
//#region LedgerCreditScoreDetail.dil.tsx
	function LedgerCreditScoreDetail(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("LedgerCreditScoreDetail", props);
		const wide = DIL.useBreakpoint("sm");
		const mobile = DIL.useIsMobile();
		const titleInHeader = DIL.useAppData((data) => data.opGenui?.entityTitleInHeader === true);
		const sensitiveValuesHidden = DIL.useAppData((data) => data.opGenui?.sensitiveValuesHidden);
		const ratingInHeader = DIL.useAppData((data) => data.opGenui?.entityRatingInHeader === true);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 300
		});
		const hidden = titleInHeader && sensitiveValuesHidden != null ? sensitiveValuesHidden : state.sensitive_values_hidden === true || sensitiveValuesHidden === true;
		const mask = state.labels.masked_value;
		const creditorLogos = state.creditor_logos ?? {};
		const horizontalPadding = mobile ? 4 : 6;
		const dividerSpacing = mobile ? -2 : 0;
		const percentageSummary = state.summary_label != null && (state.summary_label.includes("%") || state.summary_label.includes("٪") || state.summary_label.includes("％"));
		const rows = state.summary_label && state.rows.every((row) => row.key === "impact" || row.key === "credit_limit" || percentageSummary && (row.key === "total_balance" || row.key === "available_credit")) ? [{
			key: "summary",
			label: state.title,
			value_label: state.summary_label
		}, ...state.rows] : state.rows;
		return /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			maxWidth: "100%",
			gap: 6,
			padding: { bottom: 6 }
		}, state.title_in_chrome === true && !titleInHeader && state.entity_title_in_header !== true && /* @__PURE__ */ __dil.jsx("box", { padding: { x: horizontalPadding } }, /* @__PURE__ */ __dil.jsx("title", { size: "lg" }, state.title)), state.status === "loading" && /* @__PURE__ */ __dil.jsx("box", {
			padding: { x: horizontalPadding },
			role: "status"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.labels.loading)), state.status === "empty" && /* @__PURE__ */ __dil.jsx("box", { padding: { x: horizontalPadding } }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.labels.no_details)), state.status === "ready" && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, state.rating_label != null && !hidden && !ratingInHeader && state.entity_rating_in_header !== true && state.entity_summary_in_header !== true && /* @__PURE__ */ __dil.jsx("box", { padding: { x: horizontalPadding } }, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			color: state.rating_color === "green-400" ? "success" : state.rating_color === "yellow-400" ? {
				light: "yellow-700",
				dark: "yellow-500"
			} : state.rating_color === "red-500" ? {
				light: "danger",
				dark: "red-300"
			} : state.rating_color === "gray-400" ? "secondary" : "primary"
		}, state.rating_label)), rows.length > 0 && /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			padding: {
				x: horizontalPadding,
				top: !mobile && (titleInHeader || state.entity_title_in_header === true) && (ratingInHeader || state.entity_rating_in_header === true || state.entity_summary_in_header === true) ? 6 : 0
			}
		}, rows.map((item, index) => /* @__PURE__ */ __dil.jsx("col", {
			key: item.key,
			gap: 2,
			padding: { bottom: item.progress_percent != null ? 4.5 : 0 },
			border: index > 0 ? { top: {
				size: 1,
				color: "alpha-10"
			} } : void 0
		}, /* @__PURE__ */ __dil.jsx("row", {
			width: "100%",
			minHeight: item.progress_percent != null ? 0 : 44,
			padding: item.progress_percent != null ? {
				top: 2,
				bottom: 0
			} : { y: mobile ? 3 : 2 },
			gap: 4,
			align: "center"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: mobile ? "sm" : "md",
			weight: "normal",
			color: "secondary"
		}, item.label), /* @__PURE__ */ __dil.jsx("spacer", null), /* @__PURE__ */ __dil.jsx("text", {
			size: mobile ? "sm" : "md",
			weight: "semibold",
			textAlign: "end",
			tabularNums: true
		}, hidden ? mask : item.value_label)), item.progress_percent != null && /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			height: 5,
			radius: "full",
			background: "alpha-10"
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: hidden ? "100%" : \`\${item.progress_percent}%\`,
			height: 5,
			radius: "full",
			background: hidden ? "gray-300" : state.rating_color ?? "gray-400"
		}))))), state.score_factors.length > 0 && /* @__PURE__ */ __dil.jsx("col", {
			gap: mobile ? 5 : 2,
			padding: { x: horizontalPadding }
		}, /* @__PURE__ */ __dil.jsx("title", {
			size: mobile ? "lg" : "md",
			weight: mobile ? "semibold" : "medium"
		}, state.labels.takeaways), /* @__PURE__ */ __dil.jsx("col", { gap: 2 }, state.score_factors.map((item, index) => /* @__PURE__ */ __dil.jsx("box", { key: index }, /* @__PURE__ */ __dil.jsx("text", { size: "md" }, hidden ? mask : item.description))))), state.related_items.length > 0 && /* @__PURE__ */ __dil.jsx("col", {
			gap: 6,
			padding: { x: horizontalPadding }
		}, state.score_factors.length > 0 && /* @__PURE__ */ __dil.jsx("divider", { spacing: dividerSpacing }), /* @__PURE__ */ __dil.jsx("col", { gap: 4 }, /* @__PURE__ */ __dil.jsx("title", {
			size: mobile ? "lg" : "md",
			weight: "medium"
		}, state.related_items_title), /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, state.related_items.map((item, index) => /* @__PURE__ */ __dil.jsx("col", {
			key: item.key,
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("row", {
			width: "100%",
			gap: 4,
			padding: { y: wide ? 2 : 2.5 },
			align: "center",
			role: item.value_accessibility_label != null ? "group" : void 0,
			ariaLabel: item.value_accessibility_label != null ? hidden ? mask : item.value_accessibility_label : void 0
		}, /* @__PURE__ */ __dil.jsx("box", {
			size: wide ? 32 : 40,
			radius: "full",
			background: "alpha-10",
			align: "center",
			justify: "center"
		}, !hidden && item.logo_key && creditorLogos[item.logo_key] ? /* @__PURE__ */ __dil.jsx("image", {
			src: creditorLogos[item.logo_key],
			width: wide ? 32 : 40,
			height: wide ? 32 : 40,
			fit: "contain",
			radius: "full",
			alt: "",
			fallback: /* @__PURE__ */ __dil.jsx("box", {
				size: wide ? 32 : 40,
				align: "center",
				justify: "center"
			}, /* @__PURE__ */ __dil.jsx("icon", {
				name: item.icon,
				size: wide ? "lg" : "xl",
				color: "primary"
			}))
		}) : /* @__PURE__ */ __dil.jsx("icon", {
			name: item.icon,
			size: wide ? "lg" : "xl",
			color: "primary"
		})), /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0,
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: wide ? "sm" : "md",
			weight: "normal",
			maxLines: 1
		}, hidden ? mask : item.label), item.detail_label != null && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary",
			maxLines: 1,
			truncate: true
		}, hidden ? mask : item.detail_label)), item.value_label != null && /* @__PURE__ */ __dil.jsx("text", {
			size: wide ? "sm" : "md",
			weight: "normal",
			textAlign: "end",
			maxLines: 1,
			tabularNums: true
		}, hidden ? mask : item.value_label)), index < state.related_items.length - 1 && /* @__PURE__ */ __dil.jsx("divider", { spacing: dividerSpacing }))))))), state.related_items_note != null && /* @__PURE__ */ __dil.jsx("box", { padding: { x: horizontalPadding } }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.related_items_note))));
	}

//#endregion
return LedgerCreditScoreDetail;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=ledger-credit-score-detail-8e8c6fa4b213.js.map