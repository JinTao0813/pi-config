import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "./src/commands";
import { registerTools } from "./src/tools";

export default function (pi: ExtensionAPI) {
	registerCommands(pi);
	registerTools(pi);
}
