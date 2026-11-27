// Test preload (bunfig.toml [test].preload): the CLI locale is module-wide state that `runCli`, `panel init` and
// tests with `--lang id` change, so every test starts and ends in English regardless of file order.
import { afterEach, beforeEach } from "bun:test";
import { setCliLocale } from "@/cli/cli.locale";

const english = () => setCliLocale({ locale: "en", source: "default" });
beforeEach(english);
afterEach(english);
