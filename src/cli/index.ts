import { Command } from "commander";

import { discoverCommand } from "../commands/discover";
import { inventoryCommand } from "../commands/inventory";
import { qaCommand } from "../commands/qa";

const program = new Command();

program.name("aqw");

program
  .command("discover")
  .action(discoverCommand);

program
  .command("inventory")
  .action(inventoryCommand);

program
  .command("qa")
  .description("Run Autonomous QA Engine")
  .action(qaCommand);

program.parse();
