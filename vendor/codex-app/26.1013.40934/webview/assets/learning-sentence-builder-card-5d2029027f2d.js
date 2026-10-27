import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


//#region learning/primitives/LearningExercisePager.dil.tsx
	function LearningExercisePager({ exercises, previousLabel, nextLabel, nextButtonLabel, progressLabels, newTurnQuery, doneButtonLabel, renderExercise, getResponse, isExerciseComplete = (_, selectedIds$1) => selectedIds$1.length > 0 }) {
		const instanceId = DIL.useId();
		const [viewState, setViewState] = DIL.useState({
			currentId: null,
			answers: {}
		});
		const currentViewState = DIL.useRef(viewState);
		currentViewState.current = viewState;
		const updateViewState = (next) => {
			currentViewState.current = next;
			setViewState(next);
		};
		const index = Math.max(0, exercises.findIndex((exercise$1) => exercise$1.id === viewState.currentId));
		const exercise = exercises[index];
		if (!exercise) return null;
		const answer = viewState.answers[exercise.id];
		const selectedIds = answer?.revision === exercise.revision ? answer.selectedIds : [];
		const canAdvance = index < exercises.length - 1 && isExerciseComplete(exercise.data, selectedIds);
		const revision = JSON.stringify(exercises.map((item) => [item.id, item.revision]));
		const showDone = Boolean(doneButtonLabel && newTurnQuery && index === exercises.length - 1);
		const canFinish = isExerciseComplete(exercise.data, selectedIds) && viewState.submittedRevision !== revision;
		const submitAnswers = (answers, query = newTurnQuery) => {
			const responses = exercises.flatMap((item, itemIndex) => {
				const exerciseAnswer = answers[item.id];
				if (exerciseAnswer?.revision !== item.revision || !exerciseAnswer.selectedIds.length) return [];
				const response = getResponse(item.data, exerciseAnswer.selectedIds);
				return [\`\${itemIndex + 1}. \${response.question}\\n→ \${response.answer}\`];
			});
			GenUI.issueNewTurn([query, ...responses].join("\\n\\n"), {
				append_to_current_leaf: true,
				followup_metadata: {}
			});
		};
		const finish = () => {
			const current = currentViewState.current;
			const currentAnswer = current.answers[exercise.id];
			if (!showDone || current.submittedRevision === revision || currentAnswer?.revision !== exercise.revision || !isExerciseComplete(exercise.data, currentAnswer.selectedIds)) return;
			updateViewState({
				...current,
				submittedRevision: revision
			});
			submitAnswers(current.answers);
		};
		const navigate = (nextIndex) => {
			if (nextIndex > index && !canAdvance) return;
			const next = exercises[nextIndex];
			if (next) updateViewState({
				...currentViewState.current,
				currentId: next.id
			});
		};
		const advanceWithAnswer = (nextIds, getCompletionQuery) => {
			const current = currentViewState.current;
			if ((exercises.find((item) => item.id === current.currentId) ?? exercises[0])?.id !== exercise.id) return;
			const next = exercises[index + 1];
			if (!next && (!newTurnQuery || current.submittedRevision === revision)) return;
			const answers = {
				...current.answers,
				[exercise.id]: {
					revision: exercise.revision,
					selectedIds: nextIds
				}
			};
			updateViewState({
				...current,
				answers,
				...next ? { currentId: next.id } : { submittedRevision: revision }
			});
			if (!next) {
				const completionQuery = getCompletionQuery?.(exercises.map((item) => {
					const exerciseAnswer = answers[item.id];
					return exerciseAnswer?.revision === item.revision ? exerciseAnswer.selectedIds : [];
				}));
				submitAnswers(answers, completionQuery);
			}
		};
		const navigation = exercises.length > 1 ? /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 0,
			flex: "0 0 auto"
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			size: 24,
			radius: "full",
			background: "transparent",
			ariaLabel: previousLabel,
			disabled: index === 0,
			onClick: () => navigate(index - 1)
		}, /* @__PURE__ */ __dil.jsx("box", {
			height: "100%",
			align: "center",
			justify: "center",
			ariaHidden: true
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "chevron-left",
			size: "2xl",
			color: index === 0 ? {
				light: "alpha-70",
				dark: "alpha-35"
			} : "secondary"
		}))), /* @__PURE__ */ __dil.jsx("box", {
			role: "status",
			minWidth: 40,
			height: "24px",
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, progressLabels[index])), /* @__PURE__ */ __dil.jsx("pressable", {
			size: 24,
			radius: "full",
			background: "transparent",
			ariaLabel: nextLabel,
			disabled: !canAdvance,
			onClick: () => navigate(index + 1)
		}, /* @__PURE__ */ __dil.jsx("box", {
			height: "100%",
			align: "center",
			justify: "center",
			ariaHidden: true
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "chevron-right",
			size: "2xl",
			color: canAdvance ? "secondary" : {
				light: "alpha-70",
				dark: "alpha-35"
			}
		})))) : null;
		return /* @__PURE__ */ __dil.jsx("box", {
			key: \`\${instanceId}:\${exercise.id}:\${exercise.revision}\`,
			width: "100vw",
			maxWidth: "100%"
		}, renderExercise(exercise.data, {
			selectedIds,
			advanceWithAnswer: index < exercises.length - 1 || newTurnQuery && viewState.submittedRevision !== revision ? advanceWithAnswer : null,
			setSelectedIds: (update) => {
				const current = currentViewState.current;
				const previous = current.answers[exercise.id];
				const ids = previous?.revision === exercise.revision ? previous.selectedIds : [];
				const nextIds = update(ids);
				const answers = {
					...current.answers,
					[exercise.id]: {
						revision: exercise.revision,
						selectedIds: nextIds
					}
				};
				updateViewState({
					...current,
					answers
				});
				if (newTurnQuery && !doneButtonLabel && index === exercises.length - 1 && !isExerciseComplete(exercise.data, ids) && isExerciseComplete(exercise.data, nextIds)) submitAnswers(answers);
			}
		}, navigation, exercises.length > 1 || showDone ? /* @__PURE__ */ __dil.jsx("row", {
			justify: "end",
			minHeight: "36px"
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			height: "36px",
			ariaLabel: showDone ? doneButtonLabel : nextButtonLabel ?? nextLabel,
			padding: { x: 3.5 },
			radius: "full",
			background: "transparent",
			border: {
				size: 1,
				color: {
					light: "alpha-10",
					dark: "alpha-15"
				}
			},
			align: "center",
			justify: "center",
			disabled: showDone ? !canFinish : !canAdvance,
			onClick: showDone ? finish : () => navigate(index + 1)
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			weight: "medium",
			color: "primary"
		}, showDone ? doneButtonLabel : nextButtonLabel ?? nextLabel))) : null));
	}

//#endregion
//#region learning/primitives/LearningCard.dil.tsx
	function LearningCard({ icon, title, directions, prompt, children, navigation, actions, footer, divider = true, variant = "practice" }) {
		const wide = DIL.useBreakpoint("sm");
		const dictionary = variant === "dictionary";
		const completion = variant === "completion" || variant === "translation";
		const translation = variant === "translation";
		return /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			maxWidth: "100%",
			padding: {
				x: dictionary && !wide ? 4.5 : 5,
				top: dictionary ? wide ? 4 : 3 : 5,
				bottom: dictionary && !wide ? 4.5 : 5
			},
			gap: variant === "dictionary" || variant === "practice" || variant === "listening" ? 4 : 2,
			radius: variant === "listening" ? "32px" : completion || variant === "dictionary" && navigation ? "24px" : "28px",
			background: wide ? {
				light: "gray-25",
				dark: "surface"
			} : "surface",
			border: {
				size: .5,
				color: {
					light: "strong",
					dark: "alpha-05"
				}
			},
			role: "group",
			ariaLabel: title,
			disableAutoSpacing: true
		}, /* @__PURE__ */ __dil.jsx("row", {
			minHeight: dictionary || wide ? "40px" : "44px",
			gap: 2,
			align: "center",
			justify: "between",
			wrap: "wrap"
		}, /* @__PURE__ */ __dil.jsx("row", {
			gap: 1.5,
			align: "center",
			flex: "1 1 auto",
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("box", {
			ariaHidden: true,
			flex: "0 0 auto"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: icon,
			size: variant === "dictionary" ? "2xl" : "xl",
			color: "secondary"
		})), /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			color: "secondary",
			weight: "medium"
		}, title)), /* @__PURE__ */ __dil.jsx("row", {
			gap: 1,
			align: "center",
			flex: "0 0 auto",
			height: dictionary ? "40px" : void 0
		}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, actions))), /* @__PURE__ */ __dil.jsx("col", { gap: completion || variant === "choice" || variant === "listening" ? 2 : 4 }, directions ? /* @__PURE__ */ __dil.jsx("box", { padding: translation ? { y: 1 } : void 0 }, /* @__PURE__ */ __dil.jsx("text", {
			size: translation ? "md" : "sm",
			color: translation ? "primary" : "secondary"
		}, directions)) : null, completion ? /* @__PURE__ */ __dil.jsx("box", { padding: translation ? { top: 2 } : { y: 1 } }, prompt) : /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, prompt), completion ? /* @__PURE__ */ __dil.jsx("col", {
			gap: "15px",
			padding: { top: 3 }
		}, divider ? /* @__PURE__ */ __dil.jsx("box", {
			height: "1px",
			background: "alpha-05",
			role: "separator"
		}) : null, /* @__PURE__ */ __dil.jsx("col", { gap: 4 }, children)) : /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, divider ? /* @__PURE__ */ __dil.jsx("box", {
			height: "1px",
			background: "alpha-05",
			role: "separator"
		}) : null, variant === "dictionary" ? /* @__PURE__ */ __dil.jsx("box", { padding: { top: 1 } }, children) : /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, children))), navigation || footer ? /* @__PURE__ */ __dil.jsx("row", {
			padding: {
				x: dictionary && !wide ? .5 : void 0,
				top: variant === "dictionary" || variant === "practice" || variant === "listening" ? 1 : 3
			},
			align: "center",
			justify: "between",
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("col", {
			minHeight: wide ? void 0 : "44px",
			justify: "center"
		}, navigation), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, footer)) : null);
	}

//#endregion
//#region learning/primitives/LearningFeedback.dil.tsx
	function LearningFeedback({ result, showStatus = true }) {
		if (!result) return null;
		const showCorrection = result.status === "incorrect" && result.correction;
		if (!showStatus && !showCorrection && !result.explanation) return null;
		return /* @__PURE__ */ __dil.jsx("col", {
			role: "status",
			gap: 1,
			padding: { bottom: 2 }
		}, showStatus ? /* @__PURE__ */ __dil.jsx("row", {
			gap: 1.5,
			align: "center"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: result.status === "correct" ? "check" : "x",
			size: "md",
			color: result.status === "correct" ? "success" : "danger"
		}), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: result.status === "correct" ? "success" : "danger"
		}, result.label)) : null, showCorrection ? /* @__PURE__ */ __dil.jsx("col", { gap: 1 }, result.correctionLabel ? /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, result.correctionLabel) : null, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			color: "primary",
			preserveWhitespace: true
		}, result.correction)) : null, result.explanation ? /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, result.explanation) : null);
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
//#region learning/primitives/LearningChoicePill.dil.tsx
	function LearningChoicePill({ label, selected, result, order, disabled, onSelect }) {
		const status = result?.status;
		const resultColor = status === "correct" ? "success" : status === "incorrect" ? "danger" : void 0;
		const dimmed = (disabled || selected) && !status;
		const pill = /* @__PURE__ */ __dil.jsx("row", {
			minHeight: "40px",
			maxWidth: "100%",
			padding: { x: 4 },
			gap: 2,
			align: "center",
			justify: "center",
			radius: "full",
			background: resultColor ?? (dimmed ? {
				light: "alpha-01",
				dark: "alpha-04"
			} : {
				light: "alpha-04",
				dark: "alpha-10"
			}),
			border: resultColor ? {
				size: 1,
				color: resultColor
			} : void 0
		}, result ? /* @__PURE__ */ __dil.jsx("box", {
			role: "img",
			ariaLabel: result.label,
			flex: "0 0 auto"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: status === "correct" ? "check" : "x",
			size: "md",
			color: resultColor
		})) : null, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			textAlign: "center",
			color: dimmed ? "alpha-35" : "primary"
		}, label));
		return /* @__PURE__ */ __dil.jsx("pressable", {
			maxWidth: "100%",
			background: "transparent",
			radius: "full",
			ariaPressed: selected,
			ariaLabel: result ? \`\${result.label} \${label}\` : order !== void 0 ? \`\${order}. \${label}\` : label,
			onClick: () => {
				if (!disabled && !selected) onSelect();
			}
		}, pill);
	}

//#endregion
//#region learning/primitives/LearningSentence.dil.tsx
	function LearningSentence({ parts, answers, answerStatuses, statusLabels, blankStyle = "inline" }) {
		if (blankStyle === "pill") {
			const activeIndex = answers.findIndex((answer) => answer === null);
			const lines = [[]];
			parts.forEach((part, index) => {
				part.split(/\\r\\n|\\r|\\n/).forEach((text, lineIndex) => {
					if (lineIndex > 0) lines.push([]);
					lines[lines.length - 1].push({ text });
				});
				if (index < answers.length) lines[lines.length - 1].push({
					text: "",
					answerIndex: index
				});
			});
			return /* @__PURE__ */ __dil.jsx("col", { gap: 2 }, lines.map((line, lineIndex) => /* @__PURE__ */ __dil.jsx("row", {
				key: lineIndex,
				gap: answers.length > 1 ? 2 : 1,
				align: "center",
				wrap: "wrap",
				minHeight: "40px"
			}, line.map(({ text, answerIndex }, index) => /* @__PURE__ */ __dil.jsx(SentenceSlotPart, {
				key: index,
				text,
				answer: answerIndex === void 0 ? void 0 : answers[answerIndex],
				active: answerIndex === activeIndex,
				statusLabels,
				wordBank: answers.length > 1,
				status: answerIndex !== void 0 ? answerStatuses?.[answerIndex] : void 0
			})))));
		}
		return /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			color: "primary",
			preserveWhitespace: true
		}, parts.map((part, index) => /* @__PURE__ */ __dil.jsx(SentencePart, {
			key: index,
			text: part,
			answer: answers[index],
			status: answerStatuses?.[index]
		})));
	}
	function SentenceSlotPart({ text, answer, active, status, statusLabels, wordBank }) {
		const resultColor = status === "correct" ? "success" : status === "incorrect" ? "danger" : void 0;
		return /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, text && (!wordBank || text.trim()) ? /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			color: "primary",
			preserveWhitespace: true
		}, text) : null, answer !== void 0 ? /* @__PURE__ */ __dil.jsx("box", {
			role: status ? "img" : void 0,
			ariaLabel: status && statusLabels ? \`\${statusLabels[status]} \${answer}\` : void 0,
			maxWidth: "100%",
			flex: "0 0 auto",
			minHeight: "40px",
			justify: "center",
			padding: {
				x: wordBank ? 4 : 3,
				y: 1
			},
			radius: "full",
			background: status === "correct" ? "green-a25" : status === "incorrect" ? "red-a25" : answer ? {
				light: "gray-50",
				dark: "gray-200"
			} : active ? "blue-a50" : "transparent",
			border: {
				size: 1,
				color: status === "correct" ? "success" : status === "incorrect" ? "danger" : answer ? "alpha-05" : active ? "blue-400" : "strong",
				style: active || answer ? "solid" : "dashed"
			}
		}, /* @__PURE__ */ __dil.jsx("box", { minHeight: "26px" }, /* @__PURE__ */ __dil.jsx("box", { width: answer === null ? wordBank ? "49px" : "57px" : void 0 }, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			textAlign: "center",
			color: resultColor ?? "primary"
		}, answer ?? "\\xA0")))) : null);
	}
	function SentencePart({ text, answer, status }) {
		return /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, text, answer !== void 0 ? answer === null ? /* @__PURE__ */ __dil.jsx("text", { inline: true }, "__________") : /* @__PURE__ */ __dil.jsx("text", {
			inline: true,
			highlight: status === "correct" ? "green" : status === "incorrect" ? "pink" : true,
			color: status === "correct" ? "success" : status === "incorrect" ? "danger" : void 0,
			weight: "medium"
		}, answer) : null);
	}

//#endregion
//#region learning/primitives/LearningWordBank.dil.tsx
	function LearningWordBank({ options, selectedIds, disabled, onSelect }) {
		return /* @__PURE__ */ __dil.jsx("row", {
			gap: 2,
			justify: "start",
			align: "center",
			wrap: "wrap"
		}, options.map((option) => {
			const index = selectedIds.indexOf(option.id);
			return /* @__PURE__ */ __dil.jsx(LearningChoicePill, {
				key: option.id,
				label: option.label,
				selected: index !== -1,
				order: index === -1 ? void 0 : index + 1,
				disabled,
				onSelect: () => onSelect(option.id)
			});
		}));
	}

//#endregion
//#region learning/cards/LearningSentenceBuilderCard.dil.tsx
	function LearningSentenceBuilderCard$1(props) {
		return /* @__PURE__ */ __dil.jsx(LearningExercisePager, {
			...props,
			getResponse: (data, selectedIds) => ({
				question: [data.directions, data.sentence].filter(Boolean).join("\\n"),
				answer: selectedIds.map((id) => data.options.find((option) => option.id === id)?.label ?? "").join(" · ")
			}),
			isExerciseComplete: (data, selectedIds) => selectedIds.length === data.correctOptionIds.length,
			renderExercise: (data, selection, navigation, footer) => /* @__PURE__ */ __dil.jsx(SentenceBuilderExercise, {
				...data,
				selection,
				navigation,
				footer
			})
		});
	}
	function SentenceBuilderExercise({ title, selection, navigation, footer, sentence, options, correctOptionIds, feedback, correctLabel, incorrectLabel, correctSentenceLabel, undoLabel, directions }) {
		const wide = DIL.useBreakpoint("sm");
		const { selectedIds, setSelectedIds } = selection;
		const parts = sentence.split("{{blank}}");
		const blankCount = parts.length - 1;
		const complete = selectedIds.length === blankCount;
		const answers = parts.slice(1).map((_, index) => options.find((option) => option.id === selectedIds[index])?.label ?? null);
		const correctAnswers = correctOptionIds.map((id) => options.find((option) => option.id === id)?.label ?? "");
		const answerStatuses = complete ? answers.map((answer, index) => answer === correctAnswers[index] ? "correct" : "incorrect") : void 0;
		const correct = answerStatuses?.every((status) => status === "correct") ?? false;
		const result = complete ? {
			status: correct ? "correct" : "incorrect",
			label: correct ? correctLabel : incorrectLabel,
			correction: parts.map((part, index) => part + (correctAnswers[index] ?? "")).join(""),
			correctionLabel: correctSentenceLabel ?? correctLabel,
			explanation: feedback
		} : null;
		return /* @__PURE__ */ __dil.jsx(LearningCard, {
			icon: "align-left",
			variant: "translation",
			title,
			navigation,
			footer,
			directions,
			prompt: /* @__PURE__ */ __dil.jsx("row", {
				gap: wide ? 2 : 1.5,
				align: "start"
			}, /* @__PURE__ */ __dil.jsx("box", {
				flex: "1 1 0",
				minWidth: 0
			}, /* @__PURE__ */ __dil.jsx(LearningSentence, {
				blankStyle: "pill",
				statusLabels: {
					correct: correctLabel,
					incorrect: incorrectLabel
				},
				parts,
				answers,
				answerStatuses: answerStatuses?.map((status) => !correct && status === "correct" ? void 0 : status)
			})), !complete ? /* @__PURE__ */ __dil.jsx("pressable", {
				ariaLabel: undoLabel,
				tooltip: undoLabel,
				disabled: selectedIds.length === 0 || complete,
				width: "40px",
				height: "40px",
				flex: "0 0 auto",
				radius: "full",
				background: "transparent",
				onClick: () => setSelectedIds((current) => current.length < blankCount ? current.slice(0, -1) : current)
			}, /* @__PURE__ */ __dil.jsx("box", {
				height: "100%",
				align: "center",
				justify: "center",
				ariaHidden: true
			}, /* @__PURE__ */ __dil.jsx("icon", {
				name: "undo",
				size: "2xl",
				color: "secondary"
			}))) : /* @__PURE__ */ __dil.jsx("box", {
				width: "40px",
				height: "40px",
				flex: "0 0 auto",
				ariaHidden: true
			}))
		}, /* @__PURE__ */ __dil.jsx(LearningWordBank, {
			options,
			selectedIds,
			disabled: complete,
			onSelect: (id) => setSelectedIds((current) => current.length < blankCount && !current.includes(id) ? [...current, id] : current)
		}), /* @__PURE__ */ __dil.jsx(LearningFeedback, {
			result,
			showStatus: false
		}));
	}

//#endregion
//#region LearningSentenceBuilderCard.dil.tsx
	function LearningSentenceBuilderCard(props) {
		const { state } = useResolvedComponentResult("LearningSentenceBuilderCard", props);
		if (state) return /* @__PURE__ */ __dil.jsx(LearningSentenceBuilderCard$1, state);
		if ("progressLabels" in props) return /* @__PURE__ */ __dil.jsx(LearningSentenceBuilderCard$1, props);
		return props.fallback ?? null;
	}

//#endregion
return LearningSentenceBuilderCard;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=learning-sentence-builder-card-5d2029027f2d.js.map