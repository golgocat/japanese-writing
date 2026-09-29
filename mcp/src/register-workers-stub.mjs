import { register } from "node:module";

register("./workers-stub-hook.mjs", {
  parentURL: import.meta.url,
});
