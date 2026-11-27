// test-only: a frozen list; push from the panel block throws and is caught
module.exports = Object.freeze({ apps: Object.freeze([{ name: "hand", script: "/bin/sh" }]) });
