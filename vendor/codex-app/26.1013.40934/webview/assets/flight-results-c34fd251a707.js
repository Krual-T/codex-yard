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
//#region FlightResults.dil.tsx
	function FlightResults(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("FlightResults", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 200
		});
		return /* @__PURE__ */ __dil.jsx(Results, { state });
	}
	function Results({ state }) {
		const [selection, select] = DIL.useState(null);
		const [sort, setSort] = DIL.useState("recommended");
		const [expanded, expand] = DIL.useState(false);
		const labels = state.labels;
		const selected = selection?.responseId === state.response_id ? state.items.find((item) => item.candidate_id === selection.candidateId) : void 0;
		const items = [...state.items];
		if (sort === "price" && state.comparable_prices) items.sort((a, b) => a.price_rank - b.price_rank);
		if (sort === "duration" && state.comparable_durations) items.sort((a, b) => a.duration_rank - b.duration_rank);
		if (selected) return /* @__PURE__ */ __dil.jsx(TripReview, {
			item: selected,
			labels,
			onBack: () => select(null)
		});
		return /* @__PURE__ */ __dil.jsx("col", {
			gap: 4,
			width: "100%",
			disableAutoSpacing: true
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "lg",
			weight: "semibold"
		}, labels.heading), state.items[0] && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.items[0].dates + " · " + state.items[0].summary), /* @__PURE__ */ __dil.jsx("row", {
			gap: 1,
			wrap: "wrap"
		}, [
			"recommended",
			...state.comparable_prices ? ["price"] : [],
			...state.comparable_durations ? ["duration"] : []
		].map((key) => /* @__PURE__ */ __dil.jsx("pressable", {
			key,
			radius: "full",
			padding: {
				x: 3,
				y: 1.5
			},
			background: sort === key ? "surface-tertiary" : "transparent",
			ariaPressed: sort === key,
			onClick: () => setSort(key)
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: sort === key ? "primary" : "secondary"
		}, labels[key])))), /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			disableAutoSpacing: true
		}, items.slice(0, expanded ? items.length : 3).map((item) => /* @__PURE__ */ __dil.jsx("pressable", {
			key: item.candidate_id,
			ariaLabel: labels.review + ": " + item.airline + ", " + item.times + ", " + item.price,
			background: "surface",
			border: {
				size: 1,
				color: "subtle"
			},
			radius: 24,
			padding: 5,
			width: "100%",
			onClick: () => select({
				candidateId: item.candidate_id,
				responseId: state.response_id
			})
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			width: "100%",
			disableAutoSpacing: true
		}, !!item.badges?.length && /* @__PURE__ */ __dil.jsx("row", {
			gap: 2,
			wrap: "wrap"
		}, item.badges.map((badge) => /* @__PURE__ */ __dil.jsx("box", {
			key: badge,
			background: {
				light: "#e8f3fe",
				dark: "#132e4b"
			},
			padding: {
				x: 2,
				y: 1
			},
			radius: 6
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			weight: "medium",
			color: {
				light: "#3a83f7",
				dark: "#8abbff"
			}
		}, badge)))), /* @__PURE__ */ __dil.jsx("col", {
			gap: 1.5,
			disableAutoSpacing: true
		}, /* @__PURE__ */ __dil.jsx("row", {
			gap: 3,
			align: "baseline",
			justify: "between"
		}, /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "lg",
			weight: "medium"
		}, item.times)), /* @__PURE__ */ __dil.jsx("text", {
			size: "xl",
			weight: "semibold",
			textAlign: "end"
		}, item.price)), /* @__PURE__ */ __dil.jsx("row", {
			gap: 2,
			align: "start",
			justify: "between"
		}, /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", { size: "xs" }, item.route, /* @__PURE__ */ __dil.jsx("text", { color: "secondary" }, item.duration ? " · " + item.duration : !item.stops && item.trip_detail ? " · " + item.trip_detail : ""))), /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary",
			textAlign: "end"
		}, item.price_caption)), /* @__PURE__ */ __dil.jsx("row", {
			gap: 2,
			align: "start",
			justify: "between"
		}, /* @__PURE__ */ __dil.jsx("row", {
			flex: 1,
			minWidth: 0,
			gap: 2,
			align: "center"
		}, item.logo_url && /* @__PURE__ */ __dil.jsx("image", {
			src: item.logo_url,
			alt: "",
			width: 16,
			height: 16,
			fit: "contain",
			hideOnFailure: true
		}), /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, item.airline))), /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary",
			textAlign: "end"
		}, item.stops))))))), items.length > 3 && /* @__PURE__ */ __dil.jsx("pressable", {
			height: 44,
			align: "center",
			justify: "center",
			border: {
				size: 1,
				color: "subtle"
			},
			radius: "full",
			width: "100%",
			onClick: () => expand(!expanded)
		}, /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, expanded ? labels.less : labels.more)), /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, labels.disclaimer));
	}
	function TripReview({ item, labels, onBack }) {
		const [details, showDetails] = DIL.useState(false);
		const capabilities = DIL.useAppData((data) => data.opGenui);
		const now = DIL.useNow();
		const expired = !(Date.parse(item.expires_at) > now);
		const supported = capabilities?.isShared !== true && capabilities?.supportedClientActions?.includes("issue_new_turn") === true;
		const enabled = supported && !expired && item.booking_urls.length > 0;
		const submit = () => {
			if (!enabled || !(Date.parse(item.expires_at) > Date.now())) return;
			GenUI.issueNewTurn(labels.select_request + "\\n" + item.selection);
		};
		return /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			width: "100%",
			disableAutoSpacing: true
		}, /* @__PURE__ */ __dil.jsx("box", {
			background: "surface",
			border: {
				size: .5,
				color: "default"
			},
			radius: 24,
			width: "100%",
			padding: { bottom: 4 }
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			disableAutoSpacing: true
		}, /* @__PURE__ */ __dil.jsx("row", {
			height: 54,
			padding: {
				left: 4,
				right: 1
			},
			gap: 2,
			align: "center",
			justify: "between"
		}, /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, item.seller || item.booking_sites.join(" · "))), /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: labels.details,
			ariaPressed: details,
			tooltip: labels.details,
			width: 44,
			height: 44,
			align: "center",
			justify: "center",
			radius: "full",
			onClick: () => showDetails(!details)
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "info",
			size: "md"
		}))), /* @__PURE__ */ __dil.jsx("col", {
			gap: 4,
			padding: {
				x: 4,
				top: 1,
				bottom: 6
			},
			disableAutoSpacing: true
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "lg",
			weight: "semibold"
		}, labels.review_heading ?? labels.review), /* @__PURE__ */ __dil.jsx("col", {
			gap: 2,
			disableAutoSpacing: true
		}, item.legs.map((leg, index) => /* @__PURE__ */ __dil.jsx("col", {
			key: index,
			gap: 2,
			disableAutoSpacing: true
		}, index > 0 && /* @__PURE__ */ __dil.jsx("divider", {
			spacing: 2,
			color: "subtle"
		}), /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			disableAutoSpacing: true
		}, leg.segments.map((segment, segmentIndex) => /* @__PURE__ */ __dil.jsx("row", {
			key: segmentIndex,
			gap: 4,
			align: "start",
			padding: { y: 3 }
		}, /* @__PURE__ */ __dil.jsx("box", {
			size: 48,
			minSize: 48,
			radius: "full",
			border: {
				size: .5,
				color: "subtle"
			},
			align: "center",
			justify: "center",
			ariaHidden: true
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "plane-horizontal",
			size: "lg"
		})), /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0,
			gap: 1,
			disableAutoSpacing: true
		}, /* @__PURE__ */ __dil.jsx("text", { size: "lg" }, segment.route), /* @__PURE__ */ __dil.jsx("col", {
			gap: 2,
			disableAutoSpacing: true
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, segment.dates), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, segment.times), /* @__PURE__ */ __dil.jsx("row", {
			gap: 2,
			align: "center"
		}, segment.logo_url && /* @__PURE__ */ __dil.jsx("image", {
			src: segment.logo_url,
			alt: "",
			width: 16,
			height: 16,
			fit: "contain",
			hideOnFailure: true
		}), /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, segment.airline))), details && segment.flight_number && /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, segment.flight_number), details && segment.airports && /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, segment.airports))))))))), /* @__PURE__ */ __dil.jsx("row", {
			gap: 2,
			justify: "between",
			align: "center"
		}, /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, item.summary)), /* @__PURE__ */ __dil.jsx("text", {
			size: "lg",
			weight: "semibold"
		}, item.price)), item.booking_urls.length > 1 && /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, labels.split), item.fare_notice && /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, item.fare_notice), details && item.detail_labels && /* @__PURE__ */ __dil.jsx("col", {
			gap: 2,
			disableAutoSpacing: true
		}, item.detail_labels.map((label, index) => /* @__PURE__ */ __dil.jsx("text", {
			key: index,
			size: "sm",
			color: "secondary"
		}, label))), (!supported || expired || !item.booking_urls.length) && /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, !supported ? labels.unavailable : expired ? labels.expired : labels.no_link)), /* @__PURE__ */ __dil.jsx("row", {
			gap: 2.5,
			padding: { x: 4 }
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			flex: 1,
			minWidth: 0,
			height: 48,
			border: {
				size: 1,
				color: "default"
			},
			radius: "full",
			align: "center",
			justify: "center",
			onClick: onBack
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			weight: "medium"
		}, labels.cancel)), /* @__PURE__ */ __dil.jsx("pressable", {
			flex: 1,
			minWidth: 0,
			height: 48,
			background: enabled ? {
				light: "#0d0d0d",
				dark: "#f5f5f5"
			} : "surface-tertiary",
			radius: "full",
			align: "center",
			justify: "center",
			disabled: !enabled,
			onClick: submit
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			weight: "medium",
			color: enabled ? {
				light: "#ffffff",
				dark: "#0d0d0d"
			} : "tertiary"
		}, labels.continue))))), /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, labels.disclaimer));
	}

//#endregion
return FlightResults;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=flight-results-c34fd251a707.js.map