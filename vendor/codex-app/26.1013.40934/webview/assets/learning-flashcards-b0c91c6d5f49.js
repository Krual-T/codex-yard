import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


//#region ../SpeechSynthesizer.dil.tsx
	const unavailable = {
		available: false,
		status: "idle",
		error: null,
		play: () => {},
		stop: () => {}
	};
	const { useSpeechSynthesizer = () => unavailable } = DIL;
	function SpeechSynthesizer({ controls, disabled = false, logging, playbackSpeed = 1, ...source }) {
		const speech = useSpeechSynthesizer({
			...source,
			playbackSpeed
		}, logging);
		DIL.useEffect(() => {
			if (disabled) speech.stop();
		}, [disabled, speech.stop]);
		const play = () => {
			if (!disabled) speech.play();
		};
		const stop = () => {
			if (!disabled) speech.stop();
		};
		if (controls) return controls({
			...speech,
			play,
			stop
		});
		if (!speech.available) return /* @__PURE__ */ __dil.jsx("text", null, "Audio unavailable");
		return speech.status === "idle" ? /* @__PURE__ */ __dil.jsx("button", {
			disabled,
			onClick: play
		}, "Play") : /* @__PURE__ */ __dil.jsx("button", { onClick: stop }, "Stop");
	}

//#endregion
//#region internal/learning-flashcards.dil.tsx
	function progressFromState(state) {
		return {
			current_index: state.current_index,
			flipped: state.flipped,
			card_order: state.card_order,
			shuffle_index: state.shuffle_index,
			revision: state.revision,
			missed_indices: state.missed_indices,
			answer_history: state.answer_history,
			phase: state.phase
		};
	}
	function saveProgress(type, progress) {
		return GenUI.dispatchAction({
			handler: "server",
			loadingBehavior: "none",
			type,
			payload: progress
		});
	}
	function FlashcardAnswerButton({ isMobile, disabled, label, icon, feedback, onClick }) {
		const color = icon === "x" ? "#EE7C37" : "#04B84C";
		const background = feedback === 1 ? color : feedback > 0 ? isMobile ? \`rgba(\${icon === "x" ? "238, 124, 55" : "4, 184, 76"}, \${feedback})\` : \`color-mix(in srgb, \${color} \${feedback * 100}%, var(--color-surface))\` : void 0;
		return /* @__PURE__ */ __dil.jsx("pressable", {
			size: 40,
			padding: 0,
			align: "center",
			justify: "center",
			border: {
				size: 1,
				color: "subtle"
			},
			radius: "full",
			variant: isMobile ? void 0 : "ghost",
			disabled,
			ariaLabel: label,
			tooltip: !isMobile && !disabled ? label : void 0,
			onClick
		}, /* @__PURE__ */ __dil.jsx("box", {
			size: "100%",
			align: "center",
			justify: "center",
			radius: "full",
			background
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: icon,
			size: "2xl",
			color: feedback >= .5 ? "white" : "primary"
		})));
	}
	function FlashcardFace({ face, rawFace, height, label, hint, back = false, disabled = false, onClick }) {
		const singleCharacter = Array.from(rawFace.trim()).length === 1;
		const length = Array.from(rawFace).length;
		const list = /(^|\\n)[ ]{0,3}([-+*]|[0-9]+[.)])[ ]+/.test(rawFace);
		const multiline = rawFace.includes("\\n");
		const compact = length > 56 || back && multiline;
		const fontSize = singleCharacter ? 48 : length > 200 ? 12 : length > 120 ? 15 : compact ? 17 : length > 20 ? 20 : 22;
		const lineHeight = singleCharacter ? 56 : length > 200 ? 17 : length > 120 ? 21 : compact ? 24 : length > 20 ? 25 : 28;
		return /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			height,
			padding: {
				x: 5,
				y: 5
			},
			clip: true,
			radius: 32,
			border: {
				size: .5,
				color: "subtle"
			},
			background: {
				light: "gray-0",
				dark: "gray-200"
			},
			disabled,
			ariaLabel: label,
			onClick
		}, /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			height: "100%",
			gap: 3,
			align: "stretch"
		}, /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			flex: 1,
			minHeight: 0,
			justify: list || back && multiline ? "start" : "center",
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("text-only-markdown", {
			includeMath: true,
			fontSize,
			lineHeight,
			textAlign: list ? "start" : "center"
		}, face)), hint && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "tertiary",
			textAlign: "center"
		}, hint)));
	}
	function FlashcardsView({ state, componentName, resolutionId }) {
		const appData = DIL.useAppData();
		const canSaveNow = state.generation_complete && (appData.opGenui?.componentResults === void 0 || appData.opGenui.nativeServerActions?.ready === true);
		const canSave = canSaveNow || !state.generation_complete;
		const isMobile = DIL.useIsMobile();
		const large = DIL.useBreakpoint("lg");
		const [progress, setProgress] = DIL.useState(progressFromState(state));
		const [receivedCardOrder, setReceivedCardOrder] = DIL.useState(state.card_order);
		DIL.useState(true);
		const [dismissed, setDismissed] = DIL.useState(state.dismissed);
		const [motionBusy, setMotionBusy] = DIL.useState(false);
		const [motion, setMotion] = DIL.useState();
		const [swipeProgress, setSwipeProgress] = DIL.useState(0);
		const [answerFeedback, setAnswerFeedback] = DIL.useState(null);
		const hintDeck = state.deck_instance_id ?? null;
		const [dismissedHintDeck, setDismissedHintDeck] = DIL.useState();
		const tapVisible = state.tap_to_flip_visible && dismissedHintDeck !== hintDeck;
		const [pendingNextIndex, setPendingNextIndex] = DIL.useState(-1);
		const [pendingFlush, setPendingFlush] = DIL.useState(false);
		const [menuNonce, setMenuNonce] = DIL.useState(0);
		const [reviewPass, setReviewPass] = DIL.useState({
			deck_instance_id: state.deck_instance_id ?? null,
			review_pass_id: state.review_pass_id ?? null,
			review_pass_kind: state.review_pass_kind ?? null,
			revision: state.revision
		});
		const currentReviewPass = state.revision >= reviewPass.revision || (state.deck_instance_id ?? null) !== reviewPass.deck_instance_id ? state : reviewPass;
		const newCards = (currentReviewPass.review_pass_kind == null || currentReviewPass.review_pass_kind === "full") && progress.card_order.length === receivedCardOrder.length ? state.card_order.filter((card$1) => !receivedCardOrder.includes(card$1)) : [];
		const cardOrder = [...progress.card_order, ...newCards.filter((card$1) => !progress.card_order.includes(card$1))];
		const waiting = pendingNextIndex >= cardOrder.length && !state.generation_complete;
		const pendingCardAvailable = pendingNextIndex >= 0 && pendingNextIndex < cardOrder.length;
		const resumeAfterAppend = progress.phase === "summary" && newCards.length > 0;
		const currentIndex = pendingCardAvailable ? pendingNextIndex : resumeAfterAppend ? progress.card_order.length : progress.current_index;
		const phase = state.phase === "error" ? "error" : !isMobile && !state.generation_complete && state.card_order.length < 2 && progress.answer_history.length === 0 ? "loading" : pendingNextIndex >= cardOrder.length && state.generation_complete ? "summary" : resumeAfterAppend ? "ready" : progress.phase;
		const flipped = pendingCardAvailable || resumeAfterAppend ? false : progress.flipped;
		DIL.useEffect(() => {
			if (phase !== "ready" || dismissed) {
				setAnswerFeedback(null);
				setSwipeProgress(0);
				setMotionBusy(false);
			}
		}, [phase, dismissed]);
		const currentProgress = {
			...progress,
			current_index: currentIndex,
			card_order: cardOrder,
			phase,
			flipped
		};
		const showHint = phase === "ready" && currentIndex === 0 && !flipped && progress.answer_history.length === 0 && tapVisible;
		const hintLabels = (isMobile ? state.onboarding_mobile_labels : state.onboarding_web_labels) ?? [state.tap_to_flip_label];
		const cycleHint = showHint && hintLabels.length === 3;
		const now = DIL.useNow?.(cycleHint || answerFeedback !== null || canSaveNow && pendingFlush, answerFeedback ? 50 : 1e3) ?? 0;
		DIL.useEffect(() => {
			if (!answerFeedback) return;
			if (!DIL.useNow) setAnswerFeedback(null);
			else if (answerFeedback.startedAt === null) setAnswerFeedback({
				...answerFeedback,
				startedAt: now
			});
			else if (now - answerFeedback.startedAt >= 240) setAnswerFeedback(null);
		}, [answerFeedback, now]);
		const dragFeedback = Math.min(Math.abs(swipeProgress) / 10, 1);
		const leftFeedback = answerFeedback?.direction === "left" ? 1 : swipeProgress < 0 ? dragFeedback : 0;
		const rightFeedback = answerFeedback?.direction === "right" ? 1 : swipeProgress > 0 ? dragFeedback : 0;
		const [hintClock, setHintClock] = DIL.useState(null);
		const flushStartedAt = DIL.useRef(null);
		const hintStartedAt = hintClock?.deck === hintDeck ? hintClock.startedAt : null;
		const hintStep = hintStartedAt === null ? 0 : Math.max(0, Math.floor((now - hintStartedAt) / 3e3)) % 3;
		DIL.useEffect(() => {
			if (cycleHint && hintStartedAt === null) setHintClock({
				deck: hintDeck,
				startedAt: now
			});
		}, [
			cycleHint,
			now,
			hintStartedAt,
			hintDeck
		]);
		DIL.useEffect(() => {
			if (state.revision > progress.revision || progress.phase === "loading" && state.phase !== "loading") {
				setProgress(progressFromState(state));
				setReceivedCardOrder(state.card_order);
			} else if (newCards.length > 0) {
				setProgress(currentProgress);
				setReceivedCardOrder(state.card_order);
			}
		}, [state]);
		DIL.useEffect(() => {
			if (pendingNextIndex >= 0 && (pendingCardAvailable || state.generation_complete)) {
				setProgress(currentProgress);
				setPendingNextIndex(-1);
			}
		}, [
			pendingNextIndex,
			pendingCardAvailable,
			state.generation_complete
		]);
		DIL.useEffect(() => {
			if (!canSaveNow || !pendingFlush) {
				flushStartedAt.current = null;
				return;
			}
			if (flushStartedAt.current === null) flushStartedAt.current = now;
			if (typeof DIL.useNow === "function" && now - flushStartedAt.current < 5e3) return;
			flushStartedAt.current = null;
			setPendingFlush(false);
			saveProgress("learning_flashcards_save_progress", currentProgress);
		}, [
			canSaveNow,
			pendingFlush,
			now
		]);
		function commit(next, type, change) {
			if (!canSave) return;
			setProgress(next);
			if (change && appData.opGenui?.supportedClientActions?.includes("update_flashcard_progress")) GenUI.dispatchAction({
				handler: "client",
				type: "update_flashcard_progress",
				payload: {
					component_name: componentName,
					component_key: resolutionId,
					...change
				}
			});
			if (!canSaveNow || pendingFlush) setPendingFlush(true);
			else {
				setPendingFlush(false);
				saveProgress(type, next);
			}
		}
		function rateCard(direction) {
			if (!canSave || waiting || phase !== "ready") return;
			setAnswerFeedback({
				direction,
				startedAt: null
			});
			setMotion({
				kind: "dismiss",
				direction
			});
			const cardIndex$1 = cardOrder[currentIndex];
			const ratedCardId = state.cards[cardIndex$1]?.id;
			const wasMissed = progress.missed_indices.includes(cardIndex$1);
			const missed = progress.missed_indices.filter((card$1) => card$1 !== cardIndex$1);
			if (direction === "left" && !wasMissed) missed.push(cardIndex$1);
			const last = currentIndex === cardOrder.length - 1;
			commit({
				...currentProgress,
				current_index: last ? currentIndex : currentIndex + 1,
				flipped: false,
				missed_indices: missed,
				answer_history: [...progress.answer_history, {
					current_index: currentIndex,
					flipped,
					was_missed: wasMissed,
					swipe_direction: direction
				}],
				phase: last && state.generation_complete ? "summary" : "ready",
				revision: progress.revision + 1
			}, "learning_flashcards_save_progress", ratedCardId ? {
				card_id: ratedCardId,
				outcome: missed.includes(cardIndex$1) ? "missed" : "known"
			} : void 0);
			setPendingNextIndex(last && !state.generation_complete ? currentIndex + 1 : -1);
			setDismissedHintDeck(hintDeck);
		}
		function undo() {
			if (!canSave) return;
			const last = progress.answer_history[progress.answer_history.length - 1];
			if (!last) return;
			setAnswerFeedback(null);
			const cardIndex$1 = cardOrder[last.current_index];
			const undoneCardId = state.cards[cardIndex$1]?.id;
			setMotion({
				kind: "restore",
				direction: last.swipe_direction ?? (progress.missed_indices.includes(cardIndex$1) ? "left" : "right")
			});
			const missed = last.was_missed != null ? [...progress.missed_indices.filter((card$1) => card$1 !== cardIndex$1), ...last.was_missed ? [cardIndex$1] : []] : last.missed_indices ?? [];
			commit({
				...currentProgress,
				current_index: last.current_index,
				flipped: last.flipped,
				missed_indices: missed,
				answer_history: progress.answer_history.filter((previousAnswer) => previousAnswer.current_index !== last.current_index),
				phase: "ready",
				revision: progress.revision + 1
			}, "learning_flashcards_save_progress", undoneCardId ? {
				card_id: undoneCardId,
				outcome: "unreviewed"
			} : void 0);
			setPendingNextIndex(-1);
			setDismissedHintDeck(hintDeck);
			setMenuNonce(menuNonce + 1);
		}
		function shuffle() {
			if (cardOrder.length < 2 || state.shuffle_orders.length === 0 || !canSaveNow || pendingFlush) return;
			setAnswerFeedback(null);
			setMotion(void 0);
			const reviewed = cardOrder.slice(0, currentIndex);
			let remaining = state.shuffle_orders[progress.shuffle_index % state.shuffle_orders.length].filter((card$1) => cardOrder.includes(card$1) && !reviewed.includes(card$1));
			if (remaining.length > 1 && remaining[0] === cardOrder[currentIndex]) remaining = [...remaining.slice(1), remaining[0]];
			commit({
				...currentProgress,
				card_order: [...reviewed, ...remaining],
				flipped: false,
				shuffle_index: progress.shuffle_index + 1,
				phase: "ready",
				revision: progress.revision + 1
			}, "learning_flashcards_shuffle");
			setDismissedHintDeck(hintDeck);
			setMenuNonce(menuNonce + 1);
		}
		function restart(reviewMissed) {
			if (!canSaveNow || pendingFlush) return;
			celebration.current = {
				completed: false,
				trigger: null
			};
			const nextCardOrder = reviewMissed ? progress.missed_indices : state.original_review_order.length > 0 ? state.original_review_order : state.original_order;
			setReceivedCardOrder(nextCardOrder);
			setMotion(void 0);
			setReviewPass({
				deck_instance_id: state.deck_instance_id ?? null,
				review_pass_id: state.deck_instance_id ? \`\${state.deck_instance_id}:\${progress.revision + 1}\` : null,
				review_pass_kind: reviewMissed ? "missed" : state.original_review_order.length > 0 && state.original_review_order.length < state.original_order.length ? "subset" : "full",
				revision: progress.revision + 1
			});
			commit({
				current_index: 0,
				flipped: false,
				missed_indices: [],
				answer_history: [],
				card_order: nextCardOrder,
				shuffle_index: 0,
				phase: "ready",
				revision: progress.revision + 1
			}, reviewMissed ? "learning_flashcards_review_missed" : "learning_flashcards_restart");
			setPendingNextIndex(-1);
		}
		const cardIndex = cardOrder[currentIndex];
		const card = state.cards[cardIndex];
		const displayCard = state.display_cards[cardIndex];
		const hasCompleteDisplayCard = currentIndex >= 0 && currentIndex < cardOrder.length && cardIndex >= 0 && cardIndex < state.display_cards.length && displayCard.front.length > 0 && displayCard.back.length > 0;
		const cardId = card?.id ?? null;
		const cardInstanceId = state.card_instance_ids?.[cardIndex] ?? null;
		const cardViewIdentity = cardInstanceId ? \`instance:\${cardInstanceId}\` : cardId ? \`card:\${cardId}\` : null;
		const cardEventData = {
			analytics_version: 1,
			deck_id: state.library_file_id || state.deck_instance_id || null,
			deck_instance_id: state.deck_instance_id ?? null,
			library_file_id: state.library_file_id ?? null,
			deck_version: state.deck_version ?? null,
			review_pass_id: currentReviewPass.review_pass_id ?? null,
			pass_kind: currentReviewPass.review_pass_kind ?? null,
			card_id: cardId,
			card_instance_id: cardInstanceId,
			card_position: currentIndex + 1,
			card_number: currentIndex + 1,
			card_count: cardOrder.length,
			card_face: flipped ? "back" : "front",
			surface: "widget",
			source: "ui"
		};
		const logViewStarted = DIL.useCallback(() => GenUI.logEvent?.({
			event_name: "chatgpt_learning_flashcards_view_started",
			statsig_event_name: "chatgpt_learning_flashcards_view_started",
			event_data: { initial_phase: state.phase }
		}), [state.phase]);
		const logErrorPresented = DIL.useCallback(() => GenUI.logEvent?.({
			event_name: "chatgpt_learning_flashcards_error_presented",
			statsig_event_name: "chatgpt_learning_flashcards_error_presented",
			event_data: {}
		}), []);
		const logPresented = DIL.useCallback(() => GenUI.logEvent?.({
			event_name: "chatgpt_learning_flashcards_presented",
			statsig_event_name: "chatgpt_learning_flashcards_presented",
			event_data: {
				card_count: cardOrder.length,
				phase
			}
		}), [cardOrder.length, phase]);
		const logCardViewed = DIL.useCallback(() => GenUI.logEvent?.({
			event_name: "chatgpt_learning_flashcards_card_viewed",
			statsig_event_name: "chatgpt_learning_flashcards_card_viewed",
			event_data: cardEventData
		}), [
			state.library_file_id,
			state.deck_instance_id,
			state.deck_version,
			currentReviewPass.review_pass_id,
			currentReviewPass.review_pass_kind,
			cardId,
			cardInstanceId,
			currentIndex,
			cardOrder.length,
			flipped
		]);
		const shuffleAnimationActive = !state.reduced_motion && !!state.shuffle_phase && state.shuffle_revision === progress.revision && state.shuffle_primary_card != null && state.shuffle_secondary_card != null && progress.current_index + 1 < cardOrder.length;
		const canReportPresentation = cardOrder.length > 0 && (phase === "ready" && !waiting && hasCompleteDisplayCard || phase === "summary" && state.generation_complete && progress.answer_history.length === cardOrder.length);
		const canReportCardView = cardViewIdentity != null && phase === "ready" && !waiting && !motionBusy && state.interaction_state !== "restoring" && !shuffleAnimationActive && hasCompleteDisplayCard && cardOrder.every((index) => index >= 0 && index < state.cards.length && index < state.display_cards.length);
		const rawFace = (flipped ? card?.back : card?.front) ?? "";
		const cardHeight = !isMobile && large ? 240 : 180;
		const correctCount = cardOrder.length - progress.missed_indices.length;
		const summary = progress.missed_indices.length === 0 ? state.perfect_summary_label : correctCount * 2 < cardOrder.length ? state.low_score_summary_label : state.percentage_summary_labels[Math.round(correctCount * 100 / cardOrder.length)];
		const framed = !isMobile && phase !== "error";
		const supportedClientActions = appData.opGenui?.supportedClientActions ?? [];
		const showEdit = Boolean(state.library_file_id && card?.id) && supportedClientActions.includes("edit_flashcard");
		const showViewAll = Boolean(state.library_file_id) && supportedClientActions.includes("view_flashcards");
		const canOpenSavedDeck = Boolean(state.library_file_id) && canSaveNow && !pendingFlush && !waiting && !motionBusy;
		const celebration = DIL.useRef({
			completed: phase === "summary",
			trigger: null
		});
		const perfectReview = phase === "summary" && state.generation_complete && cardOrder.length > 0 && progress.answer_history.length === cardOrder.length && progress.missed_indices.length === 0;
		const celebrationTrigger = state.celebrations_enabled && !state.reduced_motion && perfectReview ? celebration.current.trigger ?? (celebration.current.completed ? null : String(progress.revision)) : null;
		DIL.useEffect(() => {
			celebration.current = {
				completed: celebration.current.completed || phase === "summary",
				trigger: celebrationTrigger
			};
		}, [phase, celebrationTrigger]);
		function flip() {
			if (waiting || motionBusy) return;
			if (!flipped) GenUI.dispatchAction({
				handler: "client",
				type: "log_event",
				payload: {
					event_name: "chatgpt_learning_flashcards_card_flipped",
					statsig_event_name: "chatgpt_learning_flashcards_card_flipped",
					event_data: {
						card_count: cardOrder.length,
						card_number: currentIndex + 1
					}
				}
			});
			setMotion(void 0);
			setProgress({
				...currentProgress,
				flipped: !flipped
			});
			setDismissedHintDeck(hintDeck);
		}
		function openSavedDeck(view) {
			if (!canOpenSavedDeck || (view === "edit" ? !showEdit || !card?.id : !showViewAll)) return;
			GenUI.dispatchAction({
				handler: "client",
				type: view === "edit" ? "edit_flashcard" : "view_flashcards",
				payload: {
					event_data: cardEventData,
					library_file_id: state.library_file_id,
					library_artifact_type: "flashcards",
					view,
					...resolutionId ? {
						component_key: resolutionId,
						component_name: componentName
					} : {},
					...view === "edit" && card ? {
						active_card_id: card.id,
						front: card.front,
						back: card.back
					} : {}
				}
			});
			setDismissedHintDeck(hintDeck);
			setMenuNonce(menuNonce + 1);
		}
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100vw",
			maxWidth: "100%",
			align: "center",
			...GenUI.logEvent ? { onVisible: logViewStarted } : {}
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			maxWidth: framed ? "100%" : 361,
			align: "center",
			background: framed ? "gray-50" : "transparent",
			radius: framed ? "4xl" : "none",
			padding: framed ? {
				top: 10,
				x: 12,
				bottom: 7
			} : 0
		}, /* @__PURE__ */ __dil.jsx("celebration", { trigger: celebrationTrigger }), /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			maxWidth: 361,
			gap: 3
		}, phase === "error" ? !dismissed && /* @__PURE__ */ __dil.jsx("box", {
			key: "flashcard-error",
			width: "100%",
			maxWidth: 520,
			border: {
				size: 1,
				color: "default"
			},
			radius: "3xl",
			background: {
				light: "gray-0",
				dark: "gray-200"
			},
			padding: 5,
			gap: 4,
			...GenUI.logEvent ? { onVisible: logErrorPresented } : {}
		}, state.error_title ? /* @__PURE__ */ __dil.jsx("col", {
			gap: 1,
			role: "status",
			ariaLive: "polite",
			ariaAtomic: true
		}, /* @__PURE__ */ __dil.jsx("row", {
			gap: 3,
			align: "center"
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: 20,
			minWidth: 20,
			height: 24,
			align: "center",
			justify: "center",
			ariaHidden: true
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "exclamation-mark-circle",
			size: "xl",
			color: "secondary"
		})), /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			weight: "medium",
			color: "primary"
		}, state.error_title)), /* @__PURE__ */ __dil.jsx("box", { padding: { left: 8 } }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.error_label))) : /* @__PURE__ */ __dil.jsx("box", {
			role: "status",
			ariaLive: "polite",
			ariaAtomic: true
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			weight: "medium",
			color: "secondary"
		}, state.error_label)), state.error_operation !== "open" && /* @__PURE__ */ __dil.jsx("row", {
			gap: 2,
			align: "center",
			wrap: "wrap"
		}, state.retry_query && /* @__PURE__ */ __dil.jsx("button", {
			size: "lg",
			onClick: () => GenUI.dispatchAction({
				handler: "client",
				type: "issue_new_turn",
				loadingBehavior: "none",
				payload: {
					query: state.retry_query,
					event_name: "chatgpt_widget_action",
					event_data: {
						widget_affordance: "OPTION",
						widget_action_target: state.error_operation === "update" ? "flashcards_open" : "flashcards_generation",
						widget_action_value: state.error_operation === "update" ? "view" : "retry",
						surface_location: "RESPONSE",
						content_reference_type: "learning_flashcards"
					}
				}
			})
		}, state.retry_label), /* @__PURE__ */ __dil.jsx("button", {
			size: "lg",
			variant: "ghost",
			onClick: () => setDismissed(true)
		}, state.dismiss_label))) : phase === "loading" ? /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			gap: 4,
			padding: { bottom: 3 }
		}, /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: cardHeight,
			align: isMobile ? void 0 : "center",
			justify: isMobile ? void 0 : "center",
			radius: 32,
			border: {
				size: .5,
				color: "strong"
			},
			background: {
				light: "gray-75",
				dark: "gray-200"
			},
			padding: 6,
			label: state.loading_label,
			duration: 3e3,
			reducedMotion: state.reduced_motion
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			weight: "medium",
			color: "secondary",
			textAlign: isMobile ? void 0 : "center"
		}, state.loading_label)), /* @__PURE__ */ __dil.jsx("box", {
			height: 60,
			ariaHidden: true
		})) : /* @__PURE__ */ __dil.jsx("box", {
			key: "flashcard-presentation",
			width: "100%",
			...GenUI.logEvent ? {
				onVisibleWhen: canReportPresentation,
				onVisible: logPresented
			} : {}
		}, phase === "summary" ? /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			gap: 4,
			padding: { bottom: 3 }
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			minHeight: cardHeight,
			align: "center",
			justify: "center",
			padding: 5,
			border: {
				size: .5,
				color: "strong"
			},
			background: {
				light: "gray-0",
				dark: "gray-200"
			},
			radius: 32
		}, /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			align: "center",
			justify: "center",
			gap: 4
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xl",
			weight: "semibold",
			textAlign: "center"
		}, summary), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			justify: "center",
			gap: 6,
			wrap: "wrap"
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1,
			ariaLabel: state.missed_count_labels[progress.missed_indices.length]
		}, /* @__PURE__ */ __dil.jsx("box", {
			size: 22,
			align: "center",
			justify: "center",
			radius: "full",
			background: "#EE7C37"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "x",
			size: "xs",
			color: "white"
		})), /* @__PURE__ */ __dil.jsx("text", { size: "xl" }, progress.missed_indices.length)), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1,
			ariaLabel: state.correct_count_labels[correctCount]
		}, /* @__PURE__ */ __dil.jsx("box", {
			size: 22,
			align: "center",
			justify: "center",
			radius: "full",
			background: "#04B84C"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "check",
			size: "xs",
			color: "white"
		})), /* @__PURE__ */ __dil.jsx("text", { size: "xl" }, correctCount))))), /* @__PURE__ */ __dil.jsx("row", {
			width: "100%",
			minHeight: 60,
			align: "center",
			justify: "between",
			gap: 2,
			padding: "10px"
		}, /* @__PURE__ */ __dil.jsx("button", {
			size: "lg",
			variant: "outline",
			disabled: !canSave,
			onClick: () => restart(false)
		}, state.reset_label), progress.missed_indices.length > 0 ? /* @__PURE__ */ __dil.jsx("button", {
			size: "lg",
			disabled: !canSave,
			onClick: () => restart(true)
		}, state.retry_missed_labels[progress.missed_indices.length]) : /* @__PURE__ */ __dil.jsx("button", {
			size: "lg",
			onClick: () => GenUI.dispatchAction({
				handler: "client",
				type: "issue_new_turn",
				loadingBehavior: "none",
				payload: {
					query: state.more_flashcards_query,
					append_to_current_leaf: true,
					event_name: "chatgpt_widget_action",
					event_data: {
						widget_affordance: "OPTION",
						widget_action_target: "more_flashcards",
						surface_location: "RESPONSE",
						content_reference_type: "learning_flashcards"
					}
				}
			})
		}, state.more_flashcards_label))) : /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			gap: 4,
			padding: { bottom: 3 }
		}, /* @__PURE__ */ __dil.jsx("box", {
			key: "flashcard-card-view",
			width: "100%",
			height: cardHeight,
			...GenUI.logEvent ? {
				onVisibleWhen: canReportCardView,
				onVisibleKey: \`\${currentReviewPass.review_pass_id ?? "legacy"}-\${cardViewIdentity ?? "legacy"}\`,
				onVisible: logCardViewed
			} : {}
		}, /* @__PURE__ */ __dil.jsx("flashcard-flip", {
			activeKey: \`\${cardOrder[currentIndex]}:\${progress.revision}\`,
			isMobile,
			disabled: waiting,
			reducedMotion: state.reduced_motion,
			shuffleKey: progress.shuffle_index,
			flipped,
			dismissDirection: motion?.kind === "dismiss" ? motion.direction : void 0,
			restoreDirection: motion?.kind === "restore" ? motion.direction : void 0,
			onSwipeLeft: canSave ? () => rateCard("left") : void 0,
			onSwipeRight: canSave ? () => rateCard("right") : void 0,
			onSwipeProgress: setSwipeProgress,
			onInteractionChange: setMotionBusy
		}, [
			/* @__PURE__ */ __dil.jsx(FlashcardFace, {
				key: "question",
				face: displayCard?.front ?? card?.front ?? "",
				rawFace: card?.front ?? "",
				height: cardHeight,
				label: state.flip_to_back_label,
				disabled: waiting,
				onClick: waiting || motionBusy ? void 0 : flip,
				hint: showHint ? hintLabels[hintStep] ?? state.tap_to_flip_label : void 0
			}),
			/* @__PURE__ */ __dil.jsx(FlashcardFace, {
				key: "answer",
				face: displayCard?.back ?? card?.back ?? "",
				rawFace: card?.back ?? "",
				back: true,
				height: cardHeight,
				label: state.flip_to_front_label,
				disabled: waiting,
				onClick: waiting || motionBusy ? void 0 : flip
			}),
			...cardOrder.slice(currentIndex + 1, currentIndex + 3).map((index) => /* @__PURE__ */ __dil.jsx(FlashcardFace, {
				key: index,
				face: state.display_cards[index]?.front ?? state.cards[index]?.front ?? "",
				rawFace: state.cards[index]?.front ?? "",
				height: cardHeight
			}))
		])), /* @__PURE__ */ __dil.jsx("row", {
			width: "100%",
			height: 60,
			align: "center",
			justify: "between",
			gap: isMobile ? "6px" : "12px",
			padding: {
				x: "10px",
				y: "10px"
			}
		}, /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0,
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary",
			tabularNums: true
		}, state.mobile_progress_template.replaceAll("__LEARNING_CURRENT__", String(currentIndex + 1)).replaceAll("__LEARNING_TOTAL__", String(cardOrder.length)))), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2,
			ariaDisabled: motionBusy
		}, /* @__PURE__ */ __dil.jsx(FlashcardAnswerButton, {
			isMobile,
			icon: "x",
			feedback: leftFeedback,
			disabled: waiting || !canSave,
			label: progress.missed_indices.includes(cardOrder[currentIndex]) ? state.unmark_missed_label : state.mark_missed_label,
			onClick: motionBusy ? void 0 : () => rateCard("left")
		}), /* @__PURE__ */ __dil.jsx(FlashcardAnswerButton, {
			isMobile,
			icon: "check",
			feedback: rightFeedback,
			disabled: waiting || !canSave,
			label: currentIndex === cardOrder.length - 1 && state.generation_complete ? state.finish_label : state.mark_correct_label,
			onClick: motionBusy ? void 0 : () => rateCard("right")
		})), /* @__PURE__ */ __dil.jsx("row", {
			flex: 1,
			minWidth: 0,
			align: "center",
			justify: "end",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx(SpeechSynthesizer, {
			key: \`\${cardOrder[currentIndex]}:\${progress.revision}:\${flipped}\`,
			text: rawFace,
			source: "flashcards",
			disabled: waiting,
			controls: (speech) => speech.available ? /* @__PURE__ */ __dil.jsx("pressable", {
				size: 36,
				padding: 0,
				align: "center",
				justify: "center",
				radius: "full",
				disabled: waiting,
				ariaLabel: speech.status !== "idle" ? state.stop_audio_label : speech.error ? state.retry_audio_label : state.play_audio_label,
				onClick: () => {
					setDismissedHintDeck(hintDeck);
					if (speech.status === "idle") speech.play();
					else speech.stop();
				}
			}, speech.status === "loading" ? /* @__PURE__ */ __dil.jsx("loading-indicator", {
				size: "xl",
				color: "secondary"
			}) : /* @__PURE__ */ __dil.jsx("icon", {
				name: speech.status === "playing" ? "stop-circle-filled" : "sound-on-read-out-loud-speaker",
				size: "2xl",
				color: speech.status === "playing" ? "primary" : "secondary"
			})) : null
		}), isMobile ? /* @__PURE__ */ __dil.jsx("box", { key: menuNonce }, /* @__PURE__ */ __dil.jsx("select", {
			ariaLabel: state.overflow_label,
			variant: "ghost",
			size: "xl",
			pill: true,
			name: state.overflow_label,
			placeholder: " ",
			value: "",
			options: [
				{
					value: "undo",
					label: state.undo_label,
					disabled: !canSave || motionBusy || progress.answer_history.length === 0
				},
				...showEdit ? [{
					value: "edit",
					label: state.edit_card_label,
					disabled: !canOpenSavedDeck
				}] : [],
				{
					value: "shuffle",
					label: state.shuffle_label,
					disabled: cardOrder.length < 2 || !canSaveNow || motionBusy || pendingFlush
				},
				...showViewAll ? [{
					value: "view_all",
					label: state.view_all_label,
					disabled: !canOpenSavedDeck
				}] : []
			],
			onChange: (value) => {
				if (value === "undo") undo();
				else if (value === "shuffle") shuffle();
				else if (value === "edit") openSavedDeck("edit");
				else if (value === "view_all") openSavedDeck("grid");
			}
		})) : /* @__PURE__ */ __dil.jsx("box", { key: menuNonce }, /* @__PURE__ */ __dil.jsx("popover", null, /* @__PURE__ */ __dil.jsx("popover-trigger", { onClick: () => setDismissedHintDeck(hintDeck) }, /* @__PURE__ */ __dil.jsx("box", {
			size: 36,
			align: "center",
			justify: "center",
			radius: "full",
			ariaLabel: state.overflow_label
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "dots-horizontal",
			size: "xl",
			color: "secondary"
		}))), /* @__PURE__ */ __dil.jsx("popover-content", {
			align: "end",
			side: "bottom",
			sideOffset: 4,
			width: 180
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			padding: 1
		}, progress.answer_history.length > 0 && /* @__PURE__ */ __dil.jsx("pressable", {
			height: 36,
			width: "100%",
			padding: {
				x: 2,
				y: 0
			},
			radius: "md",
			ariaLabel: state.undo_label,
			disabled: !canSave || motionBusy,
			onClick: undo
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2,
			height: "100%"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "undo",
			size: "md",
			color: "secondary"
		}), /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, state.undo_label))), showEdit && /* @__PURE__ */ __dil.jsx("pressable", {
			height: 36,
			width: "100%",
			padding: {
				x: 2,
				y: 0
			},
			radius: "md",
			ariaLabel: state.edit_card_label,
			disabled: !canOpenSavedDeck,
			onClick: () => openSavedDeck("edit")
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2,
			height: "100%"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "pencil",
			size: "md",
			color: "secondary"
		}), /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, state.edit_card_label))), /* @__PURE__ */ __dil.jsx("pressable", {
			height: 36,
			width: "100%",
			padding: {
				x: 2,
				y: 0
			},
			radius: "md",
			ariaLabel: state.shuffle_label,
			disabled: cardOrder.length < 2 || !canSaveNow || motionBusy || pendingFlush,
			onClick: shuffle
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2,
			height: "100%"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "shuffle",
			size: "md",
			color: "secondary"
		}), /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, state.shuffle_label))), showViewAll && /* @__PURE__ */ __dil.jsx("pressable", {
			height: 36,
			width: "100%",
			padding: {
				x: 2,
				y: 0
			},
			radius: "md",
			ariaLabel: state.view_all_label,
			disabled: !canOpenSavedDeck,
			onClick: () => openSavedDeck("grid")
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2,
			height: "100%"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "grid",
			size: "md",
			color: "secondary"
		}), /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, state.view_all_label))))))))))))));
	}

//#endregion
//#region ../shared.dil.ts
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
//#region LearningFlashcards.dil.tsx
	function LearningFlashcards(props) {
		const { resolutionComplete, state } = useResolvedComponentResult("LearningFlashcards", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 320
		});
		return /* @__PURE__ */ __dil.jsx(FlashcardsView, {
			state,
			componentName: "LearningFlashcards",
			resolutionId: props.__resolutionId ?? componentDataKey("LearningFlashcards", props)
		});
	}

//#endregion
return LearningFlashcards;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=learning-flashcards-b0c91c6d5f49.js.map