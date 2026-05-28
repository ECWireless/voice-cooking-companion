const recipeList = document.querySelector("#recipe-list");
const recipeDetail = document.querySelector("#recipe-detail");
const refreshRecipes = document.querySelector("#refresh-recipes");
const importForm = document.querySelector("#import-form");
const confirmUpdate = document.querySelector("#confirm-update");
const recipeFile = document.querySelector("#recipe-file");
const recipeMarkdown = document.querySelector("#recipe-markdown");
const importOutput = document.querySelector("#import-output");
const queryForm = document.querySelector("#query-form");
const nextStep = document.querySelector("#next-step");
const tokenInput = document.querySelector("#api-token");
const sessionInput = document.querySelector("#session-id");
const queryInput = document.querySelector("#query-text");
const queryOutput = document.querySelector("#query-output");

const savedToken = sessionStorage.getItem("voice-cooking-api-token");
if (savedToken) tokenInput.value = savedToken;

let pendingDuplicateMarkdown = "";

function tokenHeaders(extraHeaders = {}) {
  const token = tokenInput.value.trim();
  if (token) sessionStorage.setItem("voice-cooking-api-token", token);
  else sessionStorage.removeItem("voice-cooking-api-token");
  return token ? { ...extraHeaders, "x-api-token": token } : extraHeaders;
}

async function loadRecipes() {
  recipeList.textContent = "Loading recipes...";
  const response = await fetch("/api/recipes");
  const data = await response.json();

  if (!data.recipes?.length) {
    recipeList.textContent = "No recipes saved yet.";
    return;
  }

  recipeList.replaceChildren(
    ...data.recipes.map((recipe) => {
      const item = document.createElement("article");
      item.className = "recipe-item";
      item.tabIndex = 0;
      const title = document.createElement("h3");
      title.textContent = recipe.title;
      const description = document.createElement("p");
      description.textContent = recipe.description || `${recipe.ingredients.length} ingredients, ${recipe.instructions.length} steps`;
      item.append(title, description);
      item.addEventListener("click", () => showRecipe(recipe));
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") showRecipe(recipe);
      });
      return item;
    })
  );
}

function showRecipe(recipe) {
  recipeDetail.hidden = false;
  recipeDetail.replaceChildren();

  const title = document.createElement("h3");
  title.textContent = recipe.title;
  const description = document.createElement("p");
  description.textContent = recipe.description || "No description.";
  const ingredients = document.createElement("ol");
  ingredients.className = "compact-list";
  recipe.ingredients.forEach((ingredient) => {
    const item = document.createElement("li");
    item.textContent = ingredient;
    ingredients.append(item);
  });
  const instructions = document.createElement("ol");
  instructions.className = "compact-list";
  recipe.instructions.forEach((instruction) => {
    const item = document.createElement("li");
    item.textContent = instruction;
    instructions.append(item);
  });

  const ingredientHeading = document.createElement("h4");
  ingredientHeading.textContent = "Ingredients";
  const instructionHeading = document.createElement("h4");
  instructionHeading.textContent = "Instructions";
  recipeDetail.append(title, description, ingredientHeading, ingredients, instructionHeading, instructions);
}

async function sendQuery(inputMode) {
  const body =
    inputMode === "next_step"
      ? { inputMode, sessionId: sessionInput.value.trim() || undefined }
      : { inputMode, query: queryInput.value, sessionId: sessionInput.value.trim() || undefined };

  const response = await fetch("/query", {
    method: "POST",
    headers: tokenHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (data.session?.id) sessionInput.value = data.session.id;
  queryOutput.textContent = JSON.stringify(data, null, 2);
}

async function markdownForImport() {
  if (recipeFile.files?.[0]) return recipeFile.files[0].text();
  return recipeMarkdown.value;
}

async function importMarkdown({ updateExisting = false } = {}) {
  const markdown = updateExisting ? pendingDuplicateMarkdown : await markdownForImport();
  const response = await fetch("/api/recipes/import-markdown", {
    method: "POST",
    headers: tokenHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ markdown, updateExisting })
  });
  const data = await response.json();
  importOutput.textContent = JSON.stringify(data, null, 2);

  if (response.status === 409 && data.duplicate) {
    pendingDuplicateMarkdown = markdown;
    confirmUpdate.hidden = false;
    return;
  }

  confirmUpdate.hidden = true;
  pendingDuplicateMarkdown = "";
  if (data.ok) {
    recipeMarkdown.value = "";
    recipeFile.value = "";
    await loadRecipes();
    showRecipe(data.recipe);
  }
}

refreshRecipes.addEventListener("click", loadRecipes);
importForm.addEventListener("submit", (event) => {
  event.preventDefault();
  importMarkdown().catch((error) => {
    importOutput.textContent = error instanceof Error ? error.message : String(error);
  });
});
confirmUpdate.addEventListener("click", () => {
  importMarkdown({ updateExisting: true }).catch((error) => {
    importOutput.textContent = error instanceof Error ? error.message : String(error);
  });
});
queryForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendQuery("query").catch((error) => {
    queryOutput.textContent = error instanceof Error ? error.message : String(error);
  });
});
nextStep.addEventListener("click", () => {
  sendQuery("next_step").catch((error) => {
    queryOutput.textContent = error instanceof Error ? error.message : String(error);
  });
});

loadRecipes().catch((error) => {
  recipeList.textContent = error instanceof Error ? error.message : String(error);
});
