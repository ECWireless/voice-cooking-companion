const recipeList = document.querySelector("#recipe-list");
const refreshRecipes = document.querySelector("#refresh-recipes");
const queryForm = document.querySelector("#query-form");
const nextStep = document.querySelector("#next-step");
const tokenInput = document.querySelector("#api-token");
const sessionInput = document.querySelector("#session-id");
const queryInput = document.querySelector("#query-text");
const queryOutput = document.querySelector("#query-output");

const savedToken = localStorage.getItem("voice-cooking-api-token");
if (savedToken) tokenInput.value = savedToken;

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
      const title = document.createElement("h3");
      title.textContent = recipe.title;
      const description = document.createElement("p");
      description.textContent = recipe.description || `${recipe.ingredients.length} ingredients, ${recipe.instructions.length} steps`;
      item.append(title, description);
      return item;
    })
  );
}

async function sendQuery(inputMode) {
  const token = tokenInput.value.trim();
  if (token) localStorage.setItem("voice-cooking-api-token", token);
  else localStorage.removeItem("voice-cooking-api-token");

  const body =
    inputMode === "next_step"
      ? { inputMode, sessionId: sessionInput.value.trim() || undefined }
      : { inputMode, query: queryInput.value, sessionId: sessionInput.value.trim() || undefined };

  const headers = { "Content-Type": "application/json" };
  if (token) headers["x-api-token"] = token;

  const response = await fetch("/query", {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (data.session?.id) sessionInput.value = data.session.id;
  queryOutput.textContent = JSON.stringify(data, null, 2);
}

refreshRecipes.addEventListener("click", loadRecipes);
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
