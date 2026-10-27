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
//#region SharedActivityPlanner.dil.tsx
	function answersMatch(questions, draft, saved) {
		return questions.every((q) => {
			const a = draft[q.id];
			const b = saved[q.id];
			if (!a || !b || a.text !== b.text) return false;
			if (JSON.stringify(a.value) === JSON.stringify(b.value)) return true;
			return q.kind === "number" && a.value !== null && a.value !== "" && b.value !== null && b.value !== "" && Number.isFinite(Number(a.value)) && Number(a.value) === Number(b.value);
		});
	}
	function SharedActivityPlanner(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("SharedActivityPlanner", props.__resolutionId ? {
			...props,
			__state: void 0
		} : props);
		const host = DIL.useAppData();
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 180
		});
		return /* @__PURE__ */ __dil.jsx(Planner, {
			key: state.creation_request_id || state.activity_id,
			source: state,
			componentKey: props.__resolutionId ?? componentDataKey("SharedActivityPlanner", props),
			ready: state.shared_post_id ? host.opGenui?.nativeServerActions?.publicReady === true || host.opGenui?.nativeServerActions?.ready === true : host.opGenui?.nativeServerActions?.ready === true,
			visible: host.opGenui?.nativeServerActions?.refreshVisible === true,
			canShare: host.opGenui?.supportedClientActions?.includes("share") === true,
			canContinue: host.opGenui?.supportedClientActions?.includes("issue_new_turn") === true
		});
	}
	function Planner({ source, componentKey, ready, visible, canShare, canContinue }) {
		const sourceKey = JSON.stringify(source);
		const [ack, setAck] = DIL.useState(null);
		const state = ack?.source === sourceKey ? ack.state : source;
		const [local, setLocal] = DIL.useState(null);
		const draft = local?.activityId === state.activity_id && local.phase === state.phase ? local : {
			activityId: state.activity_id,
			phase: state.phase,
			answers: state.answers ?? {},
			index: 0,
			editing: state.editing ?? true
		};
		const [pending, setPending] = DIL.useState(false);
		const [discussing, setDiscussing] = DIL.useState(false);
		const [failed, setFailed] = DIL.useState(false);
		const [failedAction, setFailedAction] = DIL.useState("");
		const [details, setDetails] = DIL.useState(false);
		const inFlight = DIL.useRef(false);
		const actionRevision = DIL.useRef(0);
		const labels = state.labels;
		const questions = state.questions ?? [];
		const question = questions[draft.index];
		const answer = question ? draft.answers[question.id] ?? {
			value: question.kind === "multi_select" ? [] : null,
			text: ""
		} : {
			value: null,
			text: ""
		};
		function edit(update) {
			setLocal({
				...draft,
				...update
			});
			setFailed(false);
		}
		function setAnswer(update) {
			if (!question) return;
			edit({ answers: {
				...draft.answers,
				[question.id]: {
					...answer,
					...update
				}
			} });
		}
		async function recoverRevision() {
			try {
				if (state.activity_id && !GenUI.refresh) return;
				const result = await (state.activity_id ? GenUI.refresh() : GenUI.dispatchAction({
					handler: "server",
					type: "shared_activity_v2_refresh",
					payload: {}
				}));
				const next = result?.response?.data;
				if (result?.status === "success" && result.response?.status === "success" && next?.activity_id && (!state.activity_id || next.activity_id === state.activity_id)) {
					setAck({
						source: sourceKey,
						state: next
					});
					return next;
				}
			} catch {}
		}
		async function recoverAction(kind) {
			const next = kind === "respond" || kind === "finalize" ? await recoverRevision() : void 0;
			if (next && (kind === "respond" && !next.editing && answersMatch(questions, draft.answers, next.answers) || kind === "finalize" && next.phase === "finalized")) {
				setLocal(null);
				setFailed(false);
			} else setFailed(true);
		}
		async function action(kind) {
			if (!ready || inFlight.current) return;
			const wireKind = kind === "respond" && !state.activity_id ? "create" : kind;
			inFlight.current = true;
			actionRevision.current += 1;
			setPending(true);
			setFailed(false);
			setFailedAction(kind);
			if (kind === "respond") setLocal({
				...draft,
				editing: false
			});
			try {
				const result = await GenUI.dispatchAction({
					handler: "server",
					type: \`shared_activity_v2_\${wireKind}\`,
					payload: {
						activity_id: state.activity_id,
						revision: state.revision,
						shared_post_id: state.shared_post_id,
						...kind === "respond" ? {
							answers: draft.answers,
							submit: true
						} : {}
					}
				});
				const next = result?.response?.data;
				if (result?.status !== "success" || result.response?.status !== "success" || !next?.activity_id || wireKind !== "create" && next.activity_id !== state.activity_id) await recoverAction(kind);
				else {
					setAck({
						source: sourceKey,
						state: next
					});
					setLocal(null);
				}
			} catch {
				await recoverAction(kind);
			} finally {
				inFlight.current = false;
				setPending(false);
			}
		}
		async function continuePlanning() {
			if (!ready || inFlight.current || !canContinue || !state.finalize_query) return;
			inFlight.current = true;
			setPending(true);
			setFailed(false);
			setFailedAction("finalize");
			try {
				const result = await GenUI.dispatchAction({
					handler: "client",
					type: "issue_new_turn",
					payload: {
						query: state.finalize_query,
						append_to_current_leaf: true
					}
				});
				if (result === false || typeof result === "object" && result?.status && result.status !== "success") setFailed(true);
				else setDiscussing(true);
			} catch {
				setFailed(true);
			} finally {
				inFlight.current = false;
				setPending(false);
			}
		}
		const confirmed = !state.editing && answersMatch(questions, draft.answers, state.answers);
		return /* @__PURE__ */ __dil.jsx("card", { size: "full" }, /* @__PURE__ */ __dil.jsx(PlannerRefresh, {
			enabled: ready && visible && state.role === "creator" && !state.shared_post_id && state.phase === "collecting",
			read: () => {
				if (inFlight.current || !GenUI.refresh) return;
				const revision = actionRevision.current;
				return GenUI.refresh().then((result) => {
					const response = result.status === "success" ? result.response : void 0;
					if (inFlight.current || revision !== actionRevision.current || result.status !== "success" || response?.status !== "success" || response.data?.activity_id !== state.activity_id) return;
					const next = response.data;
					return () => setAck({
						source: sourceKey,
						state: next
					});
				});
			}
		}), /* @__PURE__ */ __dil.jsx("col", {
			gap: 5,
			width: "100%"
		}, state.phase === "loading" ? /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("text", { color: "secondary" }, labels.starting), failed && /* @__PURE__ */ __dil.jsx("button", {
			disabled: !ready || pending,
			onClick: () => void action(state.activity_id ? "refresh" : "create")
		}, labels.retry)) : pending && failedAction === "finalize" ? /* @__PURE__ */ __dil.jsx("col", {
			align: "center",
			gap: 3,
			padding: { y: 8 }
		}, /* @__PURE__ */ __dil.jsx("loading-indicator", { size: "lg" }), /* @__PURE__ */ __dil.jsx("text", {
			size: "lg",
			weight: "semibold",
			textAlign: "center"
		}, labels.finalizing_title), /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			textAlign: "center"
		}, labels.finalizing_detail)) : state.phase === "finalized" && state.plan ? /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, labels.group_plan), state.image_url && /* @__PURE__ */ __dil.jsx("image", {
			src: state.image_url,
			alt: labels.image_alt,
			width: "100%",
			aspectRatio: "16/9",
			radius: "xl",
			fit: "cover"
		}), /* @__PURE__ */ __dil.jsx("text", {
			size: "xl",
			weight: "semibold"
		}, state.plan.title), /* @__PURE__ */ __dil.jsx("row", {
			gap: 4,
			padding: 4,
			radius: "xl",
			background: "surface-secondary",
			wrap: "wrap"
		}, state.plan.details.slice(0, 2).map((detail, index) => /* @__PURE__ */ __dil.jsx("col", {
			key: "preview-" + index,
			flex: 1,
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, detail.label), /* @__PURE__ */ __dil.jsx("text", { weight: "semibold" }, detail.value)))), /* @__PURE__ */ __dil.jsx("text", null, state.plan.summary), /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			minHeight: 48,
			padding: { y: 2 },
			variant: "ghost",
			ariaLabel: labels.details,
			onClick: () => setDetails(!details)
		}, /* @__PURE__ */ __dil.jsx("row", {
			width: "100%",
			align: "center",
			justify: "between"
		}, /* @__PURE__ */ __dil.jsx("text", { textAlign: "start" }, labels.details), /* @__PURE__ */ __dil.jsx("icon", { name: details ? "chevron-down" : "chevron-right" }))), details && /* @__PURE__ */ __dil.jsx("col", { gap: 4 }, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, state.plan.details.slice(2).map((detail, index) => /* @__PURE__ */ __dil.jsx("col", {
			key: "detail-" + index,
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("text", { color: "secondary" }, detail.label), /* @__PURE__ */ __dil.jsx("text", null, detail.value))), state.plan.tradeoffs.map((item, index) => /* @__PURE__ */ __dil.jsx("text", { key: "tradeoff-" + index }, item)))), canShare && state.native_share_enabled && /* @__PURE__ */ __dil.jsx("button", {
			block: true,
			onClick: () => GenUI.dispatchAction({
				handler: "client",
				type: "share",
				payload: { component_key: componentKey }
			})
		}, labels.share_plan)) : /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, failed && /* @__PURE__ */ __dil.jsx("text", { color: "secondary" }, failedAction === "finalize" ? labels.finalize_error : labels.save_error), draft.editing && state.can_respond ? question && /* @__PURE__ */ __dil.jsx("col", { gap: 2 }, /* @__PURE__ */ __dil.jsx("row", {
			justify: "between",
			align: "center"
		}, /* @__PURE__ */ __dil.jsx("row", {
			gap: 1,
			align: "center"
		}, /* @__PURE__ */ __dil.jsx("button", {
			variant: "ghost",
			label: labels.previous,
			disabled: draft.index === 0 || pending,
			onClick: () => edit({ index: draft.index - 1 })
		}, /* @__PURE__ */ __dil.jsx("icon", { name: "chevron-left" })), /* @__PURE__ */ __dil.jsx("text", { color: "secondary" }, labels.progress[draft.index]), /* @__PURE__ */ __dil.jsx("button", {
			variant: "ghost",
			label: labels.next,
			disabled: draft.index === questions.length - 1 || pending,
			onClick: () => edit({ index: draft.index + 1 })
		}, /* @__PURE__ */ __dil.jsx("icon", { name: "chevron-right" })))), /* @__PURE__ */ __dil.jsx("col", { gap: 1 }, /* @__PURE__ */ __dil.jsx("text", {
			size: "xl",
			weight: "semibold"
		}, question.prompt), question.kind === "multi_select" && /* @__PURE__ */ __dil.jsx("text", { color: "secondary" }, labels.multiple)), question.kind === "single_select" || question.kind === "multi_select" ? /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			maxHeight: 240,
			scrollable: true
		}, question.options.map((option, index) => {
			const values = Array.isArray(answer.value) ? answer.value : [];
			const selected = question.kind === "multi_select" ? values.includes(option) : answer.value === option;
			return /* @__PURE__ */ __dil.jsx("col", {
				key: option,
				gap: 0
			}, /* @__PURE__ */ __dil.jsx("pressable", {
				width: "100%",
				justify: "center",
				minHeight: 48,
				padding: { y: 1 },
				border: { bottom: {
					size: index < question.options.length - 1 ? 1 : 0,
					color: "subtle"
				} },
				disabled: pending,
				ariaLabel: option,
				ariaPressed: selected,
				onClick: () => setAnswer({ value: question.kind === "multi_select" ? selected ? values.filter((x) => x !== option) : [...values, option] : option })
			}, /* @__PURE__ */ __dil.jsx("row", {
				width: "100%",
				gap: 3,
				align: "center"
			}, /* @__PURE__ */ __dil.jsx("box", {
				width: 24,
				height: 24,
				minWidth: 24,
				radius: "full",
				border: {
					size: 1,
					color: "strong"
				},
				background: selected ? "gray-1000" : "transparent",
				align: "center",
				justify: "center"
			}, selected && /* @__PURE__ */ __dil.jsx("icon", {
				name: "check",
				size: "sm",
				color: "gray-0"
			})), /* @__PURE__ */ __dil.jsx("text", null, option))));
		}))) : question.kind === "date" ? /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, labels.date_hint) : null, /* @__PURE__ */ __dil.jsx("row", {
			align: "end",
			gap: 3
		}, /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0
		}, question.kind === "single_select" || question.kind === "multi_select" ? /* @__PURE__ */ __dil.jsx("input", {
			variant: "plain",
			key: \`\${question.id}-comment\`,
			value: answer.text,
			placeholder: labels.comment,
			onChange: (text) => setAnswer({ text }),
			disabled: pending
		}) : /* @__PURE__ */ __dil.jsx("input", {
			variant: "plain",
			key: \`\${question.id}-value\`,
			inputType: question.kind === "number" ? "number" : "text",
			value: answer.value == null ? "" : String(answer.value),
			placeholder: labels.answer,
			onChange: (value) => setAnswer({ value }),
			disabled: pending
		})), /* @__PURE__ */ __dil.jsx("button", {
			pill: true,
			uniform: true,
			label: draft.index < questions.length - 1 ? labels.next : labels.submit,
			disabled: pending || !ready,
			onClick: () => draft.index < questions.length - 1 ? edit({ index: draft.index + 1 }) : void action("respond")
		}, /* @__PURE__ */ __dil.jsx("icon", { name: "arrow-right" })))) : /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("row", {
			width: "100%",
			justify: "between",
			align: "start",
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 1,
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xl",
			weight: "semibold"
		}, state.title), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, labels.answered)), state.can_respond && /* @__PURE__ */ __dil.jsx("pressable", {
			size: 36,
			minWidth: 36,
			variant: "ghost",
			radius: "full",
			ariaLabel: labels.edit,
			tooltip: labels.edit,
			disabled: pending,
			onClick: () => edit({
				editing: true,
				index: 0
			})
		}, /* @__PURE__ */ __dil.jsx("row", {
			width: "100%",
			height: "100%",
			align: "center",
			justify: "center"
		}, pending && failedAction === "respond" ? /* @__PURE__ */ __dil.jsx("loading-indicator", { size: "sm" }) : /* @__PURE__ */ __dil.jsx("icon", { name: "pencil" })))), questions.map((q) => {
			const value = draft.answers[q.id];
			return /* @__PURE__ */ __dil.jsx("col", {
				key: q.id,
				gap: 1
			}, /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				color: "secondary"
			}, q.prompt), /* @__PURE__ */ __dil.jsx("text", null, value?.value == null || value.value === "" || Array.isArray(value.value) && !value.value.length ? labels.not_provided : Array.isArray(value.value) ? value.value.join(", ") : String(value.value)), value?.text && /* @__PURE__ */ __dil.jsx("text", { color: "secondary" }, value.text));
		}), state.can_respond && (failed && failedAction === "respond" || pending || !confirmed) && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("text", { color: "secondary" }, labels.waiting), /* @__PURE__ */ __dil.jsx("button", {
			variant: "outline",
			loading: pending,
			disabled: pending || !ready,
			onClick: () => void action("respond")
		}, labels.retry_submission)), !state.can_respond && /* @__PURE__ */ __dil.jsx("text", null, labels.sign_in), state.role === "creator" && !state.shared_post_id && /* @__PURE__ */ __dil.jsx("col", { gap: 2 }, canShare && /* @__PURE__ */ __dil.jsx("button", {
			block: true,
			loading: pending && failedAction === "respond",
			disabled: pending || !confirmed || !state.native_share_enabled,
			onClick: () => GenUI.dispatchAction({
				handler: "client",
				type: "share",
				payload: { component_key: componentKey }
			})
		}, labels.share), /* @__PURE__ */ __dil.jsx("button", {
			block: true,
			variant: "outline",
			loading: pending && failedAction === "respond",
			disabled: !ready || !canContinue || !state.finalize_query || pending || !confirmed || failed && failedAction === "respond",
			onClick: () => void continuePlanning()
		}, labels.finalize)), state.role === "creator" && discussing && /* @__PURE__ */ __dil.jsx("text", { color: "secondary" }, labels.continue_chat)))));
	}
	function PlannerRefresh({ enabled, read }) {
		const now = DIL.useNow(enabled);
		const pending = DIL.useRef(false);
		const nextAttempt = DIL.useRef(now + 5e3);
		const active = DIL.useRef(false);
		DIL.useEffect(() => {
			active.current = enabled;
			return () => {
				active.current = false;
			};
		}, [enabled]);
		DIL.useEffect(() => {
			if (!enabled || pending.current || now < nextAttempt.current) return;
			const request = read();
			if (!request) return;
			pending.current = true;
			request.then((apply) => {
				if (active.current) apply?.();
			}).catch(() => {}).finally(() => {
				pending.current = false;
				nextAttempt.current = Date.now() + 5e3;
			}).catch(() => {});
		}, [enabled, now]);
		return null;
	}

//#endregion
return SharedActivityPlanner;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=shared-activity-planner-23d3b3ebc1d6.js.map