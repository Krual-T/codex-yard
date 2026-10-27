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
//#region CreateInteractivePoll.dil.tsx
	function CreateInteractivePoll(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("CreateInteractivePoll", props.__resolutionId ? {
			...props,
			__state: void 0
		} : props);
		const host = DIL.useAppData();
		const componentKey = typeof props.__resolutionId === "string" && host.opGenui?.componentResults?.[props.__resolutionId] != null ? props.__resolutionId : componentDataKey("CreateInteractivePoll", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 180
		});
		return /* @__PURE__ */ __dil.jsx(Poll, {
			key: state.poll_id,
			source: state,
			componentKey,
			ready: state.shared_post ? host.opGenui?.nativeServerActions?.publicReady === true || host.opGenui?.nativeServerActions?.ready === true : host.opGenui?.nativeServerActions?.ready === true,
			refreshVisible: host.opGenui?.nativeServerActions?.refreshVisible === true,
			canShare: host.opGenui?.supportedClientActions?.includes("share") === true
		});
	}
	function Poll({ source, componentKey, ready, canShare, refreshVisible }) {
		const [ack, setAck] = DIL.useState(null);
		const sourceKey = JSON.stringify(source);
		const state = ack?.source === sourceKey ? ack.state : source;
		const inFlight = DIL.useRef(false);
		const actionRevision = DIL.useRef(0);
		const [, setRevision] = DIL.useState(0);
		const [failed, setFailed] = DIL.useState(null);
		async function action(type, payload) {
			if (!ready || inFlight.current) return;
			inFlight.current = true;
			actionRevision.current += 1;
			setFailed(null);
			setRevision((revision) => revision + 1);
			try {
				const result = await GenUI.dispatchAction({
					handler: "server",
					type,
					payload: {
						...payload,
						poll_id: state.poll_id
					}
				});
				if (result?.status !== "success" || result.response?.status !== "success" || result.response.data?.poll_id !== state.poll_id) setFailed(result?.statusMessage ?? state.action_error_label ?? "Could not update the poll. Try again.");
				else {
					setAck({
						source: sourceKey,
						state: {
							...state,
							...result.response.data
						}
					});
					if (result.followupStatus === "error") setFailed(state.share_error_label ?? state.action_error_label ?? "Could not update the poll. Try again.");
				}
			} catch {
				setFailed(state.action_error_label ?? "Could not update the poll. Try again.");
			} finally {
				inFlight.current = false;
				setRevision((revision) => revision + 1);
			}
		}
		const [localDraft, setDraft] = DIL.useState(null);
		const nextOption = DIL.useRef(0);
		const draft = localDraft?.poll_id === state.poll_id ? localDraft : state;
		const vote = state;
		function updateDraft(nextDraft, editKind) {
			setFailed(null);
			const firstEdit = editKind != null && !draft.logged_edits?.includes(editKind);
			setDraft({
				...nextDraft,
				logged_edits: firstEdit ? [...draft.logged_edits ?? [], editKind] : draft.logged_edits
			});
			if (!firstEdit) return;
			try {
				GenUI.logEvent?.({
					event_name: "chatgpt_interactive_poll_draft_edited",
					event_data: {
						widget_name: "create_interactive_poll",
						poll_id: state.poll_id,
						edit_kind: editKind,
						draft_edit_analytics_version: 1,
						draft_edit_renderer: "dil_v2",
						option_count: nextDraft.options.filter((option) => option.label !== "").length,
						surface: state.shared_post ? "shared_post" : "conversation"
					}
				});
			} catch {}
		}
		function changeOption(index, label) {
			const previousLabel = draft.options[index].label;
			if (label === previousLabel) return;
			let count = draft.visible_option_count;
			if (index === count - 1 && label !== "" && count < 20) count++;
			else if (draft.options[index].label !== "" && label === "" && index === count - 2 && draft.options[count - 1].label === "") count--;
			updateDraft({
				...draft,
				options: draft.options.map((option, current) => current === index ? {
					...option,
					label
				} : option),
				visible_option_count: count
			}, previousLabel === "" ? "option_added" : label === "" ? "option_removed" : "option_text_changed");
		}
		function normalized(value) {
			return value.replace(new RegExp(source.input_trim_pattern ?? "^[\\\\u0009-\\\\u000d\\\\u0020\\\\u0085\\\\u00a0\\\\u1680\\\\u2000-\\\\u200a\\\\u2028\\\\u2029\\\\u202f\\\\u205f\\\\u3000]+|[\\\\u0009-\\\\u000d\\\\u0020\\\\u0085\\\\u00a0\\\\u1680\\\\u2000-\\\\u200a\\\\u2028\\\\u2029\\\\u202f\\\\u205f\\\\u3000]+$", "g"), "");
		}
		function characterCount(value) {
			return Array.from(normalized(value)).length;
		}
		const questionCount = characterCount(draft.question);
		const actionPending = inFlight.current;
		const validOptions = draft.options.filter((option) => normalized(option.label) !== "");
		const canVote = ready && !actionPending && !state.role_loading && state.can_vote;
		const maxVotes = Math.max(0, ...vote.options.map((option) => option.vote_count));
		return /* @__PURE__ */ __dil.jsx("card", { size: "full" }, /* @__PURE__ */ __dil.jsx(PollRefresh, {
			enabled: ready && refreshVisible && state.lifecycle === "published" && !state.role_loading && !state.is_unfurl_preview,
			read: () => {
				if (inFlight.current || !GenUI.refresh) return;
				const revision = actionRevision.current;
				return GenUI.refresh().then((result) => {
					if (inFlight.current || revision !== actionRevision.current || result.status !== "success") return;
					const response = result.response;
					if (response?.status !== "success" || response.data?.poll_id !== state.poll_id) return;
					return () => setAck({
						source: sourceKey,
						state: {
							...state,
							...response.data
						}
					});
				});
			}
		}), /* @__PURE__ */ __dil.jsx("col", { gap: 4 }, state.role_loading ? /* @__PURE__ */ __dil.jsx("text", { color: "secondary" }, "Loading poll…") : /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("box", GenUI.logEvent && !state.is_unfurl_preview ? { onVisible: () => GenUI.logEvent?.({
			event_name: "chatgpt_interactive_poll_visible",
			event_data: {
				widget_name: "create_interactive_poll",
				poll_id: state.poll_id,
				shared_post_id: state.shared_post_id,
				surface: state.shared_post ? "shared_post" : "conversation",
				role: state.is_creator ? "creator" : "receiver",
				lifecycle: state.lifecycle,
				...state.is_creator && state.lifecycle === "draft" ? {
					draft_edit_analytics_version: 1,
					draft_edit_renderer: "dil_v2"
				} : {},
				presentation: "poll"
			}
		}) } : {}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.is_creator && state.lifecycle === "draft" ? "You’re in editing mode" : state.lifecycle !== "draft" ? state.vote_summary_labels[String(vote.total_votes)] : "This poll is not published yet.")), state.is_creator && state.lifecycle === "draft" ? /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx("input", {
			variant: "plain",
			size: "md",
			"aria-label": "Poll question",
			placeholder: "What should people choose?",
			value: draft.question,
			disabled: actionPending,
			onChange: (value) => {
				const question = value;
				if (question !== draft.question) updateDraft({
					...draft,
					question
				}, "question_changed");
			}
		}), questionCount > 240 && /* @__PURE__ */ __dil.jsx("box", { role: "alert" }, /* @__PURE__ */ __dil.jsx("text", { color: "danger" }, state.question_length_error || "Keep the question to 240 characters or fewer.")), /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, draft.options.slice(0, draft.visible_option_count).map((option, index) => /* @__PURE__ */ __dil.jsx("row", {
			key: option.id,
			gap: 0,
			align: "start",
			minHeight: 44
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: 24,
			height: 44,
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("box", {
			size: 24,
			radius: "full",
			border: {
				size: 1,
				color: "strong"
			}
		})), /* @__PURE__ */ __dil.jsx("row", {
			flex: 1,
			gap: 0,
			minHeight: 45,
			padding: {
				left: 4,
				y: 2
			},
			border: { bottom: {
				size: 1,
				color: "default"
			} }
		}, /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("input", {
			variant: "plain",
			size: "sm",
			"aria-label": \`Poll option \${index + 1}\`,
			placeholder: "Add option",
			value: option.label,
			disabled: actionPending,
			onChange: (value) => changeOption(index, value)
		}), characterCount(option.label) > 120 && /* @__PURE__ */ __dil.jsx("box", { role: "alert" }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "danger"
		}, state.option_length_error || "Keep each option to 120 characters or fewer."))), (option.label !== "" || index !== draft.visible_option_count - 1) && /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: "Remove option",
			width: 32,
			height: 28,
			padding: 0,
			disabled: actionPending || option.label !== "" && draft.options.filter((candidate) => candidate.label !== "").length <= 2,
			onClick: () => {
				const blank = {
					id: \`draft-v2-\${state.poll_id}-\${nextOption.current++}\`,
					label: "",
					vote_count: 0,
					vote_percent: "0%"
				};
				updateDraft({
					...draft,
					options: [...draft.options.filter((candidate) => candidate.id !== option.id), blank],
					visible_option_count: draft.visible_option_count === 20 && draft.options[19].label !== "" ? 20 : draft.visible_option_count - 1
				}, option.label === "" ? null : "option_removed");
			}
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "x",
			size: "sm",
			color: "secondary"
		})))))), /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			padding: {
				x: 0,
				y: 3
			},
			"aria-pressed": draft.allow_multiple_votes,
			disabled: actionPending,
			onClick: () => updateDraft({
				...draft,
				allow_multiple_votes: !draft.allow_multiple_votes
			}, "multiple_votes_changed")
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			justify: "between",
			gap: 3
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium"
		}, state.allow_multiple_votes_label), /* @__PURE__ */ __dil.jsx("row", {
			width: 42,
			height: 24,
			padding: {
				x: .5,
				y: 2
			},
			radius: "full",
			background: draft.allow_multiple_votes ? "#0d0d0d" : "alpha-20",
			align: "center",
			justify: draft.allow_multiple_votes ? "end" : "start"
		}, /* @__PURE__ */ __dil.jsx("box", {
			size: 20,
			radius: "full",
			background: "white"
		})))), /* @__PURE__ */ __dil.jsx("row", { justify: "end" }, /* @__PURE__ */ __dil.jsx("button", {
			loading: actionPending,
			disabled: !ready || actionPending || !canShare || questionCount === 0 || questionCount > 240 || validOptions.some((option) => characterCount(option.label) > 120) || validOptions.length < 2,
			onClick: () => void action("interactive_poll_v2_publish", {
				question: normalized(draft.question),
				options: validOptions.map(({ id, label }) => ({
					id,
					label: normalized(label)
				})),
				allow_multiple_votes: draft.allow_multiple_votes,
				success_action: {
					handler: "client",
					type: "share"
				}
			})
		}, state.share_label))) : state.lifecycle !== "draft" ? /* @__PURE__ */ __dil.jsx("col", { gap: 3 }, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			weight: "semibold"
		}, state.question), state.lifecycle === "published" ? /* @__PURE__ */ __dil.jsx("col", { gap: 1 }, vote.options.filter((option) => option.label !== "").map((option) => /* @__PURE__ */ __dil.jsx("pressable", {
			key: option.id,
			width: "100%",
			padding: {
				x: state.is_creator || vote.submitted ? 3 : 1,
				y: 1
			},
			radius: "4xl",
			"aria-pressed": vote.selected_option_ids.includes(option.id),
			disabled: !canVote,
			onClick: () => {
				const selected = vote.submitted_option_ids;
				const intended = selected.includes(option.id) ? selected.filter((id) => id !== option.id) : state.allow_multiple_votes ? [...selected, option.id] : [option.id];
				action("interactive_poll_v2_vote", {
					selected_option_id: option.id,
					selected_option_ids: intended
				});
			}
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 4,
			minHeight: state.is_creator || vote.submitted ? 40 : 30
		}, /* @__PURE__ */ __dil.jsx("box", {
			size: 24,
			radius: "full",
			align: "center",
			justify: "center",
			background: vote.selected_option_ids.includes(option.id) ? "black" : "transparent",
			border: vote.selected_option_ids.includes(option.id) ? 0 : {
				size: 1,
				color: "strong"
			}
		}, vote.selected_option_ids.includes(option.id) && /* @__PURE__ */ __dil.jsx("icon", {
			name: "check",
			size: "sm",
			color: "white"
		})), /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			gap: 3
		}, /* @__PURE__ */ __dil.jsx("row", {
			justify: "between",
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			textAlign: "start"
		}, option.label), (state.is_creator || vote.submitted) && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, String(option.vote_count))), (state.is_creator || vote.submitted) && /* @__PURE__ */ __dil.jsx("box", {
			height: 5,
			width: "100%",
			radius: "full",
			background: "alpha-10"
		}, /* @__PURE__ */ __dil.jsx("box", {
			height: 5,
			width: maxVotes > 0 ? \`\${Math.round(option.vote_count / maxVotes * 1e3) / 10}%\` : "0%",
			radius: "full",
			background: "blue-400"
		}))))))) : /* @__PURE__ */ __dil.jsx("text", { color: "secondary" }, "This poll is closed."), state.is_creator && state.lifecycle === "published" && /* @__PURE__ */ __dil.jsx("row", { justify: "end" }, canShare && !state.shared_post && /* @__PURE__ */ __dil.jsx("button", {
			disabled: !ready || actionPending,
			onClick: () => GenUI.dispatchAction({
				handler: "client",
				type: "share",
				payload: { component_key: componentKey }
			})
		}, state.share_label))) : null, failed && /* @__PURE__ */ __dil.jsx("box", { role: "alert" }, /* @__PURE__ */ __dil.jsx("text", null, failed)), !ready && !state.is_unfurl_preview && state.lifecycle !== "closed" && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.native_unavailable_label ?? "Publishing and voting aren’t available here."))));
	}
	/** Keep the clock in a renderless child so ticks do not redraw the poll. */
	function PollRefresh({ enabled, read }) {
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
return CreateInteractivePoll;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=create-interactive-poll-977e4127a074.js.map