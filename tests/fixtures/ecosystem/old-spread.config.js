// test-only: 0.2.x style, spreads the panel list directly
module.exports = {
  apps: [
    { name: "hand", script: "/bin/sh" },
    ...require("./apps.json"),
  ],
};
