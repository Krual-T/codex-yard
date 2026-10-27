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
//#region AskUserLocation.dil.tsx
	const SvgPath = "path";
	function LocationPin() {
		return /* @__PURE__ */ __dil.jsx("text", { color: "secondary" }, /* @__PURE__ */ __dil.jsx("svg", {
			width: 24,
			height: 24,
			viewBox: "0 0 24 24"
		}, /* @__PURE__ */ __dil.jsx(SvgPath, {
			d: "M12 9.25C10.8954 9.25 10 10.1454 10 11.25C10 12.3546 10.8954 13.25 12 13.25C13.1046 13.25 14 12.3546 14 11.25C14 10.1454 13.1046 9.25 12 9.25ZM8 11.25C8 9.04086 9.79086 7.25 12 7.25C14.2091 7.25 16 9.04086 16 11.25C16 13.4591 14.2091 15.25 12 15.25C9.79086 15.25 8 13.4591 8 11.25Z",
			fill: "currentColor"
		}), /* @__PURE__ */ __dil.jsx(SvgPath, {
			d: "M12.4258 22.6548C12.1561 22.7817 11.8432 22.7814 11.5736 22.6545C11.5355 22.6366 11.4978 22.618 11.4601 22.5993C11.3914 22.5652 11.2932 22.5156 11.1698 22.4508C10.9231 22.3212 10.5748 22.1306 10.1586 21.8817C9.32846 21.3852 8.21721 20.6503 7.10105 19.6983C4.9064 17.8264 2.5 14.9472 2.5 11.25C2.5 6.00329 6.75329 1.75 12 1.75C17.2467 1.75 21.5 6.00329 21.5 11.25C21.5 14.9472 19.0936 17.8264 16.8989 19.6983C15.7828 20.6503 14.6715 21.3852 13.8414 21.8817C13.4252 22.1306 13.0769 22.3212 12.8302 22.4508C12.6965 22.521 12.5623 22.5903 12.4258 22.6548ZM4.5 11.25C4.5 14.0528 6.3436 16.4236 8.39895 18.1767C9.40779 19.0372 10.4215 19.7085 11.1851 20.1652C11.5113 20.3602 11.7897 20.5149 12 20.6273C12.2103 20.5149 12.4887 20.3602 12.8149 20.1652C13.5785 19.7085 14.5922 19.0372 15.6011 18.1767C17.6564 16.4236 19.5 14.9472 19.5 11.25C19.5 7.10786 16.1421 3.75 12 3.75C7.85786 3.75 4.5 7.10786 4.5 11.25Z",
			fill: "currentColor"
		})));
	}
	function AskUserLocation(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("AskUserLocation", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 130
		});
		return /* @__PURE__ */ __dil.jsx(LocationRequest, { state });
	}
	function LocationRequest({ state }) {
		const wide = DIL.useBreakpoint("sm");
		const [dismissed, setDismissed] = DIL.useState(state.dismissed ?? false);
		if (dismissed) return null;
		return /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			variant: "soft",
			background: "transparent",
			radius: 0,
			padding: 0
		}, /* @__PURE__ */ __dil.jsx("box", {
			align: wide ? "center" : "stretch",
			direction: wide ? "row" : "col",
			gap: 4,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: wide ? "center" : "start",
			gap: wide ? 3 : 1,
			flex: wide ? "auto" : void 0,
			minWidth: 0,
			width: wide ? void 0 : "100%"
		}, /* @__PURE__ */ __dil.jsx(LocationPin, null), /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: "primary"
		}, state.title), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "normal",
			color: "secondary"
		}, /* @__PURE__ */ __dil.jsx("text", {
			inline: true,
			size: "sm",
			weight: "normal",
			color: "secondary"
		}, \`\${state.description} \`), /* @__PURE__ */ __dil.jsx(LinkImpression, {
			url: state.learn_more_url,
			inline: true,
			width: "fit-content"
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			inline: true,
			align: "start",
			width: "fit-content",
			onClick: () => GenUI.dispatchAction({
				handler: "client",
				type: "open_url",
				payload: { url: state.learn_more_url }
			})
		}, /* @__PURE__ */ __dil.jsx("text", {
			inline: true,
			size: "sm",
			weight: "normal",
			color: "#0285FF"
		}, state.learn_more_label)))))), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2,
			justify: wide ? "end" : "start",
			width: wide ? "fit-content" : "100%"
		}, /* @__PURE__ */ __dil.jsx("box", {
			flex: wide ? "0 0 auto" : 1,
			width: wide ? "fit-content" : "100%"
		}, /* @__PURE__ */ __dil.jsx("button", {
			block: true,
			color: "secondary",
			variant: "outline",
			size: "lg",
			pill: true,
			onClick: () => setDismissed(true)
		}, state.not_now_label)), /* @__PURE__ */ __dil.jsx("box", {
			flex: wide ? "0 0 auto" : 1,
			width: wide ? "fit-content" : "100%"
		}, /* @__PURE__ */ __dil.jsx("button", {
			block: true,
			color: "primary",
			variant: "solid",
			size: "lg",
			pill: true,
			onClick: () => GenUI.dispatchAction({
				handler: "client",
				type: "request_location_permission",
				payload: {}
			})
		}, state.turn_on_label)))));
	}

//#endregion
return AskUserLocation;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=ask-user-location-81b91d8222ef.js.map