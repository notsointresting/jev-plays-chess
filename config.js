// Jev Plays Chess — configuration.
//
// Uses your existing Pollinations App Key (pk_...). You must add THIS app's
// URLs to that key's Redirect URIs at https://enter.pollinations.ai/keys :
//   https://notsointresting.github.io/jev-plays-chess/
//   http://localhost:8000/
//
// The pk_ App Key is a PUBLIC client id — safe to ship in the browser.
// Never put an sk_ secret key here.

export const CONFIG = {
  CLIENT_ID: "pk_XHSDoqlTRAGClRhx",

  API_BASE: "https://gen.pollinations.ai",
  AUTHORIZE_URL: "https://enter.pollinations.ai/authorize",
  TOKEN_URL: "https://enter.pollinations.ai/api/oauth/token",
  KEYS_DASHBOARD: "https://enter.pollinations.ai/keys",

  MODEL: "jev",

  // BYOP consent defaults. Chess plays many moves, so a slightly larger budget
  // is friendlier; the user can still edit it on the consent screen.
  BUDGET: 10, // Pollen
  EXPIRY_DAYS: 7,
};
