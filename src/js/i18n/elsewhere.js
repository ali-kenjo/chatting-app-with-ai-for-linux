// Texts that appear in the interface but are made by code that can't use the translator: pure
// modules (the face tracker, the robot's start-up), and fixed messages from the helper. The page
// translates them where it shows them (t(message)); this list is how the translation check
// (npm run i18n, test/i18n.test.js) knows they need a translation. The helper's activities,
// voices, character fields and app cards are read straight from server/ by the same check.
export default [
  "Can't reach the Friends helper. Is `npm start` still running?",
  "Private mode is on, so only a local AI can answer. Add a local AI, or turn Private mode off in Settings → AI & privacy.",
  "The camera is blocked for this page. Allow it in the browser's site settings, then switch this off and on.",
  "The camera is busy in another app.",
  "No camera was found.",
  "WebGL isn't available in this browser.",
  "The 3D robot couldn't start.",
  "Chat not found.",
  "That message isn't in this chat anymore.",
  "A chat needs a name.",
  "Backup not found.",
  "Not found",
];
