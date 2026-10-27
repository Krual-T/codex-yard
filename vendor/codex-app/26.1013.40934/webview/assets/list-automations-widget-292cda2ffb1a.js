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
//#region ListAutomations.dil.tsx
	function ListAutomations(props) {
		const { isDark } = DIL.useTheme();
		const mutedColor = isDark ? "#afafaf" : "tertiary";
		const [hoveredItem, setHoveredItem] = DIL.useState(null);
		const hoverBackground = isDark ? "rgba(65, 65, 65, 0.6)" : "rgba(243, 243, 243, 0.6)";
		const { state, resolutionComplete } = useResolvedComponentResult("ListAutomations", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			maxWidth: "100%"
		}, /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 268,
			radius: "28px"
		}));
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			maxWidth: "100%",
			minWidth: 0,
			disableAutoSpacing: true
		}, /* @__PURE__ */ __dil.jsx("card", {
			width: "100%",
			padding: 0,
			gap: 0,
			radius: "28px",
			background: "surface",
			shadow: true
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			radius: "28px",
			clip: true
		}, /* @__PURE__ */ __dil.jsx("row", {
			height: 62,
			padding: { x: 5 },
			gap: 3,
			align: "center",
			border: { bottom: {
				size: 1,
				color: isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.05)"
			} }
		}, /* @__PURE__ */ __dil.jsx("box", {
			flex: "none",
			ariaHidden: true
		}, /* @__PURE__ */ __dil.jsx("svg", {
			width: 24,
			height: 24,
			viewBox: "0 0 20 20",
			color: "secondary",
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 1.33,
			strokeLinecap: "round"
		}, /* @__PURE__ */ __dil.jsx("path", { d: "M17.5 10a7.5 7.5 0 1 1-15 0 7.5 7.5 0 1 1 15 0Z M9.99996 5.8335V9.82757C9.99996 9.93808 9.95606 10.0441 9.87792 10.1222L7.91663 12.0835" }))), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: "secondary",
			lineHeight: 20
		}, state.header_label.toLocaleUpperCase())), state.automations.length === 0 && /* @__PURE__ */ __dil.jsx("box", { padding: 5 }, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			color: "secondary"
		}, state.empty_label)), /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			role: "list"
		}, state.automations.slice(0, 5).map((item) => /* @__PURE__ */ __dil.jsx("box", {
			key: item.id,
			role: "listitem",
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx(LinkImpression, {
			url: item.url,
			width: "100%",
			height: 72,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			height: 72,
			padding: { x: 5 },
			minWidth: 0,
			ariaLabel: item.title,
			background: hoveredItem === item.id ? hoverBackground : "transparent",
			onHover: (hovered) => setHoveredItem(hovered ? item.id : null),
			onClick: () => GenUI.openUrl(item.url)
		}, /* @__PURE__ */ __dil.jsx("row", {
			width: "100%",
			height: "100%",
			align: "center",
			justify: "between",
			gap: 4,
			minWidth: 0,
			border: { bottom: {
				size: 1,
				color: isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.05)"
			} }
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			fontSize: 15,
			lineHeight: 22,
			weight: "medium",
			color: "primary",
			truncate: true
		}, item.title), /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			fontSize: 15,
			lineHeight: 22,
			weight: "normal",
			color: mutedColor,
			truncate: true
		}, item.schedule_label)), /* @__PURE__ */ __dil.jsx("box", {
			flex: "none",
			ariaHidden: true
		}, /* @__PURE__ */ __dil.jsx("svg", {
			width: 24,
			height: 24,
			viewBox: "0 0 20 20",
			color: mutedColor
		}, /* @__PURE__ */ __dil.jsx("path", { d: "M6.90425 15.7792C6.64455 16.0389 6.64455 16.461 6.90425 16.7207C7.16395 16.9804 7.58595 16.9804 7.84565 16.7207L13.8007 10.7646C14.2229 10.3422 14.2229 9.65767 13.8007 9.2353L7.84565 3.27925C7.58595 3.01955 7.16395 3.01955 6.90425 3.27925C6.64455 3.53895 6.64455 3.96095 6.90425 4.22065L12.6835 9.99995L6.90425 15.7792Z" }))))))))), /* @__PURE__ */ __dil.jsx(LinkImpression, {
			url: state.view_all_url,
			width: "100%",
			height: 62
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			height: 62,
			width: "100%",
			padding: { x: 5 },
			align: "start",
			justify: "center",
			background: hoveredItem === "footer" ? hoverBackground : "transparent",
			onHover: (hovered) => setHoveredItem(hovered ? "footer" : null),
			onClick: () => GenUI.openUrl(state.view_all_url)
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			fontSize: 15,
			lineHeight: 22,
			color: mutedColor
		}, state.view_all_label))))));
	}

//#endregion
return ListAutomations;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=list-automations-widget-292cda2ffb1a.js.map