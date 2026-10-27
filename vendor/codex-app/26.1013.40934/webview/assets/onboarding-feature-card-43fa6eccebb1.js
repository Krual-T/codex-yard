import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


//#region internal/text-only-markdown.dil.tsx
/** Host-rendered text formatting, without link navigation or image loading. */
	function TextOnlyMarkdown({ children }) {
		return /* @__PURE__ */ __dil.jsx("text-only-markdown", null, children);
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
//#region OnboardingFeatureCard.dil.tsx
	function analytics(state, target, value) {
		return {
			event_name: state.analytics_context ? "chatgpt_widget_action" : null,
			event_data: state.analytics_context ? {
				widget_affordance: "OPTION",
				widget_action_target: target,
				widget_action_value: value,
				surface_location: "RESPONSE",
				content_reference_type: "dil"
			} : null
		};
	}
	function FeatureArtwork({ feature, isMobile, isDark }) {
		const width = feature.feature_id === "personalization" ? isMobile ? 135 : 90 : feature.feature_id === "images" ? isMobile ? 152 : 97 : feature.feature_id === "voice" ? 114 : isMobile ? 265 : 174;
		const height = feature.feature_id === "personalization" ? isMobile ? 121 : 84 : feature.feature_id === "images" ? isMobile ? 164 : 105 : feature.feature_id === "voice" ? 114 : isMobile ? 56 : 37;
		return /* @__PURE__ */ __dil.jsx("col", {
			align: "center",
			gap: feature.artwork_label != null ? 3 : 0
		}, feature.artwork_label != null && /* @__PURE__ */ __dil.jsx("box", { width }, /* @__PURE__ */ __dil.jsx("text", {
			size: isMobile ? "md" : "xs",
			weight: "semibold",
			color: "primary",
			textAlign: "center",
			maxLines: 1
		}, feature.artwork_label)), /* @__PURE__ */ __dil.jsx("image", {
			src: isDark && feature.dark_image_url != null ? feature.dark_image_url : feature.image_url,
			alt: "",
			width,
			height,
			fit: feature.feature_id === "images" ? "scale-down" : "contain",
			position: "center",
			radius: "none",
			hideOnFailure: true
		}));
	}
	function BenefitContent({ item, clickable }) {
		return /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: 40,
			height: 40,
			minWidth: 40,
			align: "center",
			justify: "center",
			radius: "xl",
			background: "surface-secondary"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: item.icon,
			size: "xl",
			color: "primary"
		})), /* @__PURE__ */ __dil.jsx("col", {
			gap: 1,
			align: "start",
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			weight: "medium",
			color: "primary"
		}, item.title), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary",
			maxLines: 2
		}, item.description)), clickable && /* @__PURE__ */ __dil.jsx("icon", {
			name: "chevron-right-md",
			size: "sm",
			color: "secondary"
		}));
	}
	function ResolvedFeatures({ state }) {
		const isMobile = DIL.useIsMobile();
		const isXs = DIL.useBreakpoint("xs");
		const isMd = DIL.useBreakpoint("md");
		const { isDark } = DIL.useTheme();
		const isDesktop = isXs && !isMobile;
		return /* @__PURE__ */ __dil.jsx("box", {
			direction: "col",
			width: "40rem",
			maxWidth: "100%",
			gap: 6,
			...GenUI.logEvent ? {
				onVisibleWhen: state.analytics_context != null,
				onVisible: () => GenUI.logEvent?.({
					event_name: "chatgpt_conversational_onboarding_stage_shown",
					event_data: {
						flow_id: state.analytics_context?.flow_id,
						stage_id: state.analytics_context?.stage_id
					}
				})
			} : {}
		}, state.welcome_heading != null && state.welcome_body != null && /* @__PURE__ */ __dil.jsx(TextOnlyMarkdown, null, state.welcome_body), /* @__PURE__ */ __dil.jsx("carousel", {
			gap: 4,
			showArrows: isDesktop && (!isMd || state.features.length > 3)
		}, state.features.map((item) => /* @__PURE__ */ __dil.jsx("carousel-item", {
			key: \`featured_\${item.feature_id}\`,
			width: isDesktop ? 245 : 330,
			minWidth: isDesktop ? 245 : 330,
			height: isDesktop ? 220 : 289,
			padding: 0,
			radius: "4xl",
			background: item.feature_id === "images" ? {
				light: "pink-75",
				dark: "pink-900"
			} : item.feature_id === "intelligence" ? {
				light: "blue-50",
				dark: "blue-900"
			} : {
				light: "purple-50",
				dark: "purple-900"
			}
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: item.title,
			width: "100%",
			height: "100%",
			align: "stretch",
			gap: 0,
			padding: 0,
			radius: "4xl",
			clip: true,
			onClick: () => {
				const action = item.feature_id === "intelligence" ? "set_thinking_effort" : item.feature_id === "images" ? "activate_image_generation" : "navigate_to_feature";
				const actionAnalytics = analytics(state, "plus_onboarding_feature", item.feature_id);
				GenUI.dispatchAction({
					handler: "client",
					type: action,
					payload: action === "navigate_to_feature" ? {
						feature_id: item.feature_id,
						event_source: item.feature_id === "voice" ? "plus_onboarding" : null,
						...actionAnalytics
					} : {
						effort: "extended",
						fallback_effort: "standard",
						tooltip: item.tooltip_text != null ? {
							location: "composer-intelligence-button",
							text: item.tooltip_text
						} : null,
						...actionAnalytics
					}
				});
			}
		}, /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			height: "100%",
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			height: isDesktop ? 128 : 188,
			align: "center",
			justify: "center",
			gap: 0,
			clip: true
		}, /* @__PURE__ */ __dil.jsx(FeatureArtwork, {
			feature: item,
			isMobile,
			isDark
		})), /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			height: isDesktop ? 92 : 101,
			gap: 1,
			padding: isDesktop ? {
				x: 4,
				top: 2,
				bottom: 2
			} : {
				x: 5,
				top: 4,
				bottom: 4
			},
			align: "start",
			background: {
				light: "#FFFFFF80",
				dark: "#21212180"
			},
			minHeight: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: isMobile ? "md" : "sm",
			weight: "medium",
			color: "primary",
			maxLines: isDesktop ? 1 : 2
		}, item.title), /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary",
			maxLines: isDesktop ? 3 : 2
		}, item.description))))))), /* @__PURE__ */ __dil.jsx("title", {
			size: "md",
			color: "primary"
		}, state.title), /* @__PURE__ */ __dil.jsx("col", {
			gap: 2,
			width: "100%"
		}, state.benefit_rows.map((item) => item.feature_id != null ? /* @__PURE__ */ __dil.jsx("pressable", {
			key: item.benefit_id,
			ariaLabel: item.title,
			width: "100%",
			align: "stretch",
			padding: {
				x: 2,
				y: 2
			},
			radius: "xl",
			onClick: () => GenUI.dispatchAction({
				handler: "client",
				type: "navigate_to_feature",
				payload: {
					feature_id: item.feature_id,
					effort: item.feature_id === "work" ? "extended" : null,
					event_source: item.feature_id === "voice" ? "plus_onboarding" : null,
					...analytics(state, "plus_onboarding_benefit", item.feature_id)
				}
			})
		}, /* @__PURE__ */ __dil.jsx(BenefitContent, {
			item,
			clickable: true
		})) : /* @__PURE__ */ __dil.jsx("box", {
			key: item.benefit_id,
			width: "100%",
			padding: {
				x: 2,
				y: 2
			}
		}, /* @__PURE__ */ __dil.jsx(BenefitContent, {
			item,
			clickable: false
		})))));
	}
	function OnboardingFeatureCard(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("OnboardingFeatureCard", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 360
		});
		return /* @__PURE__ */ __dil.jsx(ResolvedFeatures, { state });
	}

//#endregion
return OnboardingFeatureCard;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=onboarding-feature-card-43fa6eccebb1.js.map