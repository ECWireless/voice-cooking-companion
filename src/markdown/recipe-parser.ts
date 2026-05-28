import type { RecipeInput } from "../types.js";

export type ParsedRecipeMarkdown = {
  recipe: RecipeInput;
  warnings: string[];
  errors: string[];
};

type SectionName = "description" | "ingredients" | "instructions" | "tags" | "notes";
type Heading = {
  level: number;
  text: string;
};

const sectionAliases: Record<string, SectionName> = {
  ingredients: "ingredients",
  ingredient: "ingredients",
  instructions: "instructions",
  instruction: "instructions",
  directions: "instructions",
  direction: "instructions",
  steps: "instructions",
  method: "instructions",
  tags: "tags",
  tag: "tags",
  notes: "notes",
  note: "notes"
};

function cleanListItem(line: string): string {
  return line
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*\d+[.)]\s+/, "")
    .trim();
}

function headingInfo(line: string): Heading | null {
  const match = line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/);
  const text = match?.[2]?.trim();
  return match && text ? { level: match[1].length, text } : null;
}

function normalizeHeading(value: string): SectionName | null {
  return sectionAliases[value.toLowerCase().replace(/[^a-z]+/g, " ").trim()] ?? null;
}

function compactLines(lines: string[]): string {
  return lines.map((line) => line.trim()).filter(Boolean).join("\n\n");
}

function cleanList(lines: string[]): string[] {
  return lines.map(cleanListItem).filter(Boolean);
}

export function parseRecipeMarkdown(markdown: string): ParsedRecipeMarkdown {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const warnings: string[] = [];
  const errors: string[] = [];
  let title = "";
  let currentSection: SectionName = "description";
  const sections: Record<SectionName, string[]> = {
    description: [],
    ingredients: [],
    instructions: [],
    tags: [],
    notes: []
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const heading = headingInfo(line);

    if (heading) {
      if (!title && heading.level === 1) {
        title = heading.text;
        currentSection = "description";
        continue;
      }

      const section = normalizeHeading(heading.text);
      currentSection = section ?? "notes";
      if (!section) sections.notes.push(`${"#".repeat(heading.level)} ${heading.text}`);
      continue;
    }

    sections[currentSection].push(line);
  }

  const ingredients = cleanList(sections.ingredients);
  const instructions = cleanList(sections.instructions);
  const tags = cleanList(sections.tags);
  const description = compactLines(sections.description);
  const notes = compactLines(sections.notes);

  if (!title.trim()) errors.push("Add a top-level recipe title, such as # Recipe Title.");
  if (sections.ingredients.length > 0 && ingredients.length === 0) warnings.push("The ingredients section is present but empty.");
  if (sections.instructions.length > 0 && instructions.length === 0) warnings.push("The instructions section is present but empty.");
  if (ingredients.length === 0) errors.push("Add at least one ingredient under ## Ingredients.");
  if (instructions.length === 0) errors.push("Add at least one instruction under ## Instructions.");
  if (!description) warnings.push("Consider adding a short description below the title.");

  for (const ingredient of ingredients) {
    if (ingredient.length > 140) warnings.push(`Ingredient is unusually long: ${ingredient.slice(0, 80)}...`);
    if (/\b(bake|cook|stir|mix|simmer|serve|preheat)\b/i.test(ingredient)) {
      warnings.push(`Ingredient may read like an instruction: ${ingredient.slice(0, 80)}...`);
    }
  }

  for (const instruction of instructions) {
    if (/^\d+\s*(cups?|tbsp|tsp|oz|g|kg|lb|ml|l)\b/i.test(instruction)) {
      warnings.push(`Instruction may read like an ingredient: ${instruction.slice(0, 80)}...`);
    }
  }

  return {
    recipe: {
      title: title.trim(),
      description,
      ingredients,
      instructions,
      tags,
      notes
    },
    warnings,
    errors
  };
}

export function validateRecipeInput(recipe: RecipeInput): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  if (!recipe.title.trim()) errors.push("Recipe title is required.");
  if (!recipe.ingredients.length) errors.push("At least one ingredient is required.");
  if (!recipe.instructions.length) errors.push("At least one instruction is required.");
  if (!recipe.description?.trim()) warnings.push("Consider adding a short description below the title.");
  return { warnings, errors };
}
