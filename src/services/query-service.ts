import { getRecipe, getVoiceSession, listRecipes, setVoiceSession } from "../storage.js";
import type { PublicSession, QueryIntent, QueryResult, Recipe, VoiceSessionState } from "../types.js";

type TextQueryOptions = {
  transcript: string;
  sessionId: string;
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(value: string): string[] {
  return normalize(value).split(" ").filter(Boolean);
}

function recipeSlug(recipe: Recipe): string {
  return `${normalize(recipe.title).replace(/\s+/g, "-") || "recipe"}-${recipe.id}`;
}

function publicSession(sessionId: string, state: VoiceSessionState): PublicSession {
  const activeRecipe = state.activeRecipeId ? getRecipe(state.activeRecipeId) : null;
  return {
    id: sessionId,
    activeRecipeId: activeRecipe ? recipeSlug(activeRecipe) : state.activeRecipeId ? String(state.activeRecipeId) : null,
    stepIndex: state.index,
    phase: state.phase
  };
}

function finalize(options: {
  sessionId: string;
  transcript: string;
  intent: QueryIntent;
  answerText: string;
  nextState: VoiceSessionState;
}): QueryResult {
  const saved = setVoiceSession(options.sessionId, options.nextState);
  return {
    ok: true,
    transcript: options.transcript,
    intent: options.intent,
    answerText: options.answerText,
    session: publicSession(options.sessionId, saved)
  };
}

function responseWithoutStateChange(options: {
  sessionId: string;
  transcript?: string;
  intent?: QueryIntent;
  answerText: string;
  statusOk?: boolean;
}): QueryResult {
  return {
    ok: options.statusOk ?? false,
    transcript: options.transcript,
    intent: options.intent,
    answerText: options.answerText,
    session: publicSession(options.sessionId, getVoiceSession(options.sessionId))
  };
}

function currentRecipe(state: VoiceSessionState): Recipe | null {
  return state.activeRecipeId ? getRecipe(state.activeRecipeId) : null;
}

function ingredientLine(recipe: Recipe, index: number): string | null {
  const ingredient = recipe.ingredients[index]?.trim();
  return ingredient ? `Ingredient ${index + 1}. ${ingredient}` : null;
}

function stepLine(recipe: Recipe, index: number): string | null {
  const step = recipe.instructions[index]?.trim();
  return step ? `Step ${index + 1}. ${step}` : null;
}

function currentLine(recipe: Recipe, state: VoiceSessionState): string {
  if (state.phase === "ingredients") {
    return ingredientLine(recipe, state.index) ?? `I have ${recipe.title}, but the ingredient list is empty.`;
  }
  return stepLine(recipe, state.index) ?? `I have ${recipe.title}, but the step list is empty.`;
}

function summarizeIngredients(recipe: Recipe): string {
  if (recipe.ingredients.length === 0) return `I have ${recipe.title}, but the ingredient list is empty.`;
  const shown = recipe.ingredients.slice(0, 8).join(", ");
  return recipe.ingredients.length > 8
    ? `Ingredients for ${recipe.title}: ${shown}, and more.`
    : `Ingredients for ${recipe.title}: ${shown}.`;
}

function scoreRecipe(query: string, recipe: Recipe): number {
  const normalizedQuery = normalize(query);
  const title = normalize(recipe.title);
  const haystack = normalize([recipe.title, recipe.description, ...recipe.tags, ...recipe.ingredients].join(" "));

  if (!normalizedQuery) return 0;
  if (normalizedQuery === title) return 100;
  if (normalizedQuery.includes(title) || title.includes(normalizedQuery)) return 85;

  const queryTokens = new Set(tokens(query).filter((token) => !["recipe", "make", "cook", "load", "open", "start", "how", "do", "i"].includes(token)));
  let score = 0;
  for (const token of queryTokens) {
    if (title.includes(token)) score += 8;
    else if (haystack.includes(token)) score += 3;
  }
  return score;
}

function findRecipeFromText(query: string): Recipe | null {
  let best: { recipe: Recipe; score: number } | null = null;
  for (const recipe of listRecipes()) {
    const score = scoreRecipe(query, recipe);
    if (!best || score > best.score) best = { recipe, score };
  }
  return best && best.score >= 8 ? best.recipe : null;
}

function looksLikeIngredientRequest(text: string): boolean {
  return /\bingredients?\b/.test(normalize(text));
}

function looksLikeFirstStepRequest(text: string): boolean {
  const normalized = normalize(text);
  return /\b(first step|step one|start cooking|start|begin)\b/.test(normalized);
}

function looksLikeNextRequest(text: string): boolean {
  return /\b(next|continue|advance|go on|what next|what is next|what s next)\b/.test(normalize(text));
}

function looksLikeRepeatRequest(text: string): boolean {
  return /\b(repeat|again|say that again|what was that)\b/.test(normalize(text));
}

function looksLikeWhereRequest(text: string): boolean {
  return /\b(where am i|where are we|what step|which step|what ingredient|which ingredient)\b/.test(normalize(text));
}

function looksLikeLoadRequest(text: string): boolean {
  return /\b(load|open|start)\b/.test(normalize(text));
}

export function handleNextStep(sessionId: string, transcript = ""): QueryResult {
  const state = getVoiceSession(sessionId);
  const recipe = currentRecipe(state);

  if (!recipe) {
    return responseWithoutStateChange({
      sessionId,
      transcript,
      intent: "next_step",
      answerText: "No recipe is loaded yet. Ask for a recipe first."
    });
  }

  if (state.pendingPrompt === "ingredients_or_first_step") {
    return finalize({
      sessionId,
      transcript,
      intent: "next_step",
      answerText: ingredientLine(recipe, 0) ?? `I have ${recipe.title}, but the ingredient list is empty.`,
      nextState: { ...state, phase: "ingredients", index: 0, pendingPrompt: null }
    });
  }

  if (state.phase === "ingredients") {
    const nextIngredient = ingredientLine(recipe, state.index + 1);
    if (nextIngredient) {
      return finalize({
        sessionId,
        transcript,
        intent: "next_step",
        answerText: nextIngredient,
        nextState: { ...state, index: state.index + 1, pendingPrompt: null }
      });
    }

    return finalize({
      sessionId,
      transcript,
      intent: "next_step",
      answerText: stepLine(recipe, 0) ?? `I have ${recipe.title}, but the step list is empty.`,
      nextState: { ...state, phase: "steps", index: 0, pendingPrompt: null }
    });
  }

  const nextStep = stepLine(recipe, state.index + 1);
  if (!nextStep) {
    return finalize({
      sessionId,
      transcript,
      intent: "next_step",
      answerText: `You're at the end of ${recipe.title}. Want ingredients or a repeat?`,
      nextState: { ...state, pendingPrompt: "ingredients_or_repeat" }
    });
  }

  return finalize({
    sessionId,
    transcript,
    intent: "next_step",
    answerText: nextStep,
    nextState: { ...state, phase: "steps", index: state.index + 1, pendingPrompt: null }
  });
}

export function handleTextQuery(options: TextQueryOptions): QueryResult {
  const transcript = options.transcript.trim();
  const sessionId = options.sessionId;

  if (!transcript) {
    return responseWithoutStateChange({
      sessionId,
      answerText: "Sorry, I didn't catch that."
    });
  }

  const state = getVoiceSession(sessionId);
  const recipe = currentRecipe(state);

  if (recipe && looksLikeNextRequest(transcript)) return handleNextStep(sessionId, transcript);

  if (recipe && looksLikeRepeatRequest(transcript)) {
    return finalize({
      sessionId,
      transcript,
      intent: "repeat_step",
      answerText: currentLine(recipe, state),
      nextState: { ...state, pendingPrompt: null }
    });
  }

  if (recipe && looksLikeWhereRequest(transcript)) {
    const noun = state.phase === "ingredients" ? "ingredient" : "step";
    return finalize({
      sessionId,
      transcript,
      intent: "general_help",
      answerText: `You're on ${noun} ${state.index + 1}.`,
      nextState: state
    });
  }

  if (recipe && looksLikeIngredientRequest(transcript)) {
    return finalize({
      sessionId,
      transcript,
      intent: "general_help",
      answerText: summarizeIngredients(recipe),
      nextState: { ...state, phase: "ingredients", pendingPrompt: null }
    });
  }

  if (recipe && looksLikeFirstStepRequest(transcript)) {
    return finalize({
      sessionId,
      transcript,
      intent: "next_step",
      answerText: stepLine(recipe, 0) ?? `I have ${recipe.title}, but the step list is empty.`,
      nextState: { ...state, phase: "steps", index: 0, pendingPrompt: null }
    });
  }

  const matchedRecipe = findRecipeFromText(transcript);
  if (matchedRecipe) {
    if (looksLikeLoadRequest(transcript) || looksLikeFirstStepRequest(transcript)) {
      return finalize({
        sessionId,
        transcript,
        intent: "load_recipe",
        answerText: stepLine(matchedRecipe, 0) ?? `I found ${matchedRecipe.title}, but the step list is empty.`,
        nextState: { activeRecipeId: matchedRecipe.id, phase: "steps", index: 0, pendingPrompt: null }
      });
    }

    return finalize({
      sessionId,
      transcript,
      intent: "recipe_lookup",
      answerText: `I found ${matchedRecipe.title}. Want ingredients or the first step?`,
      nextState: { activeRecipeId: matchedRecipe.id, phase: "ingredients", index: 0, pendingPrompt: "ingredients_or_first_step" }
    });
  }

  return finalize({
    sessionId,
    transcript,
    intent: "general_help",
    answerText: recipe
      ? "Ask for ingredients, the first step, the next step, or a repeat."
      : "Ask for a saved recipe, then I can walk you through ingredients and steps.",
    nextState: state
  });
}
