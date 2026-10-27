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
//#region PackageTracker.dil.tsx
	function PackageTracker(props) {
		const liveActivity = useIsLiveActivity();
		const { resolutionComplete, state } = useResolvedComponentResult("PackageTracker", props);
		if (state?.is_loading === true || !state && !resolutionComplete) return /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 576
		});
		if (!state) return props.fallback ?? null;
		if (liveActivity) {
			const latestCheckpoint = state.checkpoints[state.checkpoints.length - 1];
			return /* @__PURE__ */ __dil.jsx("box", {
				width: "100%",
				padding: 2,
				theme: "dark",
				background: "surface"
			}, /* @__PURE__ */ __dil.jsx("col", {
				gap: .5,
				width: "100%"
			}, /* @__PURE__ */ __dil.jsx("row", {
				align: "center",
				justify: "between",
				width: "100%",
				gap: 2
			}, /* @__PURE__ */ __dil.jsx("text", {
				size: "xs",
				color: "secondary",
				truncate: true
			}, state.carrier_label), /* @__PURE__ */ __dil.jsx("text", {
				size: "xs",
				weight: "medium",
				truncate: true
			}, state.status_label)), /* @__PURE__ */ __dil.jsx("row", {
				align: "center",
				justify: "between",
				width: "100%",
				gap: 2
			}, /* @__PURE__ */ __dil.jsx("col", {
				flex: 1,
				minWidth: 0
			}, /* @__PURE__ */ __dil.jsx("title", {
				size: "sm",
				weight: "medium",
				truncate: true
			}, state.headline_label)), latestCheckpoint && /* @__PURE__ */ __dil.jsx("text", {
				size: "xs",
				color: "secondary",
				truncate: true
			}, latestCheckpoint.subtitle || latestCheckpoint.title))));
		}
		return /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			variant: "soft",
			background: "transparent",
			radius: 0,
			padding: 0
		}, /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx("box", { padding: {
			top: 0,
			bottom: 4
		} }, /* @__PURE__ */ __dil.jsx("col", { gap: 4 }, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1
		}, state.carrier_logo_url && /* @__PURE__ */ __dil.jsx("image", {
			src: state.carrier_logo_url,
			alt: state.carrier_logo_alt,
			width: 24,
			height: 24,
			hideOnFailure: true
		}), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			truncate: true
		}, state.carrier_label), /* @__PURE__ */ __dil.jsx("spacer", null), /* @__PURE__ */ __dil.jsx("badge", {
			color: state.status_badge_color,
			variant: "soft"
		}, state.status_label)), /* @__PURE__ */ __dil.jsx("col", { gap: 1 }, /* @__PURE__ */ __dil.jsx("title", {
			size: "lg",
			weight: "semibold"
		}, state.headline_label), state.summary_title && /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, state.summary_title), state.summary_subtitle && /* @__PURE__ */ __dil.jsx("caption", {
			size: "sm",
			color: "secondary"
		}, state.summary_subtitle)), /* @__PURE__ */ __dil.jsx("divider", {
			flush: true,
			color: "subtle"
		}), /* @__PURE__ */ __dil.jsx("row", {
			align: "start",
			gap: 4
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: .5,
			flex: "auto",
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("caption", {
			size: "sm",
			color: "default"
		}, state.tracking_title), /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, state.tracking_value)), state.secondary_title && state.secondary_value && /* @__PURE__ */ __dil.jsx("col", {
			gap: .5,
			flex: "auto",
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("caption", {
			size: "sm",
			color: "default"
		}, state.secondary_title), /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, state.secondary_value))), state.cta_label && state.cta_url && /* @__PURE__ */ __dil.jsx(LinkImpression, {
			url: state.cta_url,
			inline: true
		}, /* @__PURE__ */ __dil.jsx("button", {
			size: "lg",
			onClick: () => GenUI.openUrl(state.cta_url)
		}, state.cta_label)))), /* @__PURE__ */ __dil.jsx("divider", {
			flush: true,
			color: "subtle"
		}), /* @__PURE__ */ __dil.jsx("box", { padding: { y: 4 } }, /* @__PURE__ */ __dil.jsx("col", { gap: 1 }, /* @__PURE__ */ __dil.jsx("caption", {
			size: "sm",
			color: "secondary"
		}, state.tracking_history_title), state.checkpoints.length > 0 ? /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, state.checkpoints.map((checkpoint, index) => /* @__PURE__ */ __dil.jsx("box", {
			key: index,
			padding: {
				x: .5,
				y: 2.5
			}
		}, /* @__PURE__ */ __dil.jsx("col", { gap: .25 }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium"
		}, checkpoint.title), checkpoint.subtitle && /* @__PURE__ */ __dil.jsx("caption", {
			size: "sm",
			color: "secondary"
		}, checkpoint.subtitle), checkpoint.location && /* @__PURE__ */ __dil.jsx("caption", {
			size: "sm",
			color: "secondary"
		}, checkpoint.location))))) : /* @__PURE__ */ __dil.jsx("caption", {
			size: "sm",
			color: "secondary"
		}, state.empty_checkpoints_message))), /* @__PURE__ */ __dil.jsx("divider", {
			flush: true,
			color: "subtle"
		}), /* @__PURE__ */ __dil.jsx("box", { padding: {
			top: 3,
			bottom: 0
		} }, /* @__PURE__ */ __dil.jsx("row", {
			gap: 1,
			align: "center"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, state.attribution_label), /* @__PURE__ */ __dil.jsx("image", {
			src: state.attribution_provider_logo_url,
			alt: state.attribution_provider_name,
			width: 16,
			height: 16,
			fit: "contain"
		}), /* @__PURE__ */ __dil.jsx("text", { size: "xs" }, /* @__PURE__ */ __dil.jsx(LinkImpression, {
			inline: true,
			url: state.attribution_provider_url
		}, /* @__PURE__ */ __dil.jsx("link", { href: state.attribution_provider_url }, state.attribution_provider_name)))))));
	}

//#endregion
return PackageTracker;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=package-tracker-9e3bd4b2a9d5.js.map