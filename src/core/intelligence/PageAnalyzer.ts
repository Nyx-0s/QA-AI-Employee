import type { Page } from "playwright";

import { ButtonAnalyzer } from "./analyzers/ButtonAnalyzer";
import { DropdownAnalyzer } from "./analyzers/DropdownAnalyzer";
import { FormAnalyzer } from "./analyzers/FormAnalyzer";
import { InputAnalyzer } from "./analyzers/InputAnalyzer";
import { ModalAnalyzer } from "./analyzers/ModalAnalyzer";
import { TableAnalyzer } from "./analyzers/TableAnalyzer";

import type { PageElementProfile } from "./ElementTypes";

export class PageAnalyzer {
  private readonly formAnalyzer = new FormAnalyzer();
  private readonly inputAnalyzer = new InputAnalyzer();
  private readonly buttonAnalyzer = new ButtonAnalyzer();
  private readonly dropdownAnalyzer = new DropdownAnalyzer();
  private readonly tableAnalyzer = new TableAnalyzer();
  private readonly modalAnalyzer = new ModalAnalyzer();

  async analyze(page: Page): Promise<PageElementProfile> {
    const [
      forms,
      inputs,
      buttons,
      dropdowns,
      tables,
      modals
    ] = await Promise.all([
      this.formAnalyzer.analyze(page),
      this.inputAnalyzer.analyze(page),
      this.buttonAnalyzer.analyze(page),
      this.dropdownAnalyzer.analyze(page),
      this.tableAnalyzer.analyze(page),
      this.modalAnalyzer.analyze(page)
    ]);

    return {
      generatedAt: new Date().toISOString(),

      forms,
      inputs,
      buttons,
      dropdowns,
      tables,
      modals,

      totals: {
        forms: forms.length,
        inputs: inputs.length,
        editableInputs: inputs.filter(
          input => input.editable
        ).length,
        requiredInputs: inputs.filter(
          input => input.required
        ).length,
        disabledInputs: inputs.filter(
          input => !input.enabled
        ).length,
        readonlyInputs: inputs.filter(
          input => input.readonly
        ).length,
        buttons: buttons.reduce(
          (total, button) =>
            total + button.occurrences,
          0
        ),
        enabledButtons: buttons
          .filter(button => button.enabled)
          .reduce(
            (total, button) =>
              total + button.occurrences,
            0
          ),
        dropdowns: dropdowns.length,
        emptyDropdowns: dropdowns.filter(
          dropdown =>
            dropdown.visible &&
            dropdown.optionCount === 0
        ).length,
        tables: tables.length,
        emptyTables: tables.filter(
          table => table.empty
        ).length,
        modals: modals.length
      }
    };
  }
}
