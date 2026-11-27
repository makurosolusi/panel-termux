// test-only: loads the panel list with a computed path
const file = ["apps", "json"].join(".");
module.exports = { apps: [{ name: "hand", script: "/bin/sh" }, ...require(`./${file}`)] };
