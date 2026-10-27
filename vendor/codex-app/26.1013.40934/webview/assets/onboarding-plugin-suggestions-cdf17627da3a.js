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
//#region OnboardingPluginSuggestions.dil.tsx
	const SvgPath = "path";
	function OnboardingPluginSuggestions(props) {
		const supportedActions = DIL.useAppData((data) => data.opGenui?.supportedClientActions);
		const { isDark } = DIL.useTheme();
		const { state, resolutionComplete } = useResolvedComponentResult("OnboardingPluginSuggestions", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 180
		});
		const plugins = state.plugins.slice(0, 4);
		return /* @__PURE__ */ __dil.jsx("box", {
			direction: "col",
			width: "100%",
			maxWidth: "100%",
			gap: 0,
			radius: "3xl",
			border: {
				size: 1,
				color: "default"
			},
			background: "surface",
			clip: true,
			onVisible: () => GenUI.logEvent?.({
				event_name: "chatgpt_widget_action",
				structured_event_name: state.events.shown ?? "",
				event_data: {
					widget_name: "onboarding_plugin_suggestions",
					plugin_count: plugins.length,
					installed_count: plugins.filter((plugin) => plugin.status === "connected").length
				}
			})
		}, /* @__PURE__ */ __dil.jsx("row", {
			width: "100%",
			minHeight: 57,
			padding: {
				x: 4,
				y: 3
			},
			align: "center",
			justify: "between",
			gap: 4
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2,
			wrap: "nowrap",
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("svg", {
			width: 20,
			height: 20,
			viewBox: "0 0 20 20"
		}, /* @__PURE__ */ __dil.jsx(SvgPath, {
			d: "M10.3123 1.85547C15.2771 1.85547 18.391 5.73725 18.0809 10.1797C17.9647 11.8429 17.0564 13.0834 15.8231 13.5879C14.7326 14.0337 13.47 13.8674 12.4461 13.0293C11.7934 13.5786 11.0359 13.9386 10.2449 14.0049C9.32652 14.0816 8.42804 13.757 7.70197 13.0029L7.66389 12.9639C7.642 12.9408 7.61006 12.9054 7.57014 12.8633C7.49037 12.7791 7.3782 12.6616 7.24982 12.5264C6.99227 12.2551 6.66818 11.9143 6.40217 11.6367L6.34357 11.5684C6.06899 11.2168 6.099 10.707 6.42756 10.3906L6.63459 10.1904L5.89533 9.4209C5.64063 9.15629 5.64831 8.73517 5.91291 8.48047C6.17753 8.22606 6.59874 8.23452 6.85334 8.49902L7.59357 9.26758L9.38557 7.54297L8.64533 6.77344C8.39063 6.50883 8.39831 6.08771 8.66291 5.83301C8.92752 5.57835 9.34866 5.58697 9.60334 5.85156L10.3436 6.62012L10.5604 6.41309C10.9126 6.07453 11.4734 6.08657 11.8104 6.44043L13.1072 7.80371C13.8503 8.56878 14.1444 9.47864 14.0252 10.3955C13.9486 10.9833 13.7041 11.5416 13.3485 12.0479C13.9958 12.5468 14.7208 12.6019 15.3192 12.3574C16.0315 12.0661 16.6687 11.3039 16.7537 10.0869C17.0141 6.35655 14.4499 3.18555 10.3123 3.18555C6.6529 3.18579 3.49073 5.98227 3.24494 9.50195C2.97008 13.4404 5.75621 16.7634 9.99787 16.7637C11.4792 16.7637 12.9444 16.412 13.9949 15.668C14.2945 15.4561 14.7094 15.527 14.9217 15.8262C15.134 16.1259 15.0632 16.5416 14.7635 16.7539C13.4191 17.7061 11.6557 18.0938 9.99787 18.0938C4.9396 18.0934 1.5924 14.0706 1.91779 9.40918C2.21615 5.13666 6.01184 1.85571 10.3123 1.85547ZM7.67072 11.04C7.8573 11.2357 8.04954 11.4365 8.21369 11.6094C8.34275 11.7453 8.45587 11.8647 8.53596 11.9492C8.57591 11.9914 8.60776 12.0257 8.62971 12.0488L8.66389 12.084C9.12159 12.5574 9.62959 12.7208 10.1336 12.6787C10.6588 12.6348 11.2424 12.3601 11.785 11.8379C12.3336 11.3098 12.6385 10.7414 12.7059 10.2246C12.77 9.7323 12.6301 9.21889 12.1502 8.72656L12.1444 8.7207L11.1571 7.68457L7.67072 11.04Z",
			fill: "currentColor",
			fillRule: "evenodd",
			clipRule: "evenodd"
		})), /* @__PURE__ */ __dil.jsx("box", { role: "heading" }, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			weight: "normal",
			maxLines: 1
		}, state.title))), supportedActions?.includes("open_plugin_browser") ? /* @__PURE__ */ __dil.jsx("pressable", {
			variant: "ghost",
			padding: 0,
			radius: "none",
			ariaLabel: state.browse_label,
			onClick: () => GenUI.dispatchAction({
				handler: "client",
				type: "open_plugin_browser",
				loadingBehavior: "none",
				payload: { modal: "plugins_nux" }
			})
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			color: "secondary",
			underline: true
		}, state.browse_label)) : null), /* @__PURE__ */ __dil.jsx("divider", { spacing: 0 }), /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			gap: 0,
			padding: {
				x: 2,
				y: 2
			}
		}, plugins.map((plugin, index) => {
			const connected = plugin.status === "connected" || plugin.status === "available" && "connected:" + plugin.id in state;
			const image = isDark ? plugin.icon_dark_url ?? plugin.icon_url : plugin.icon_url ?? plugin.icon_dark_url;
			return /* @__PURE__ */ __dil.jsx("row", {
				key: plugin.id,
				width: "100%",
				minHeight: 64,
				padding: {
					x: 2,
					y: 2
				},
				align: "center",
				gap: 4,
				wrap: "nowrap"
			}, /* @__PURE__ */ __dil.jsx("box", {
				size: 48,
				radius: "lg",
				border: {
					size: 1,
					color: "default"
				},
				align: "center",
				justify: "center",
				clip: true
			}, image != null ? /* @__PURE__ */ __dil.jsx("image", {
				src: image,
				alt: plugin.label,
				width: 46,
				height: 46,
				fit: "contain",
				hideOnFailure: true
			}) : /* @__PURE__ */ __dil.jsx("icon", {
				name: "connect-apps",
				size: "lg",
				color: "secondary"
			})), /* @__PURE__ */ __dil.jsx("col", {
				flex: 1,
				minWidth: 0,
				gap: 0
			}, /* @__PURE__ */ __dil.jsx("text", {
				size: "md",
				color: "primary",
				maxLines: 1
			}, plugin.label), plugin.description != null ? /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				color: "secondary",
				maxLines: 1
			}, plugin.description) : null), plugin.status === "unavailable" && plugin.status_label != null ? /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				color: "secondary",
				maxLines: 1
			}, plugin.status_label) : null, connected ? /* @__PURE__ */ __dil.jsx("icon", {
				name: "check",
				size: "lg",
				color: "secondary"
			}) : null, plugin.status === "available" && !connected && supportedActions?.includes("connect_plugin") ? /* @__PURE__ */ __dil.jsx("pressable", {
				size: 36,
				padding: 0,
				radius: "full",
				variant: "ghost",
				align: "center",
				justify: "center",
				ariaLabel: plugin.connect_label ?? plugin.label,
				onClick: () => GenUI.dispatchAction({
					handler: "client",
					type: "connect_plugin",
					loadingBehavior: "none",
					payload: {
						plugin_id: plugin.id,
						icon_url: plugin.icon_url,
						icon_dark_url: plugin.icon_dark_url,
						position: index + 1,
						event_name: "chatgpt_widget_action",
						structured_event_name: state.events.selected ?? "",
						completion_event_name: state.events.completed ?? "",
						event_data: {
							widget_name: "onboarding_plugin_suggestions",
							widget_affordance: "OPTION",
							widget_action_target: "plugin",
							widget_action_value: plugin.id,
							surface_location: "RESPONSE",
							content_reference_type: "dil"
						}
					}
				})
			}, /* @__PURE__ */ __dil.jsx("icon", {
				name: "plus",
				size: "lg",
				color: "primary"
			})) : null);
		})));
	}

//#endregion
return OnboardingPluginSuggestions;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=onboarding-plugin-suggestions-cdf17627da3a.js.map