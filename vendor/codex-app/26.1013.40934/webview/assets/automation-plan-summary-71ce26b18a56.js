import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


//#region automations/plan/AutomationPlanRow.dil.tsx
	function AutomationPlanRow({ step, isLast, statusLabel, layout, detailed = false }) {
		const isLibrary = layout === "library";
		return /* @__PURE__ */ __dil.jsx("row", {
			gap: isLibrary ? 4 : 1,
			align: isLibrary ? "center" : "stretch",
			minHeight: isLibrary ? 56 : isLast ? 20 : 50,
			role: "listitem"
		}, /* @__PURE__ */ __dil.jsx("col", {
			width: isLibrary ? 24 : 28,
			flex: "0 0 auto",
			align: "center",
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("box", {
			height: 26,
			flex: "0 0 auto",
			align: "center",
			justify: "center",
			role: "img",
			ariaLabel: statusLabel
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: step.status === "completed" ? "check-circle-filled" : step.status === "in_progress" ? "spinner" : "empty-circle",
			size: "xl",
			color: step.status === "pending" ? {
				light: "gray-300",
				dark: "gray-600"
			} : step.status === "in_progress" ? "secondary" : "tertiary"
		})), !isLibrary && !isLast && /* @__PURE__ */ __dil.jsx("box", {
			width: 1,
			flex: 1,
			background: {
				light: "#ededed",
				dark: "alpha-10"
			},
			ariaHidden: true
		})), /* @__PURE__ */ __dil.jsx("col", {
			gap: 1,
			flex: 1,
			minWidth: 0,
			padding: { bottom: isLibrary || isLast ? 0 : 2 }
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			truncate: isLibrary,
			color: step.status === "completed" ? "tertiary" : "primary"
		}, step.title), detailed && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, step.description && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, step.description), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "tertiary"
		}, statusLabel))));
	}

//#endregion
//#region automations/plan/AutomationPlanSummary.dil.tsx
	function AutomationPlanSummary$1({ state, collapsed: savedCollapsed, setCollapsed }) {
		const canToggle = !!state.show_plan_label && !!state.hide_plan_label;
		const collapsed = savedCollapsed && canToggle;
		if (state.layout === "library") return /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			padding: 8,
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 1,
			padding: { bottom: 6 }
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "tertiary"
		}, state.goal_label), /* @__PURE__ */ __dil.jsx("title", { size: "md" }, state.title)), /* @__PURE__ */ __dil.jsx("divider", {
			color: "subtle",
			spacing: 0
		}), state.steps == null ? /* @__PURE__ */ __dil.jsx("col", { padding: { y: 5 } }, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			color: "secondary"
		}, state.summary_error_label)) : /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			padding: { top: 4 },
			role: "list"
		}, state.steps.map((step, index, allSteps) => /* @__PURE__ */ __dil.jsx(AutomationPlanRow, {
			key: step.id,
			step,
			isLast: index === allSteps.length - 1,
			statusLabel: state.status_labels[step.status],
			layout: "library"
		}))));
		const header = /* @__PURE__ */ __dil.jsx("row", {
			width: "100%",
			align: "center",
			gap: 2.5,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("box", {
			size: 40,
			flex: "0 0 auto",
			align: "center",
			justify: "center",
			radius: "lg",
			background: state.emoji ? void 0 : "surface-secondary",
			ariaHidden: true
		}, state.emoji ? /* @__PURE__ */ __dil.jsx("text", { size: "xl" }, state.emoji) : /* @__PURE__ */ __dil.jsx("icon", {
			name: "target",
			size: "2xl",
			color: "secondary"
		})), /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0,
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			weight: "medium",
			lineHeight: 24,
			truncate: true
		}, state.title), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary",
			truncate: true
		}, state.goal_label)));
		return /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			gap: 0,
			padding: { top: 3 }
		}, /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			radius: "2xl",
			padding: 0,
			gap: 0
		}, canToggle ? /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			padding: 3,
			radius: {
				topLeft: "2xl",
				topRight: "2xl"
			},
			focusStyle: "inset",
			variant: collapsed ? "ghost" : void 0,
			ariaLabel: collapsed ? state.show_plan_label : state.hide_plan_label,
			ariaPressed: !collapsed,
			onClick: () => setCollapsed(!collapsed)
		}, header) : /* @__PURE__ */ __dil.jsx("box", { padding: 3 }, header), /* @__PURE__ */ __dil.jsx("animate", {
			dimension: "height",
			itemAnchor: "start",
			preventInitialTransition: true,
			hideOverflow: true,
			initial: { opacity: 1 },
			enter: {
				opacity: 1,
				duration: 200,
				timingFunction: "ease"
			},
			exit: {
				opacity: 1,
				duration: 160,
				timingFunction: "ease"
			},
			layoutEnter: {
				duration: 200,
				timingFunction: "ease"
			},
			layoutExit: {
				duration: 160,
				timingFunction: "ease"
			},
			layoutMove: {
				duration: 200,
				timingFunction: "ease"
			}
		}, !collapsed ? /* @__PURE__ */ __dil.jsx("col", {
			key: "plan-details",
			width: "100%",
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("divider", {
			color: "subtle",
			spacing: 0
		}), state.steps == null ? /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			padding: {
				top: 4,
				x: 4,
				bottom: 6
			}
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			color: "secondary"
		}, state.summary_error_label)) : /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			padding: {
				top: 4,
				x: 4,
				bottom: 6
			},
			role: "list"
		}, state.steps.map((step, index, allSteps) => /* @__PURE__ */ __dil.jsx(AutomationPlanRow, {
			key: step.id,
			step,
			isLast: index === allSteps.length - 1,
			statusLabel: state.status_labels[step.status],
			detailed: true
		})))) : null)));
	}

//#endregion
//#region learning/plan/LearningPlanRow.dil.tsx
	const STEP_MARKER_SIZE = 24;
	const ACTIVE_RING_WIDTH = 2;
	const ACTIVE_RING_RADIUS = (STEP_MARKER_SIZE - ACTIVE_RING_WIDTH) / 2;
	const ACTIVE_RING_CIRCUMFERENCE = 2 * Math.PI * ACTIVE_RING_RADIUS;
	const SvgCircle = "circle";
	function LearningPlanRow({ step, position, isLast, statusLabel, layout, role = "listitem", expandedCompletedGroup = false }) {
		const { isDark } = DIL.useTheme();
		const isLibrary = layout === "library";
		return /* @__PURE__ */ __dil.jsx("row", {
			gap: isLibrary ? 4 : 1,
			align: isLibrary ? "center" : "stretch",
			minHeight: isLibrary ? 56 : isLast ? 20 : 50,
			role
		}, /* @__PURE__ */ __dil.jsx("col", {
			width: isLibrary ? STEP_MARKER_SIZE : 28,
			flex: "0 0 auto",
			align: "center",
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("box", {
			height: STEP_MARKER_SIZE,
			flex: "0 0 auto",
			align: "center",
			justify: "center",
			role: "img",
			ariaLabel: position + ". " + statusLabel
		}, expandedCompletedGroup ? /* @__PURE__ */ __dil.jsx("icon", {
			name: "chevron-up",
			size: "lg",
			color: "rgba(143, 143, 143, 0.5)"
		}) : step.status === "completed" ? /* @__PURE__ */ __dil.jsx("box", {
			size: STEP_MARKER_SIZE,
			radius: "full",
			background: {
				light: "gray-400",
				dark: "gray-600"
			},
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "check",
			size: "md",
			color: "white"
		})) : /* @__PURE__ */ __dil.jsx("row", {
			size: STEP_MARKER_SIZE,
			gap: 0,
			align: "center"
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: STEP_MARKER_SIZE / 2,
			flex: "0 0 auto",
			align: "start"
		}, /* @__PURE__ */ __dil.jsx("box", {
			size: STEP_MARKER_SIZE,
			flex: "0 0 auto",
			radius: "full",
			border: true,
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			weight: "medium",
			color: "primary",
			tabularNums: true
		}, position))), step.status === "in_progress" && /* @__PURE__ */ __dil.jsx("box", {
			width: STEP_MARKER_SIZE / 2,
			flex: "0 0 auto",
			align: "end",
			ariaHidden: true
		}, /* @__PURE__ */ __dil.jsx("box", {
			size: STEP_MARKER_SIZE,
			flex: "0 0 auto"
		}, /* @__PURE__ */ __dil.jsx("svg", {
			size: STEP_MARKER_SIZE,
			viewBox: \`0 0 \${STEP_MARKER_SIZE} \${STEP_MARKER_SIZE}\`,
			color: "primary"
		}, /* @__PURE__ */ __dil.jsx(SvgCircle, {
			cx: STEP_MARKER_SIZE / 2,
			cy: STEP_MARKER_SIZE / 2,
			r: ACTIVE_RING_RADIUS,
			fill: "none",
			stroke: isDark ? "#ffffff" : "#0d0d0d",
			strokeWidth: ACTIVE_RING_WIDTH,
			strokeDasharray: \`\${ACTIVE_RING_CIRCUMFERENCE / 4} \${ACTIVE_RING_CIRCUMFERENCE}\`,
			strokeLinecap: "round",
			transform: \`rotate(-90 \${STEP_MARKER_SIZE / 2} \${STEP_MARKER_SIZE / 2})\`
		}))))))), /* @__PURE__ */ __dil.jsx("col", {
			gap: 1,
			flex: 1,
			minWidth: 0,
			padding: { bottom: isLibrary || isLast ? 0 : 2 }
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			truncate: isLibrary,
			color: expandedCompletedGroup ? "rgba(143, 143, 143, 0.5)" : step.status === "completed" ? "tertiary" : "primary"
		}, step.title)));
	}

//#endregion
//#region learning/plan/LearningPlanSummary.dil.tsx
	function LearningPlanSummary({ state, completedExpanded, setCompletedExpanded }) {
		const isMobile = DIL.useIsMobile();
		if (state.layout === "library") return /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			padding: 8,
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 1,
			padding: { bottom: 6 }
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "tertiary"
		}, state.goal_label), /* @__PURE__ */ __dil.jsx("title", { size: "md" }, state.title)), /* @__PURE__ */ __dil.jsx("divider", {
			color: "subtle",
			spacing: 0
		}), state.steps == null ? /* @__PURE__ */ __dil.jsx("col", { padding: { y: 5 } }, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			color: "secondary"
		}, state.summary_error_label)) : /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			padding: { top: 4 },
			role: "list"
		}, state.steps.map((step, index, allSteps) => /* @__PURE__ */ __dil.jsx(LearningPlanRow, {
			key: step.id,
			step,
			position: index + 1,
			isLast: index === allSteps.length - 1,
			statusLabel: state.status_labels[step.status],
			layout: "library"
		}))));
		const steps = state.steps?.map((step, index) => ({
			step,
			position: index + 1
		})) ?? [];
		const completedSteps = steps.filter(({ step }) => step.status === "completed");
		const groupCompleted = completedSteps.length >= 2;
		const completedCountLabel = state.completed_count_label ?? \`\${completedSteps.length} completed\`;
		const currentStepIndex = steps.findIndex(({ step }) => step.status === "in_progress");
		const upcomingSteps = steps.slice(Math.max(0, currentStepIndex)).filter(({ step }) => step.status !== "completed").slice(0, isMobile ? 3 : 5);
		return /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			gap: 0,
			padding: { top: 3 }
		}, /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			padding: 5,
			gap: 4
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "start",
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0,
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "tertiary"
		}, state.goal_label), /* @__PURE__ */ __dil.jsx("title", { size: "sm" }, state.title))), /* @__PURE__ */ __dil.jsx("box", {
			height: 1,
			background: {
				light: "#ededed",
				dark: "alpha-10"
			},
			ariaHidden: true
		}), state.steps == null ? /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			padding: { y: 5 }
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			color: "secondary"
		}, state.summary_error_label)) : /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			role: "list"
		}, groupCompleted && /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx("box", { role: "listitem" }, /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			ariaLabel: state.show_completed_label,
			ariaPressed: completedExpanded,
			onClick: () => setCompletedExpanded(!completedExpanded)
		}, /* @__PURE__ */ __dil.jsx(LearningPlanRow, {
			step: {
				...completedSteps[0].step,
				title: completedCountLabel
			},
			position: completedSteps[0].position,
			isLast: !completedExpanded && upcomingSteps.length === 0,
			statusLabel: state.status_labels.completed,
			role: "presentation",
			expandedCompletedGroup: completedExpanded
		}))), /* @__PURE__ */ __dil.jsx("animate", {
			hideOverflow: true,
			initial: { opacity: 0 },
			enter: {
				opacity: 1,
				duration: 200,
				timingFunction: "ease"
			},
			exit: {
				opacity: 0,
				duration: 120,
				timingFunction: "ease"
			},
			layoutEnter: {
				duration: 200,
				timingFunction: "ease"
			},
			layoutExit: {
				duration: 160,
				timingFunction: "ease"
			},
			layoutMove: {
				duration: 200,
				timingFunction: "ease"
			}
		}, completedExpanded ? /* @__PURE__ */ __dil.jsx("col", {
			key: "completed-rows",
			gap: 0
		}, completedSteps.map(({ step, position }, index) => /* @__PURE__ */ __dil.jsx(LearningPlanRow, {
			key: step.id,
			step,
			position,
			isLast: upcomingSteps.length === 0 && index === completedSteps.length - 1,
			statusLabel: state.status_labels[step.status]
		}))) : null)), /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, [...groupCompleted ? [] : completedSteps, ...upcomingSteps].map(({ step, position }, index, visibleSteps) => /* @__PURE__ */ __dil.jsx(LearningPlanRow, {
			key: step.id,
			step,
			position,
			isLast: index === visibleSteps.length - 1,
			statusLabel: state.status_labels[step.status]
		}))))));
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
//#region AutomationPlanSummary.dil.tsx
	function getPlanSummaryView(planType) {
		switch (planType) {
			case "language_learning": return LearningPlanSummary;
			default: return AutomationPlanSummary$1;
		}
	}
	function AutomationPlanSummary(props) {
		const [, requestRender] = DIL.useState(false);
		const [collapsed, setCollapsed] = DIL.useState(true);
		const completedExpanded = DIL.useRef(false);
		const { state, resolutionComplete } = useResolvedComponentResult("AutomationPlanSummary", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			gap: 0,
			padding: { top: props.automation_id ? 3 : 0 }
		}, /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 240
		}));
		const PlanSummary = getPlanSummaryView(state.plan_type);
		return /* @__PURE__ */ __dil.jsx(PlanSummary, {
			state,
			collapsed,
			setCollapsed,
			completedExpanded: completedExpanded.current,
			setCompletedExpanded: (expanded) => {
				completedExpanded.current = expanded;
				requestRender((previous) => previous !== true);
			}
		});
	}

//#endregion
return AutomationPlanSummary;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=automation-plan-summary-71ce26b18a56.js.map