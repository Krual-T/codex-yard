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
//#region AskUserLocationV2.dil.tsx
	const SvgPath = "path";
	function LocationArtwork() {
		return /* @__PURE__ */ __dil.jsx("svg", {
			width: 24,
			height: 24,
			viewBox: "0 0 24 24"
		}, /* @__PURE__ */ __dil.jsx(SvgPath, {
			d: "M9.01249 17.15C9.92915 17.6833 10.925 17.95 12 17.95C13.075 17.95 14.0667 17.6833 14.975 17.15C15.8833 16.6167 16.6042 15.8958 17.1375 14.9875C17.6708 14.0708 17.9375 13.075 17.9375 12C17.9375 10.925 17.6708 9.93333 17.1375 9.025C16.6042 8.11667 15.8833 7.39583 14.975 6.8625C14.0667 6.32917 13.075 6.0625 12 6.0625C10.925 6.0625 9.92915 6.32917 9.01249 6.8625C8.10415 7.39583 7.38332 8.11667 6.84999 9.025C6.31665 9.93333 6.04999 10.925 6.04999 12C6.04999 13.075 6.31665 14.0708 6.84999 14.9875C7.38332 15.8958 8.10415 16.6167 9.01249 17.15Z",
			fill: "white"
		}), /* @__PURE__ */ __dil.jsx(SvgPath, {
			d: "M13 21V3H11V21H13Z",
			fill: "white"
		}), /* @__PURE__ */ __dil.jsx(SvgPath, {
			d: "M21 16.8877L3 9.2502V7.0752L21 14.7252V16.8877Z",
			fill: "white"
		}), /* @__PURE__ */ __dil.jsx(SvgPath, {
			d: "M21 16.8877V17C21 17.775 20.8289 18.4669 20.4873 19.0752C20.154 19.6833 19.6833 20.1584 19.0752 20.5C18.4669 20.8333 17.7749 21 17 21H13V17.8652C13.6967 17.7496 14.3554 17.5139 14.9746 17.1504C15.8125 16.6584 16.488 16.0045 17.0068 15.1934L21 16.8877Z",
			fill: "#FFC93C"
		}), /* @__PURE__ */ __dil.jsx(SvgPath, {
			d: "M3 9.25L6.21191 10.6123C6.10586 11.0585 6.0498 11.5206 6.0498 12C6.0498 13.0749 6.31637 14.0707 6.84961 14.9873C7.38294 15.8956 8.10436 16.6171 9.0127 17.1504C9.63809 17.5142 10.3009 17.7506 11 17.8662V21H7C6.22505 21 5.53311 20.8333 4.9248 20.5C4.31661 20.1584 3.84163 19.6834 3.5 19.0752C3.16667 18.4669 3 17.775 3 17V9.25Z",
			fill: "#FF8BC9"
		}), /* @__PURE__ */ __dil.jsx(SvgPath, {
			d: "M11 6.14551C10.3008 6.26107 9.63815 6.49846 9.0127 6.8623C8.18883 7.34604 7.52025 7.98511 7.00488 8.77734L3 7.0752V7C3 6.225 3.16667 5.53314 3.5 4.9248C3.84161 4.31665 4.31665 3.84598 4.9248 3.5127C5.53311 3.17107 6.22505 3 7 3H11V6.14551Z",
			fill: "#7DCC60"
		}), /* @__PURE__ */ __dil.jsx(SvgPath, {
			d: "M17 3C17.7749 3.00002 18.4669 3.17105 19.0752 3.5127C19.6833 3.84597 20.154 4.3167 20.4873 4.9248C20.8289 5.53312 21 6.22503 21 7V14.7246L17.7822 13.3574C17.8832 12.9197 17.9375 12.4677 17.9375 12C17.9375 10.9252 17.6709 9.9336 17.1377 9.02539C16.6044 8.11706 15.8829 7.39564 14.9746 6.8623C14.3553 6.49872 13.6968 6.26216 13 6.14648V3H17Z",
			fill: "#7DCC60"
		}), /* @__PURE__ */ __dil.jsx(SvgPath, {
			d: "M10.0125 15.425C10.6208 15.775 11.2833 15.95 12 15.95C12.7167 15.95 13.375 15.775 13.975 15.425C14.575 15.0667 15.05 14.5875 15.4 13.9875C15.7583 13.3792 15.9375 12.7167 15.9375 12C15.9375 11.2833 15.7583 10.625 15.4 10.025C15.05 9.425 14.575 8.95 13.975 8.6C13.375 8.24167 12.7167 8.0625 12 8.0625C11.2833 8.0625 10.6208 8.24167 10.0125 8.6C9.41249 8.95 8.93332 9.425 8.57499 10.025C8.22499 10.625 8.04999 11.2833 8.04999 12C8.04999 12.7167 8.22499 13.3792 8.57499 13.9875C8.93332 14.5875 9.41249 15.0667 10.0125 15.425Z",
			fill: "#2E9EFF"
		}));
	}
	function AskUserLocationView({ state }) {
		const isDesktop = DIL.useBreakpoint("sm");
		const [dismissed, setDismissed] = DIL.useState(state.dismissed ?? false);
		const v3 = state.cta_button_v3;
		const fair = state.fair_button_style;
		const requestLocation = () => GenUI.dispatchAction({
			handler: "client",
			type: "request_location_permission",
			payload: {}
		});
		const dismiss = async () => {
			try {
				const result = await GenUI.dispatchAction({
					handler: "server",
					type: "ask_user_location_dismiss",
					payload: {}
				});
				if (result && typeof result === "object" && "status" in result && result.status === "error") return;
				setDismissed(true);
			} catch {}
		};
		const decline = () => {
			if (state.not_now_reroll) GenUI.issueNewTurn(state.not_now_reroll_query);
			else dismiss();
		};
		const defaultMobile = !isDesktop && !state.cta_button_v2 && !v3 && !state.not_now_reroll && !fair;
		if (state.followup_suggestions_only || dismissed) return /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			weight: "normal",
			color: "primary"
		}, state.location_fallback_label), /* @__PURE__ */ __dil.jsx("col", {
			gap: 2,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			align: "start",
			width: "fit-content",
			onClick: requestLocation
		}, /* @__PURE__ */ __dil.jsx("text", { inline: true }, /* @__PURE__ */ __dil.jsx("icon", {
			inline: true,
			name: "arrow-curved"
		}), /* @__PURE__ */ __dil.jsx("text", {
			inline: true,
			size: "md",
			weight: "semibold",
			color: "primary",
			underline: "dotted"
		}, state.use_my_location_label))), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, state.suggested_cities.map((city) => /* @__PURE__ */ __dil.jsx("pressable", {
			key: city,
			align: "start",
			width: "fit-content",
			onClick: () => GenUI.issueNewTurn(city)
		}, /* @__PURE__ */ __dil.jsx("text", { inline: true }, /* @__PURE__ */ __dil.jsx("icon", {
			inline: true,
			name: "arrow-curved"
		}), /* @__PURE__ */ __dil.jsx("text", {
			inline: true,
			size: "md",
			weight: "semibold",
			color: "primary",
			underline: "dotted"
		}, city)))))));
		const secondaryLabel = isDesktop && v3 ? state.choose_location_web_label : state.not_now_reroll && !v3 ? state.not_now_label : state.cta_button_v2 || v3 ? state.choose_location_label : state.not_now_label;
		const desktopWidth = v3 ? 166 : state.cta_button_v2 && fair ? 216 : 123;
		const width = isDesktop ? desktopWidth : "100%";
		const turnOn = /* @__PURE__ */ __dil.jsx("box", {
			width,
			maxWidth: width,
			minWidth: 0,
			flex: isDesktop ? \`0 1 \${desktopWidth}px\` : void 0
		}, v3 && (!isDesktop || fair) ? /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			height: isDesktop ? 40 : 48,
			align: "center",
			justify: "center",
			border: fair ? {
				size: 1,
				color: "default"
			} : 0,
			background: fair ? "transparent" : "surface-inverted",
			radius: "full",
			onClick: requestLocation
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: isDesktop ? "sm" : "md",
			weight: "medium",
			color: fair ? "emphasis" : {
				light: "gray-0",
				dark: "gray-1000"
			}
		}, state.turn_on_label)) : /* @__PURE__ */ __dil.jsx("button", {
			block: true,
			color: "primary",
			variant: fair ? "outline" : "solid",
			size: isDesktop ? "xl" : "lg",
			pill: true,
			onClick: requestLocation
		}, state.turn_on_label));
		const declineButton = /* @__PURE__ */ __dil.jsx("box", {
			width: isDesktop && state.cta_button_v2 && !fair && !v3 ? void 0 : width,
			maxWidth: isDesktop && state.cta_button_v2 && !fair && !v3 ? void 0 : width,
			minWidth: 0,
			flex: isDesktop && !(state.cta_button_v2 && !fair && !v3) ? \`0 1 \${desktopWidth}px\` : void 0
		}, v3 && (!isDesktop || fair) ? /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			height: isDesktop ? 40 : 48,
			align: "center",
			justify: "center",
			border: fair ? {
				size: 1,
				color: "default"
			} : 0,
			radius: "full",
			onClick: decline
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: isDesktop ? "sm" : "md",
			weight: "medium",
			color: "emphasis"
		}, secondaryLabel)) : /* @__PURE__ */ __dil.jsx("button", {
			block: true,
			color: "primary",
			variant: isDesktop || fair ? "outline" : "ghost",
			size: isDesktop ? "xl" : "lg",
			pill: true,
			onClick: isDesktop && state.cta_button_v2 && !fair && !v3 ? dismiss : decline
		}, secondaryLabel));
		return /* @__PURE__ */ __dil.jsx("box", {
			width: isDesktop ? v3 ? 460 : 476 : "100%",
			maxWidth: "100%"
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			clip: v3
		}, /* @__PURE__ */ __dil.jsx("card", {
			width: "100%",
			variant: "soft",
			background: "transparent",
			radius: 0,
			padding: 0
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: v3 ? 0 : void 0,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2
		}, /* @__PURE__ */ __dil.jsx(LocationArtwork, null), defaultMobile && /* @__PURE__ */ __dil.jsx("spacer", null), defaultMobile && /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: state.dismiss_label,
			onClick: dismiss,
			padding: 2
		}, /* @__PURE__ */ __dil.jsx("icon", { name: "x" }))), /* @__PURE__ */ __dil.jsx("col", {
			gap: v3 ? isDesktop ? "2px" : 2 : isDesktop ? 0 : 2,
			padding: v3 ? { top: 4 } : { top: isDesktop ? 2.5 : 5 }
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			weight: "semibold",
			color: "primary"
		}, state.title), /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			weight: "normal",
			color: "secondary"
		}, /* @__PURE__ */ __dil.jsx("text", {
			inline: true,
			color: "secondary"
		}, state.description + " "), /* @__PURE__ */ __dil.jsx(LinkImpression, {
			url: state.learn_more_url,
			inline: true,
			width: "fit-content"
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			inline: true,
			align: "start",
			width: "fit-content",
			onClick: () => GenUI.openUrl(state.learn_more_url)
		}, /* @__PURE__ */ __dil.jsx("text", {
			inline: true,
			weight: "normal",
			color: "secondary",
			underline: "dotted"
		}, state.learn_more_label))))), isDesktop ? /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: v3 ? 2.5 : 2,
			justify: "start",
			width: "100%",
			padding: { top: 6 }
		}, v3 ? /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, turnOn, declineButton) : /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, declineButton, turnOn)) : /* @__PURE__ */ __dil.jsx("col", {
			gap: 2,
			width: "100%",
			padding: { top: 8 }
		}, turnOn, (fair || state.cta_button_v2 || v3 || state.not_now_reroll) && declineButton)))));
	}
	function AskUserLocationV2(props) {
		const { resolutionComplete, state } = useResolvedComponentResult("AskUserLocationV2", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 260
		});
		return /* @__PURE__ */ __dil.jsx(AskUserLocationView, { state });
	}

//#endregion
return AskUserLocationV2;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=ask-user-location-v2-d7949e8f94c7.js.map