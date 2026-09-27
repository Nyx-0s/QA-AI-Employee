import { Command } from "commander";
import { aqwCommand } from "../commands/aqw";
import { authCommand } from "../commands/auth";

import { discoverCommand } from "../commands/discover";
import { inventoryCommand } from "../commands/inventory";
import { knowledgeCommand } from "../commands/knowledge";
import { qaCommand } from "../commands/qa";

const program = new Command();

program.name("aqw");

program
  .command("run")
  .description("Start universal Autonomous QA Workforce")
  .action(aqwCommand);


program
  .command("auth")
  .description(
    "Authenticate against the configured product and save the session"
  )
  .action(authCommand);

program
  .command("discover")
  .action(discoverCommand);

program
  .command("inventory")
  .action(inventoryCommand);

program
  .command("knowledge")
  .description(
    "Generate per-product knowledge base from discovery and inventory"
  )
  .action(knowledgeCommand);

program
  .command("qa")
  .description("Run Autonomous QA Engine")
  .action(qaCommand);

program.parse();
