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
//#region OnboardingStarterTasks.dil.tsx
	const SvgPath = "path";
	function Check({ color }) {
		return /* @__PURE__ */ __dil.jsx("svg", {
			width: 20,
			height: 20,
			viewBox: "0 0 20 20",
			color
		}, /* @__PURE__ */ __dil.jsx(SvgPath, {
			d: "M10 1.83496C14.5094 1.83496 18.165 5.49059 18.165 10C18.165 14.5094 14.5094 18.165 10 18.165C5.49059 18.165 1.83496 14.5094 1.83496 10C1.83496 5.49059 5.49059 1.83496 10 1.83496ZM13.1992 7.00488C12.8942 6.80038 12.4809 6.88254 12.2764 7.1875L9.13281 11.875L7.6582 10.2939C7.4077 10.0254 6.98632 10.0103 6.71777 10.2607C6.44936 10.5113 6.43505 10.9327 6.68555 11.2012L8.51758 13.165C8.9197 13.5958 9.61909 13.5393 9.94727 13.0498L13.3809 7.92773C13.5851 7.62277 13.504 7.2094 13.1992 7.00488Z",
			fill: "currentColor",
			fillRule: "evenodd",
			clipRule: "evenodd"
		}));
	}
	function TaskIcon({ task }) {
		const { isDark } = DIL.useTheme();
		if (task.completed) return /* @__PURE__ */ __dil.jsx(Check, { color: "green-500" });
		if (task.icon === "clock") return /* @__PURE__ */ __dil.jsx("svg", {
			width: 20,
			height: 20,
			viewBox: "0 0 20 20",
			color: {
				light: "blue-400",
				dark: "blue-200"
			}
		}, /* @__PURE__ */ __dil.jsx(SvgPath, {
			d: "M10 2.5a7.5 7.5 0 1 0 0 15a7.5 7.5 0 1 0 0-15",
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 1.33
		}), /* @__PURE__ */ __dil.jsx(SvgPath, {
			d: "M9.99996 5.8335V9.82757C9.99996 9.93808 9.95606 10.0441 9.87792 10.1222L7.91663 12.0835",
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 1.33,
			strokeLinecap: "round"
		}));
		if (task.icon === "pen") return /* @__PURE__ */ __dil.jsx("svg", {
			width: 24,
			height: 24,
			viewBox: "0 0 24 24"
		}, /* @__PURE__ */ __dil.jsx(SvgPath, {
			d: "M19.58 4.38996C18.05 2.86996 15.68 2.88996 14.18 4.38996L5.26999 13.33C4.25999 14.34 3.84999 14.92 3.59999 16.26L3.06999 19.56C2.88999 20.47 3.50999 21.09 4.43999 20.93L7.74999 20.39C9.06999 20.18 9.64999 19.76 10.66 18.75L19.58 9.82996C21.1 8.30996 21.12 5.93996 19.58 4.40996V4.38996Z",
			fill: isDark ? "#F3BF36" : "#FEBD08"
		}), /* @__PURE__ */ __dil.jsx(SvgPath, {
			d: "M19.58 9.81997C21.1 8.29997 21.12 5.92997 19.58 4.39997C18.05 2.87997 15.68 2.89997 14.18 4.39997L13.77 4.80997L19.18 10.22L19.58 9.81997Z",
			fill: "#FF928C"
		}), /* @__PURE__ */ __dil.jsx(SvgPath, {
			d: "M13.7694 4.81308L12.3552 6.22729L17.7646 11.6367L19.1788 10.2224L13.7694 4.81308Z",
			fill: "#D9D9D9"
		}), /* @__PURE__ */ __dil.jsx(SvgPath, {
			d: "M12.36 6.22998L5.26998 13.34C4.25998 14.35 3.84998 14.93 3.59998 16.27L3.06998 19.57C2.97998 20.02 3.08998 20.4 3.32998 20.65L15.05 8.92998L12.36 6.22998Z",
			fill: "white",
			opacity: isDark ? .35 : .5
		}), /* @__PURE__ */ __dil.jsx(SvgPath, {
			d: "M4.60001 14.05C4.06001 14.69 3.79001 15.27 3.60001 16.26L3.51001 16.81L7.18001 20.48L7.75001 20.39C8.74001 20.23 9.31001 19.96 9.95001 19.41L4.60001 14.05Z",
			fill: "#FFDDBC"
		}), /* @__PURE__ */ __dil.jsx(SvgPath, {
			d: "M3.50999 16.8101L3.06999 19.5601C2.88999 20.4701 3.50999 21.0901 4.43999 20.9301L7.17999 20.4801L3.50999 16.8101Z",
			fill: isDark ? "#555555" : "#4D4D4D"
		}));
		return null;
	}
	function eventData(state, task) {
		return {
			widget_name: "onboarding_starter_tasks",
			widget_affordance: "OPTION",
			widget_action_target: "onboarding_task",
			widget_action_value: task.id,
			surface_location: "RESPONSE",
			content_reference_type: "dil",
			flow_id: state.flow_id,
			experience_id: state.experience_id,
			arm: state.arm,
			state_id: state.state_id,
			task_id: task.id,
			category: task.category,
			section: "quick_tasks"
		};
	}
	function PromptTasks({ state }) {
		const { isDark } = DIL.useTheme();
		const supportedActions = DIL.useAppData((data) => data.opGenui?.supportedClientActions);
		return /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			gap: 5
		}, /* @__PURE__ */ __dil.jsx("box", { role: "heading" }, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			color: "primary",
			weight: "normal"
		}, state.heading)), /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			gap: state.variant === "cards" ? 4 : 3,
			align: "start"
		}, state.tasks.map((task) => {
			const onSelect = () => {
				const payload = {
					task_id: task.id,
					append_to_current_leaf: true,
					event_name: "chatgpt_widget_action",
					statsig_event_name: state.selection_event,
					event_data: {
						...eventData(state, task),
						action: "submit_prompt"
					}
				};
				GenUI.issueNewTurn(task.prompt, {
					...payload,
					...task.requires_site_preview === true ? { action: "request_site_preview" } : {},
					followup_metadata: { starter_prompt_id: task.starter_prompt_id }
				});
			};
			const disabled = task.requires_site_preview === true && !supportedActions?.includes("request_site_preview");
			return /* @__PURE__ */ __dil.jsx("box", {
				key: task.id,
				width: state.variant === "cards" ? "100%" : "fit-content",
				onVisible: () => GenUI.logEvent?.({
					event_name: "chatgpt_widget_action",
					statsig_event_name: state.impression_event,
					event_data: eventData(state, task)
				})
			}, state.variant === "cards" ? /* @__PURE__ */ __dil.jsx("row", {
				width: "100%",
				minWidth: 0,
				minHeight: 88,
				align: "start",
				gap: 5,
				wrap: "nowrap"
			}, /* @__PURE__ */ __dil.jsx("box", {
				size: 88,
				minWidth: 88,
				minHeight: 88,
				flex: "none",
				align: "center",
				justify: "center",
				radius: "2xl",
				border: {
					size: 1,
					color: "subtle"
				},
				background: {
					light: "#ffffff",
					dark: "surface"
				}
			}, task.image_url != null ? /* @__PURE__ */ __dil.jsx("image", {
				src: isDark ? task.dark_image_url ?? task.image_url : task.image_url,
				width: task.image_width,
				height: 48,
				fit: "contain",
				alt: "",
				radius: "none"
			}) : null), /* @__PURE__ */ __dil.jsx("col", {
				minHeight: 88,
				minWidth: 0,
				flex: 1,
				justify: "center",
				gap: 1,
				padding: {
					top: 1,
					bottom: 1
				}
			}, /* @__PURE__ */ __dil.jsx("text", {
				size: "md",
				color: "primary",
				weight: "medium",
				lineThrough: task.completed
			}, task.label), task.description ? /* @__PURE__ */ __dil.jsx("text", {
				size: "md",
				color: "secondary"
			}, task.description) : null), /* @__PURE__ */ __dil.jsx("box", {
				padding: { top: 5 },
				flex: "none"
			}, /* @__PURE__ */ __dil.jsx("pressable", {
				onClick: onSelect,
				disabled,
				minHeight: 44,
				flex: "none",
				padding: {
					left: 4,
					right: 4
				},
				radius: "full",
				border: {
					size: 1,
					color: "default"
				},
				background: "surface",
				variant: "ghost",
				ariaLabel: state.action_label != null ? state.action_label + ": " + task.label : task.label
			}, /* @__PURE__ */ __dil.jsx("row", {
				minHeight: 42,
				align: "center",
				justify: "center",
				gap: 0,
				wrap: "nowrap"
			}, /* @__PURE__ */ __dil.jsx("text", {
				size: "md",
				weight: "medium",
				color: "primary"
			}, state.action_label ?? task.label))))) : /* @__PURE__ */ __dil.jsx("pressable", {
				width: "fit-content",
				minHeight: 44,
				direction: "row",
				align: "center",
				justify: "start",
				padding: {
					left: 3,
					right: 4,
					top: 2,
					bottom: 2
				},
				radius: "full",
				border: {
					size: 1,
					color: "default"
				},
				background: "surface",
				ariaLabel: task.label,
				disabled,
				onClick: onSelect
			}, /* @__PURE__ */ __dil.jsx("row", {
				width: "fit-content",
				align: "center",
				gap: 2,
				wrap: "nowrap"
			}, /* @__PURE__ */ __dil.jsx(TaskIcon, { task }), /* @__PURE__ */ __dil.jsx("col", {
				gap: 1,
				minWidth: 0,
				flex: "auto"
			}, /* @__PURE__ */ __dil.jsx("text", {
				size: "md",
				color: "primary",
				weight: "normal",
				lineThrough: task.completed
			}, task.label)))));
		})));
	}
	function SelectionTasks({ state }) {
		const { isDark } = DIL.useTheme();
		if (state.viewportWidth == null) return null;
		return /* @__PURE__ */ __dil.jsx("grid", {
			columns: state.viewportWidth >= 1024 ? 4 : state.viewportWidth >= 640 ? 2 : 1,
			gap: 3
		}, state.tasks.map((task) => {
			const selected = state.selectedTaskId === task.id;
			const lightImage = task.image_url ?? task.dark_image_url;
			const darkImage = task.dark_image_url ?? task.image_url;
			return /* @__PURE__ */ __dil.jsx("grid-item", {
				key: task.id,
				minWidth: 0,
				radius: 16,
				background: "surface"
			}, /* @__PURE__ */ __dil.jsx("pressable", {
				width: "100%",
				height: 120,
				minWidth: 0,
				padding: 4,
				radius: 16,
				border: {
					size: 1,
					color: "default"
				},
				background: selected ? "color-mix(in oklab, var(--color-blue) 10%, transparent)" : void 0,
				ariaLabel: task.label,
				ariaPressed: selected,
				disabled: state.disabled,
				onClick: () => GenUI.issueNewTurn(task.label, { followup_metadata: { onboarding: { framework: {
					state: "answer",
					event: state.action.event,
					inputs: { taskId: task.id }
				} } } })
			}, /* @__PURE__ */ __dil.jsx("col", { gap: 4 }, /* @__PURE__ */ __dil.jsx("row", {
				width: "100%",
				align: "center",
				justify: "between"
			}, /* @__PURE__ */ __dil.jsx("box", {
				size: 24,
				flex: "none"
			}, lightImage != null && darkImage != null ? /* @__PURE__ */ __dil.jsx("image", {
				src: isDark ? darkImage : lightImage,
				width: 24,
				height: 24,
				fit: "contain",
				alt: ""
			}) : state.taskImageUrls?.[task.id] != null ? /* @__PURE__ */ __dil.jsx("image", {
				src: state.taskImageUrls[task.id],
				width: 24,
				height: 24,
				fit: "contain",
				alt: ""
			}) : /* @__PURE__ */ __dil.jsx("icon", {
				name: state.taskIconNames?.[task.id] ?? "grid",
				size: "lg",
				color: "tertiary"
			})), /* @__PURE__ */ __dil.jsx("box", {
				size: 24,
				align: "center",
				justify: "center"
			}, selected ? /* @__PURE__ */ __dil.jsx(Check, { color: "var(--color-blue)" }) : null)), /* @__PURE__ */ __dil.jsx("text", {
				size: "md",
				color: "primary",
				maxLines: 2
			}, task.label))));
		}));
	}
	function OnboardingStarterTasks(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("OnboardingStarterTasks", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 120
		});
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			maxWidth: "100%"
		}, state.variant === "desktop_selection" ? /* @__PURE__ */ __dil.jsx(SelectionTasks, { state }) : /* @__PURE__ */ __dil.jsx(PromptTasks, { state }));
	}

//#endregion
return OnboardingStarterTasks;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=onboarding-starter-tasks-e4ec246ae130.js.map