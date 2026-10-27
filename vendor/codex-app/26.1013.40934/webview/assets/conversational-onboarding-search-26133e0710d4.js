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
	function useIsLiveActivity() {
		return DIL.useAppData((appData) => appData.opGenui?.surface === "live-activity");
	}
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
//#region Cite.dil.tsx
	function openCitationUrl(url, linkAffordance) {
		GenUI.dispatchAction({
			handler: "client",
			type: "open_url",
			payload: {
				url,
				link_type: "search_citation",
				link_affordance: linkAffordance
			}
		});
	}
	function clampedIndex(index, itemCount) {
		if (typeof index === "number" && Number.isInteger(index) && index >= 0 && index < itemCount) return index;
		return 0;
	}
	function ResolvedCite({ activeIndex: serverActiveIndex, items }) {
		const canLogImpressions = DIL.useAppData((data) => data.opGenui?.supportedClientActions)?.includes("genui_link_impressions") === true;
		const shownUrls = DIL.useRef([]);
		const recordShown = (url$1, linkAffordance) => {
			if (!canLogImpressions || !url$1 || shownUrls.current.includes(url$1)) return;
			shownUrls.current = [...shownUrls.current, url$1];
			GenUI.dispatchAction({
				handler: "client",
				type: "log_event",
				payload: {
					event_name: "genui_link_shown",
					event_data: {
						url: url$1,
						link_type: "search_citation",
						link_affordance: linkAffordance
					}
				}
			});
		};
		const initialActiveIndex = clampedIndex(serverActiveIndex, items.length);
		const [activeIndex, setActiveIndex] = DIL.useState(initialActiveIndex);
		const [badgeHovered, setBadgeHovered] = DIL.useState(false);
		const isSm = DIL.useBreakpoint("sm");
		const isMobile = DIL.useIsMobile();
		DIL.useEffect(() => {
			setActiveIndex(initialActiveIndex);
		}, [serverActiveIndex, items.length]);
		const activeItem = items[clampedIndex(activeIndex, items.length)];
		const url = activeItem.url ?? "";
		const hasUrl = url !== "";
		const hasDetails = [
			activeItem.title,
			activeItem.metadata_label,
			activeItem.snippet,
			activeItem.thumbnail_url
		].some(Boolean);
		const showPopover = items.length > 1 || (!isMobile || !hasUrl) && hasDetails;
		const isInteractive = showPopover || hasUrl;
		const sourceLabel = activeItem.source_label ?? activeItem.title ?? "Source";
		const badgeContent = /* @__PURE__ */ __dil.jsx("badge", {
			color: isInteractive && badgeHovered ? {
				light: "#e8e8e8",
				dark: "gray-300"
			} : {
				light: "gray-75",
				dark: "gray-400"
			},
			maxWidth: 100,
			onHover: isInteractive ? setBadgeHovered : void 0,
			padding: {
				left: 1,
				right: 1.5,
				y: 1
			},
			size: "sm",
			variant: "soft",
			weight: "normal"
		}, hasUrl ? /* @__PURE__ */ __dil.jsx("row", { flex: "none" }, /* @__PURE__ */ __dil.jsx("favicon", {
			size: 12,
			url
		})) : null, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			flex: "0 1 auto",
			gap: .75,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("row", {
			flex: "0 1 auto",
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			inline: true,
			maxLines: 1,
			size: "3xs",
			truncate: true
		}, sourceLabel)), items.length > 1 ? /* @__PURE__ */ __dil.jsx("row", { flex: "none" }, /* @__PURE__ */ __dil.jsx("text", {
			color: "tertiary",
			inline: true,
			size: "3xs"
		}, "+", items.length - 1)) : null));
		const badge = canLogImpressions && hasUrl ? /* @__PURE__ */ __dil.jsx("box", {
			inline: true,
			key: url,
			onVisible: () => recordShown(url, "pill")
		}, badgeContent) : badgeContent;
		if (!showPopover) return hasUrl ? /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: \`Open \${sourceLabel}\`,
			inline: true,
			onClick: () => openCitationUrl(url, "pill")
		}, badge) : badge;
		return /* @__PURE__ */ __dil.jsx("popover", {
			hoverOpenDelay: 80,
			showOnHover: true
		}, /* @__PURE__ */ __dil.jsx("popover-trigger", { onClick: () => !isMobile && isSm && hasUrl ? openCitationUrl(url, "pill") : void 0 }, badge), /* @__PURE__ */ __dil.jsx("popover-content", {
			align: "start",
			showCloseButton: isMobile ? false : void 0,
			side: "bottom",
			sideOffset: 8
		}, isMobile ? /* @__PURE__ */ __dil.jsx(MobileCitationSources, {
			items,
			recordShown
		}) : /* @__PURE__ */ __dil.jsx(DesktopCitationSources, {
			items,
			recordShown
		})));
	}
	function getCitationDetail(item) {
		return [item.metadata_label, item.snippet].filter(Boolean).join(" — ");
	}
	function DesktopCitationSources({ items, recordShown }) {
		return /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			maxHeight: 320,
			maxWidth: "100%",
			padding: {
				bottom: 2,
				top: 2,
				x: 5
			},
			scrollable: true,
			width: 384
		}, items.map((item, index) => {
			const itemUrl = item.url ?? "";
			const itemSourceLabel = item.source_label ?? item.title ?? "Source";
			const itemTitle = item.title ?? "";
			const itemDetail = getCitationDetail(item);
			const source = /* @__PURE__ */ __dil.jsx("box", {
				border: index === 0 ? void 0 : { top: {
					color: "default",
					size: 1
				} },
				gap: 1.5,
				onVisible: itemUrl ? () => recordShown(itemUrl) : void 0,
				onVisibleKey: itemUrl,
				padding: { y: 3 },
				width: "100%"
			}, /* @__PURE__ */ __dil.jsx("row", {
				align: "center",
				gap: 2,
				minWidth: 0,
				width: "100%"
			}, itemUrl ? /* @__PURE__ */ __dil.jsx("favicon", {
				size: 16,
				url: itemUrl
			}) : null, /* @__PURE__ */ __dil.jsx("text", {
				color: "secondary",
				inline: true,
				maxLines: 1,
				size: "xs",
				truncate: true
			}, itemSourceLabel)), itemTitle ? /* @__PURE__ */ __dil.jsx("text", {
				maxLines: 2,
				size: "sm",
				weight: "medium"
			}, itemTitle) : null, itemDetail || item.thumbnail_url ? /* @__PURE__ */ __dil.jsx("row", {
				align: "start",
				gap: 4,
				width: "100%"
			}, /* @__PURE__ */ __dil.jsx("col", {
				flex: 1,
				minWidth: 0
			}, itemDetail ? /* @__PURE__ */ __dil.jsx("text", {
				color: "secondary",
				maxLines: 3,
				size: "sm"
			}, itemDetail) : null), item.thumbnail_url ? /* @__PURE__ */ __dil.jsx("image", {
				alt: "",
				fit: "cover",
				height: 56,
				hideOnFailure: true,
				radius: "xl",
				src: item.thumbnail_url,
				width: 56
			}) : null) : null);
			return itemUrl ? /* @__PURE__ */ __dil.jsx("pressable", {
				ariaLabel: \`Open \${itemSourceLabel}\`,
				key: \`\${itemUrl}:\${index}\`,
				onClick: () => openCitationUrl(itemUrl),
				width: "100%"
			}, source) : /* @__PURE__ */ __dil.jsx("col", {
				key: \`source:\${index}\`,
				width: "100%"
			}, source);
		}));
	}
	function MobileCitationSources({ items, recordShown }) {
		return /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			maxHeight: 560,
			scrollable: true,
			width: "100%"
		}, items.map((item, index) => {
			const itemUrl = item.url ?? "";
			const itemSourceLabel = item.source_label ?? item.title ?? "Source";
			const itemTitle = item.title ?? "";
			const source = /* @__PURE__ */ __dil.jsx("box", {
				gap: 1,
				onVisible: itemUrl ? () => recordShown(itemUrl) : void 0,
				onVisibleKey: itemUrl,
				width: "100%"
			}, /* @__PURE__ */ __dil.jsx("row", {
				align: "center",
				gap: 2,
				minWidth: 0,
				width: "100%"
			}, itemUrl ? /* @__PURE__ */ __dil.jsx("favicon", {
				size: 16,
				url: itemUrl
			}) : null, /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				weight: "semibold"
			}, itemSourceLabel)), itemTitle ? /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, itemTitle) : null, item.metadata_label ? /* @__PURE__ */ __dil.jsx("caption", null, item.metadata_label) : null);
			return /* @__PURE__ */ __dil.jsx("col", {
				gap: 3,
				key: \`\${itemUrl}:\${index}\`,
				width: "100%"
			}, index > 0 ? /* @__PURE__ */ __dil.jsx("divider", { color: "subtle" }) : null, itemUrl ? /* @__PURE__ */ __dil.jsx("pressable", {
				ariaLabel: \`Open \${itemSourceLabel}\`,
				onClick: () => openCitationUrl(itemUrl),
				width: "100%"
			}, source) : source);
		}));
	}
	function Cite(props) {
		const { resolutionComplete, state } = useResolvedComponentResult("Cite", props);
		if (!state) return resolutionComplete ? null : /* @__PURE__ */ __dil.jsx("text", { inline: true }, /* @__PURE__ */ __dil.jsx("loading", { label: "Loading citations" }));
		const items = state.items ?? [];
		if (!items.length) return null;
		return /* @__PURE__ */ __dil.jsx("text", { inline: true }, /* @__PURE__ */ __dil.jsx(ResolvedCite, {
			activeIndex: state.active_index,
			items
		}));
	}

//#endregion
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
//#region WeatherWidgetV3WithSource.dil.tsx
	function temperatureLabel(temperature, unit) {
		return unit === "F" ? temperature.label_f : temperature.label_c;
	}
	function temperatureAriaLabel(temperature, unit) {
		return unit === "F" ? temperature.a11y_label_f : temperature.a11y_label_c;
	}
	function logWeatherOption(target, value) {
		GenUI.dispatchAction({
			type: "log_event",
			handler: "client",
			payload: {
				event_name: "chatgpt_widget_action",
				event_data: {
					widget_affordance: "OPTION",
					widget_action_target: target,
					widget_action_value: value,
					surface_location: "RESPONSE",
					content_reference_type: "forecast"
				}
			}
		});
	}
	function UnitToggle({ state, unit, onChange }) {
		return /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: unit === "F" ? state.unit_toggle_f_selected_label : state.unit_toggle_c_selected_label,
			padding: {
				x: 2,
				y: .5
			},
			onClick: () => {
				const nextUnit = unit === "F" ? "C" : "F";
				onChange(nextUnit);
				logWeatherOption("unit", nextUnit);
			}
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "semibold"
		}, unit), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "tertiary"
		}, "/"), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: "tertiary"
		}, unit === "F" ? "C" : "F")));
	}
	function HourlyTable({ state, unit, isWide }) {
		const { isDark } = DIL.useTheme();
		return /* @__PURE__ */ __dil.jsx("table", null, /* @__PURE__ */ __dil.jsx("table-section", { header: true }, /* @__PURE__ */ __dil.jsx("table-row", { header: true }, /* @__PURE__ */ __dil.jsx("table-cell", { vAlign: "center" }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: "secondary"
		}, state.time_label)), /* @__PURE__ */ __dil.jsx("table-cell", {
			vAlign: "center",
			width: isWide ? void 0 : "max-content",
			padding: isWide ? void 0 : { x: 1 }
		}), /* @__PURE__ */ __dil.jsx("table-cell", { vAlign: "center" }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: "secondary"
		}, state.conditions_label)), /* @__PURE__ */ __dil.jsx("table-cell", {
			vAlign: "center",
			width: isWide ? void 0 : "max-content"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: "secondary"
		}, state.focus === "precip" ? state.precipitation_label : state.temperature_label)))), /* @__PURE__ */ __dil.jsx("table-section", null, state.forecast.hourly.map((hour) => /* @__PURE__ */ __dil.jsx("table-row", { key: hour.timestamp }, /* @__PURE__ */ __dil.jsx("table-cell", { vAlign: "center" }, /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, hour.label)), /* @__PURE__ */ __dil.jsx("table-cell", {
			vAlign: "center",
			padding: isWide ? void 0 : { x: 1 }
		}, /* @__PURE__ */ __dil.jsx("image", {
			src: isDark ? hour.icon.dark : hour.icon.light,
			alt: \`\${hour.label}: \${hour.description}\`,
			width: 28,
			height: 28,
			hideOnFailure: true
		})), /* @__PURE__ */ __dil.jsx("table-cell", { vAlign: "center" }, /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, hour.description)), /* @__PURE__ */ __dil.jsx("table-cell", { vAlign: "center" }, /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, state.focus === "precip" ? hour.precip_chance == null ? "-" : \`\${hour.precip_chance}%\` : temperatureLabel(hour.temperature, unit)))))));
	}
	function ResolvedWeather({ state }) {
		const liveActivity = useIsLiveActivity();
		const isWide = DIL.useBreakpoint("sm");
		const { isDark } = DIL.useTheme();
		const [unit, setUnit] = DIL.useState(state.unit ?? state.initial_unit ?? "F");
		const [focus, setFocus] = DIL.useState(state.focus);
		const [focusDate, setFocusDate] = DIL.useState(state.focus_date);
		const [useCurrent, setUseCurrent] = DIL.useState(state.use_current);
		const forecast = state.forecast;
		const focusedDay = forecast.daily.find((day) => day.date_key === focusDate);
		const current = useCurrent ? forecast.current : null;
		const headlineTemperature = current?.temperature ?? focusedDay?.high;
		const isChart = state.presentation === "chart";
		if (liveActivity) {
			const day = focusedDay ?? forecast.daily[0];
			const hour = isChart ? null : forecast.hourly[0];
			const summary = current ?? hour ?? day;
			const temperature = current?.temperature ?? hour?.temperature ?? day?.high;
			return /* @__PURE__ */ __dil.jsx("box", {
				width: "100%",
				padding: 2,
				theme: "dark",
				background: "surface"
			}, summary && temperature ? /* @__PURE__ */ __dil.jsx("row", {
				align: "center",
				gap: 2,
				width: "100%"
			}, /* @__PURE__ */ __dil.jsx("image", {
				src: summary.icon.dark ?? summary.icon.light,
				width: 32,
				height: 32,
				hideOnFailure: true
			}), /* @__PURE__ */ __dil.jsx("col", {
				gap: 0,
				flex: 1,
				minWidth: 0
			}, /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				weight: "medium",
				truncate: true
			}, forecast.location_label), /* @__PURE__ */ __dil.jsx("text", {
				size: "xs",
				color: "secondary",
				truncate: true
			}, summary.description)), /* @__PURE__ */ __dil.jsx("col", {
				gap: 0,
				align: "end"
			}, /* @__PURE__ */ __dil.jsx("title", {
				size: "xl",
				weight: "medium"
			}, temperatureLabel(temperature, unit)), day && /* @__PURE__ */ __dil.jsx("text", {
				size: "xs",
				color: "secondary",
				truncate: true
			}, \`\${temperatureLabel(day.high, unit)} / \${temperatureLabel(day.low, unit)}\`))) : /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				weight: "medium",
				truncate: true
			}, forecast.location_label));
		}
		const scrollToValue = focusDate === forecast.hourly_chart_today_key && forecast.hourly_chart_now_start != null ? forecast.hourly_chart_now_start : focusDate != null ? forecast.hourly_chart_day_start[focusDate] : void 0;
		const chartData = forecast.hourly_chart.map((point) => {
			const temperature = unit === "F" ? point.temp_f : point.temp_c;
			return {
				timestamp: point.timestamp,
				temp_f: point.temp_f,
				precip: point.precip_chance,
				formatted: focus === "precip" ? point.precip_chance == null ? "-" : \`\${point.precip_chance}%\` : temperature == null ? "-" : \`\${Math.round(temperature)}°\`
			};
		});
		return /* @__PURE__ */ __dil.jsx("box", {
			role: "region",
			ariaLabel: state.region_label,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			padding: 0
		}, /* @__PURE__ */ __dil.jsx("col", { gap: isChart ? 0 : 4 }, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: 0,
			role: "heading"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium"
		}, forecast.location_label)), state.share_button_variant === "top_right" && /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: state.share_label,
			tooltip: state.share_label,
			padding: 1.5,
			radius: "full",
			onClick: () => GenUI.dispatchAction({
				type: "share",
				handler: "client"
			})
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "share",
			color: "secondary",
			size: "sm"
		}))), isChart ? /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, headlineTemperature && /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			padding: { top: 5 }
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "start",
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("box", { ariaLabel: temperatureAriaLabel(headlineTemperature, unit) }, /* @__PURE__ */ __dil.jsx("title", {
			size: "3xl",
			weight: "medium"
		}, temperatureLabel(headlineTemperature, unit), current ? "°" : "")), /* @__PURE__ */ __dil.jsx(UnitToggle, {
			state,
			unit,
			onChange: setUnit
		})), focusedDay && /* @__PURE__ */ __dil.jsx("text", null, focusedDay.description)), state.show_date_picker && /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			scrollable: true,
			gap: 0,
			padding: { top: 5.5 }
		}, forecast.daily.map((day) => /* @__PURE__ */ __dil.jsx("pressable", {
			key: day.timestamp,
			ariaLabel: unit === "F" ? day.a11y_label_f : day.a11y_label_c,
			ariaPressed: day.date_key === focusDate,
			padding: {
				x: 2,
				y: 2
			},
			radius: "lg",
			minWidth: 64,
			flex: 1,
			background: day.date_key === focusDate ? \`\${day.accent_color}22\` : "transparent",
			onClick: () => {
				setFocusDate(day.date_key);
				setUseCurrent(day.date_key === forecast.hourly_chart_today_key && forecast.current != null);
				logWeatherOption("focus_date", day.date_key);
			}
		}, /* @__PURE__ */ __dil.jsx("col", {
			align: "center",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			truncate: true
		}, day.label), /* @__PURE__ */ __dil.jsx("image", {
			src: isDark ? day.icon.dark : day.icon.light,
			alt: \`\${day.label}: \${day.description}\`,
			width: 28,
			height: 28,
			hideOnFailure: true
		}), /* @__PURE__ */ __dil.jsx("text", { weight: "semibold" }, temperatureLabel(day.high, unit)), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "tertiary"
		}, temperatureLabel(day.low, unit)))))), /* @__PURE__ */ __dil.jsx("box", {
			role: "group",
			ariaLabel: state.focus_mode_label,
			padding: { top: 5 }
		}, /* @__PURE__ */ __dil.jsx("select", {
			ariaLabel: state.focus_mode_label,
			name: "focus_mode",
			options: [{
				label: state.temperature_label,
				value: "temp"
			}, {
				label: state.precipitation_label,
				value: "precip"
			}],
			value: focus,
			onChange: (value) => {
				if (value === "temp" || value === "precip") {
					setFocus(value);
					logWeatherOption("focus_mode", value);
				}
			},
			size: "sm",
			variant: "ghost"
		})), /* @__PURE__ */ __dil.jsx("box", { padding: {
			top: 2,
			bottom: 2
		} }, /* @__PURE__ */ __dil.jsx("chart", {
			data: chartData,
			series: focus === "precip" ? [{
				type: "bar",
				dataKey: "precip",
				color: "blue"
			}] : [{
				type: "area",
				dataKey: "temp_f",
				color: isDark ? "#F5F5F5" : "#111111",
				fillColor: "#F1A03A",
				curveType: "linear"
			}],
			xAxis: {
				dataKey: "timestamp",
				labels: forecast.hourly_chart_labels,
				ticks: forecast.hourly_chart_ticks,
				axisLine: false,
				type: "number"
			},
			yAxis: { domain: focus === "precip" ? [0, 100] : forecast.hourly_chart_domain_all_f ?? void 0 },
			width: "100%",
			height: 120,
			showLegend: false,
			showTooltip: false,
			showGrid: false,
			showYAxis: false,
			showHoverDots: false,
			showDots: true,
			showValueLabels: true,
			barRadius: 0,
			valueLabelInterval: 3,
			valueLabelOffset: 2,
			scrollable: true,
			disableUserScroll: true,
			visiblePointCount: 24,
			barGap: 0,
			barCategoryGap: "0",
			scrollToValue
		}))) : /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			justify: "between",
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("title", {
			size: "md",
			weight: "semibold"
		}, state.hourly_table_date_label), state.focus === "temp" && /* @__PURE__ */ __dil.jsx(UnitToggle, {
			state,
			unit,
			onChange: setUnit
		})), /* @__PURE__ */ __dil.jsx(HourlyTable, {
			state,
			unit,
			isWide
		})), state.share_button_variant === "bottom" && /* @__PURE__ */ __dil.jsx("box", { padding: isChart ? { top: 5.75 } : void 0 }, /* @__PURE__ */ __dil.jsx("button", {
			variant: "soft",
			block: true,
			onClick: () => GenUI.dispatchAction({
				type: "share",
				handler: "client"
			})
		}, /* @__PURE__ */ __dil.jsx("icon", { name: "share" }), state.share_label)))));
	}
	function WeatherWidgetV3WithSource(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("WeatherWidgetV3WithSource", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 400
		});
		return /* @__PURE__ */ __dil.jsx(ResolvedWeather, { state });
	}

//#endregion
//#region internal/onboarding-wave2.dil.tsx
	function OnboardingTabs({ items, selected, useCase, source, onChange }) {
		return /* @__PURE__ */ __dil.jsx("row", {
			gap: 2,
			wrap: "wrap",
			width: "100%"
		}, items.map((item) => /* @__PURE__ */ __dil.jsx("button", {
			key: item.id,
			color: "primary",
			size: "lg",
			pill: true,
			variant: selected === item.id ? "solid" : "outline",
			onClick: () => {
				onChange(item.id);
				GenUI.dispatchAction({
					handler: "client",
					type: "log_event",
					loadingBehavior: "none",
					payload: {
						event_name: "chatgpt_conversational_onboarding_tab_clicked",
						event_data: {
							renderer: "dil",
							level: "l2",
							use_case: useCase,
							source,
							tab_id: item.id,
							previous_tab_id: selected
						}
					}
				});
			}
		}, item.label)));
	}
	function OnboardingQuestion({ label, question, gap = 1 }) {
		return /* @__PURE__ */ __dil.jsx("col", {
			gap,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: "secondary"
		}, label), /* @__PURE__ */ __dil.jsx("text", {
			size: "lg",
			weight: "semibold"
		}, \`"\${question}"\`));
	}

//#endregion
//#region ConversationalOnboardingSearch.dil.tsx
	function NewsSummary({ item }) {
		return /* @__PURE__ */ __dil.jsx("list-item", null, /* @__PURE__ */ __dil.jsx("text", { inline: true }, item.summary), /* @__PURE__ */ __dil.jsx(Cite, { ref: item.ref }));
	}
	function ResolvedSearch({ state }) {
		const [tab, setTab] = DIL.useState(state.tab);
		const isSm = DIL.useBreakpoint("sm");
		const weather = state.weather_dil.component === "WeatherWidgetV3WithSource" ? state.weather_dil.state : state.weather_dil.type === "Basic" ? state.weather_dil.initialState : void 0;
		return /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			gap: 2
		}, /* @__PURE__ */ __dil.jsx(OnboardingTabs, {
			items: [
				{
					id: "weather",
					label: state.weather_tab_label
				},
				{
					id: "stock",
					label: state.stock_tab_label
				},
				{
					id: "news",
					label: state.news_tab_label
				}
			],
			selected: tab,
			onChange: setTab,
			useCase: "look_something_up",
			source: "conversational_onboarding_interactive_lookup"
		}), /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			padding: { y: 4 },
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx(OnboardingQuestion, {
			label: state.ask_me_label,
			question: tab === "weather" ? state.weather_question : tab === "stock" ? state.stock_question : state.news_question
		}), /* @__PURE__ */ __dil.jsx("divider", null), tab === "stock" ? state.stock_state != null ? /* @__PURE__ */ __dil.jsx(StockChart, {
			ticker: state.stock_ticker,
			asset_type: state.stock_asset_type,
			market: state.stock_market,
			__state: {
				...state.stock_state,
				share_button_variant: "none"
			}
		}) : null : tab === "news" ? /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("list", {
			marker: "bullet",
			gap: 2
		}, state.news_items.map((item) => /* @__PURE__ */ __dil.jsx(NewsSummary, {
			key: item.ref,
			item
		}))), /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			padding: { y: 3 }
		}, state.resolved_news_items.length > 0 && /* @__PURE__ */ __dil.jsx("carousel", {
			gap: 4,
			ariaLabel: state.news_tab_label
		}, state.resolved_news_items.map((item) => /* @__PURE__ */ __dil.jsx("carousel-item", {
			key: item.ref,
			variant: "outline",
			width: isSm ? "31.5%" : "47.5%",
			padding: 0
		}, /* @__PURE__ */ __dil.jsx(LinkImpression, {
			url: item.url,
			width: "100%",
			height: "100%"
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			height: "100%",
			ariaLabel: \`\${state.news_tab_label}: \${item.title}\`,
			onClick: () => GenUI.dispatchAction({
				type: "open_url",
				handler: "client",
				payload: {
					url: item.url,
					event_name: "news_carousel_item_clicked",
					event_data: {
						widget_name: "news_carousel",
						ref: item.ref,
						url: item.url,
						domain: item.domain
					}
				}
			})
		}, /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			height: "100%",
			gap: 4,
			padding: { bottom: 6 }
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			height: 144,
			background: "surface-secondary",
			align: "center",
			justify: "center",
			clip: true
		}, item.thumbnail_url ? /* @__PURE__ */ __dil.jsx("image", {
			src: item.thumbnail_url,
			alt: item.title,
			width: "100%",
			height: "100%",
			radius: "none",
			hideOnFailure: true,
			fallback: /* @__PURE__ */ __dil.jsx("favicon", {
				url: item.url,
				size: 40,
				frame: true
			})
		}) : /* @__PURE__ */ __dil.jsx("favicon", {
			url: item.url,
			size: 40,
			frame: true
		})), /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			gap: 2,
			padding: { x: 4 }
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("favicon", {
			url: item.url,
			size: 16,
			frame: true
		}), /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary",
			truncate: true
		}, item.source_label)), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			maxLines: 5
		}, item.title), item.date_label && /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, item.date_label)))))))))) : weather?.forecast != null ? /* @__PURE__ */ __dil.jsx(WeatherWidgetV3WithSource, { __state: {
			...weather,
			share_button_variant: "none"
		} }) : null));
	}
	function ConversationalOnboardingSearch(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("ConversationalOnboardingSearch", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 140
		});
		return /* @__PURE__ */ __dil.jsx(ResolvedSearch, { state });
	}

//#endregion
return ConversationalOnboardingSearch;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=conversational-onboarding-search-26133e0710d4.js.map