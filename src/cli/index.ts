import { Command } from "commander";

import { discoverCommand } from "../commands/discover";
import { inventoryCommand } from "../commands/inventory";

const program = new Command();

program.name("aqw");

program
.command("discover")
.action(discoverCommand);

program
.command("inventory")
.action(inventoryCommand);

program.parse();
