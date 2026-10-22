const navButtons = [...document.querySelectorAll("[data-screen]")];
const linkButtons = [...document.querySelectorAll("[data-screen-link]")];
const screens = [...document.querySelectorAll(".screen")];

function showScreen(name) {
  navButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.screen === name);
  });

  screens.forEach((screen) => {
    screen.classList.toggle("active", screen.id === `screen-${name}`);
  });
}

navButtons.forEach((button) => {
  button.addEventListener("click", () => showScreen(button.dataset.screen));
});

linkButtons.forEach((button) => {
  button.addEventListener("click", () => showScreen(button.dataset.screenLink));
});
