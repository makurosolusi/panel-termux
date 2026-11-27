// test-only: two spreads (one in a comment): ...require("./apps.json")
module.exports = {
  apps: [{ name: "hand", script: "/bin/sh" }, ...require("./apps.json")],
};
