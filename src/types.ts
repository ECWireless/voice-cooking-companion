export type VoicePhase = "ingredients" | "steps";
export type PendingPrompt = "ingredients_or_first_step" | "ingredients_or_repeat" | null;

export type RecipeInput = {
  title: string;
  sourceUrl?: string;
  description?: string;
  ingredients: string[];
  instructions: string[];
  tags?: string[];
  notes?: string;
};

export type Recipe = Required<RecipeInput> & {
  id: number;
  createdAt: string;
  updatedAt: string;
};

export type VoiceSessionState = {
  activeRecipeId: number | null;
  phase: VoicePhase;
  index: number;
  pendingPrompt: PendingPrompt;
};

export type PublicSession = {
  id: string;
  activeRecipeId: string | null;
  stepIndex: number;
  phase: VoicePhase;
};

export type QueryIntent =
  | "recipe_lookup"
  | "load_recipe"
  | "next_step"
  | "substitution_question"
  | "repeat_step"
  | "general_help";

export type QueryResult = {
  ok: boolean;
  transcript?: string;
  intent?: QueryIntent;
  answerText: string;
  audio?: {
    mimeType: "audio/mpeg";
    url: string;
  };
  session: PublicSession;
};

export type ParsedRecipeMarkdown = {
  recipe: RecipeInput;
  warnings: string[];
  usedLlm: boolean;
};
