import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


//#region internal/LinkImpression.dil.tsx
/** Observe the rendered link without invoking its click action. */
	function LinkImpression({ url, action, careProvider, disabled, unlessSupportedAction, children, ...boxProps }) {
		const opGenui = DIL.useAppData((data) => data.opGenui);
		const shownUrls = DIL.useRef([]);
		const payload = action?.payload;
		const actionUrl = action?.type === "open_url" && (action.handler === void 0 || action.handler === "client") && !(typeof payload === "object" && payload !== null && "action" in payload && typeof payload.action === "string" && payload.action !== "open_url") && typeof payload === "object" && payload !== null && "url" in payload && typeof payload.url === "string" ? payload.url : void 0;
		const destination = action ? actionUrl : url;
		if (disabled || unlessSupportedAction && opGenui?.supportedClientActions?.includes(unlessSupportedAction) || typeof destination !== "string" || !destination.trim() || !opGenui?.supportedClientActions?.includes("genui_link_impressions")) return /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, children);
		const linkType = opGenui.linkMetadataByUrl?.[destination.trim()]?.linkType;
		if (linkType !== void 0 && typeof linkType !== "string") return /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, children);
		return /* @__PURE__ */ __dil.jsx("box", {
			...boxProps,
			onVisibleKey: destination,
			onVisible: () => {
				if (shownUrls.current.includes(destination)) return;
				const careOrigin = careProvider ? /^(https?):\\/\\/(?:[^\\\\/?#]*@)?([^\\\\/?#]+)/i.exec(destination.trim()) : null;
				if (careProvider && !careOrigin) return;
				const telemetryUrl = careOrigin ? \`\${careOrigin[1]}://\${careOrigin[2]}\` : destination;
				shownUrls.current = [...shownUrls.current, destination];
				GenUI.dispatchAction({
					handler: "client",
					type: "log_event",
					payload: {
						event_name: "genui_link_shown",
						event_data: {
							url: telemetryUrl,
							is_care_provider_link: careProvider,
							link_type: linkType?.toLowerCase() ?? "general_external"
						}
					}
				});
			}
		}, children);
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
//#region RestaurantReviews.dil.tsx
	function RestaurantReviews(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("RestaurantReviews", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 180
		});
		return /* @__PURE__ */ __dil.jsx(ResolvedReviews, { state });
	}
	function ResolvedReviews({ state }) {
		const [localQuery, setQuery] = DIL.useState();
		const [localSort, setSort] = DIL.useState();
		const [localLimit, setLimit] = DIL.useState();
		const [localExpanded, setExpanded] = DIL.useState();
		const query = localQuery ?? state.query;
		const sort = localSort ?? state.sort;
		const limit = localLimit ?? state.limit;
		const expanded = localExpanded ?? state.expanded;
		const { reviews, labels } = state;
		const matching = state.loading ? [] : (reviews.orders[sort] ?? []).filter((index) => reviews.cards[index].search.includes(query));
		return /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			gap: 4,
			padding: 3,
			radius: "lg",
			border: {
				size: 1,
				color: "default"
			},
			background: "surface-secondary"
		}, /* @__PURE__ */ __dil.jsx("row", null, /* @__PURE__ */ __dil.jsx("badge", {
			color: "warning",
			variant: "outline",
			size: "sm"
		}, labels.prototype)), state.loading ? /* @__PURE__ */ __dil.jsx("col", { gap: 4 }, /* @__PURE__ */ __dil.jsx("col", {
			height: 28,
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "35%",
			height: 20,
			radius: "full"
		})), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, [3, 4].map((lineCount) => /* @__PURE__ */ __dil.jsx("col", {
			key: lineCount,
			gap: 2,
			padding: { y: 1 }
		}, Array.from({ length: lineCount }, (_, index) => /* @__PURE__ */ __dil.jsx("loading-block", {
			key: index,
			width: "100%",
			height: 18,
			radius: "full"
		})))))) : /* @__PURE__ */ __dil.jsx("col", { gap: 4 }, /* @__PURE__ */ __dil.jsx("row", {
			gap: 2,
			align: "center"
		}, reviews.rating !== "" && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("icon", {
			name: "star-filled",
			size: "md"
		}), /* @__PURE__ */ __dil.jsx("text", {
			size: "lg",
			weight: "semibold"
		}, reviews.rating), /* @__PURE__ */ __dil.jsx("text", { color: "secondary" }, "·")), /* @__PURE__ */ __dil.jsx("text", { color: "secondary" }, reviews.count)), reviews.summary !== "" && /* @__PURE__ */ __dil.jsx("col", { gap: 2 }, /* @__PURE__ */ __dil.jsx("text", null, reviews.summary), /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, reviews.summary_sources)), reviews.dishes.length > 0 && /* @__PURE__ */ __dil.jsx("col", { gap: 2 }, /* @__PURE__ */ __dil.jsx("text", {
			weight: "semibold",
			size: "sm"
		}, labels.dishes), /* @__PURE__ */ __dil.jsx("row", {
			gap: 2,
			wrap: "wrap"
		}, reviews.dishes.map((dish, index) => /* @__PURE__ */ __dil.jsx("box", {
			key: index,
			padding: {
				x: 3,
				y: 1.5
			},
			radius: "full",
			border: {
				size: 1,
				color: "subtle"
			}
		}, /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, dish))))), /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, reviews.snapshot_label), limit > 3 && /* @__PURE__ */ __dil.jsx("row", {
			gap: 2,
			wrap: "wrap"
		}, /* @__PURE__ */ __dil.jsx("input", {
			name: "review-search",
			"aria-label": labels.search,
			placeholder: labels.search,
			value: query,
			onChange: (value) => {
				setQuery(value);
				setLimit(60);
			}
		}), /* @__PURE__ */ __dil.jsx("select", {
			name: "review-sort",
			size: "sm",
			ariaLabel: labels.sort,
			value: sort,
			options: [
				"recommended",
				"recent",
				"highest",
				"lowest"
			].map((value) => ({
				value,
				label: labels[value]
			})),
			onChange: setSort
		})), matching.length === 0 && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, labels.empty), /* @__PURE__ */ __dil.jsx("col", { gap: 2 }, matching.slice(0, limit).map((index) => {
			const review = reviews.cards[index];
			const key = String(index);
			const isExpanded = expanded.includes(key);
			return /* @__PURE__ */ __dil.jsx("col", {
				key,
				gap: 3,
				padding: 3,
				border: { bottom: {
					size: 1,
					color: "subtle"
				} },
				role: "article"
			}, /* @__PURE__ */ __dil.jsx("row", {
				gap: 2,
				align: "center"
			}, review.avatar !== "" && /* @__PURE__ */ __dil.jsx("image", {
				src: review.avatar,
				alt: "",
				width: 32,
				height: 32,
				radius: "full",
				fit: "cover",
				hideOnFailure: true
			}), /* @__PURE__ */ __dil.jsx("col", {
				gap: 1,
				flex: 1,
				minWidth: 0
			}, /* @__PURE__ */ __dil.jsx("row", { gap: 1.5 }, review.author !== "" && /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				weight: "medium",
				maxLines: 1
			}, review.author), review.source === "ChatGPT" ? /* @__PURE__ */ __dil.jsx("icon", {
				name: "openai-logo-regular",
				size: "sm"
			}) : /* @__PURE__ */ __dil.jsx("text", {
				size: "xs",
				color: "secondary"
			}, review.source)), /* @__PURE__ */ __dil.jsx("row", {
				gap: 1,
				wrap: "wrap"
			}, review.rating !== "" && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("icon", {
				name: "star-filled",
				size: "xs"
			}), /* @__PURE__ */ __dil.jsx("text", {
				size: "xs",
				weight: "medium"
			}, review.rating)), /* @__PURE__ */ __dil.jsx("text", {
				size: "xs",
				color: "secondary"
			}, review.date))), review.url !== "" && /* @__PURE__ */ __dil.jsx(LinkImpression, {
				url: review.url,
				inline: true
			}, /* @__PURE__ */ __dil.jsx("button", {
				label: labels.source,
				variant: "ghost",
				size: "sm",
				onClick: () => GenUI.openUrl(review.url)
			}, /* @__PURE__ */ __dil.jsx("icon", { name: "arrow-up-right" })))), /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, isExpanded ? review.text : review.preview), review.preview !== review.text && /* @__PURE__ */ __dil.jsx("row", null, /* @__PURE__ */ __dil.jsx("button", {
				"aria-expanded": isExpanded,
				variant: "ghost",
				size: "sm",
				onClick: () => setExpanded(isExpanded ? expanded.filter((item) => item !== key) : [...expanded, key])
			}, isExpanded ? labels.collapse : labels.expand)), review.attribution !== "" && /* @__PURE__ */ __dil.jsx("text", {
				size: "xs",
				color: "secondary"
			}, review.attribution));
		})), matching.length > limit && /* @__PURE__ */ __dil.jsx("row", null, /* @__PURE__ */ __dil.jsx("button", {
			variant: "ghost",
			size: "sm",
			onClick: () => setLimit(limit + 6)
		}, labels.more, /* @__PURE__ */ __dil.jsx("icon", { name: "chevron-down" })))));
	}

//#endregion
return RestaurantReviews;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=restaurant-reviews-dba43cd07e40.js.map