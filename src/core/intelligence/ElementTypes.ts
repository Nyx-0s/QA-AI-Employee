export interface IntelligentInput {
  index: number;
  tag: string;
  type: string;
  name: string;
  id: string;
  label: string;
  placeholder: string;
  value: string;
  visible: boolean;
  enabled: boolean;
  required: boolean;
  readonly: boolean;
  editable: boolean;
  autocomplete: string;
  minLength?: number;
  maxLength?: number;
  pattern: string;
}

export interface IntelligentButton {
  index: number;
  text: string;
  type: string;
  id: string;
  name: string;
  ariaLabel: string;
  title: string;
  visible: boolean;
  enabled: boolean;

  /**
   * Number of matching buttons represented by this normalized record.
   * Repeated table-row actions such as Edit/Delete are collapsed.
   */
  occurrences: number;
}

export interface IntelligentForm {
  index: number;
  id: string;
  name: string;
  action: string;
  method: string;
  visible: boolean;
  inputCount: number;
  requiredInputCount: number;
  buttonCount: number;
}

export interface IntelligentDropdown {
  index: number;
  tag: string;
  id: string;
  name: string;
  label: string;
  visible: boolean;
  enabled: boolean;
  optionCount: number;
  selectedValue: string;
}

export interface IntelligentTable {
  index: number;
  visible: boolean;
  rowCount: number;
  columnCount: number;
  headers: string[];
  empty: boolean;
}

export interface IntelligentModal {
  index: number;
  role: string;
  title: string;
  visible: boolean;
  buttonCount: number;
  inputCount: number;
}

export interface PageElementProfile {
  generatedAt: string;

  forms: IntelligentForm[];
  inputs: IntelligentInput[];
  buttons: IntelligentButton[];
  dropdowns: IntelligentDropdown[];
  tables: IntelligentTable[];
  modals: IntelligentModal[];

  totals: {
    forms: number;
    inputs: number;
    editableInputs: number;
    requiredInputs: number;
    disabledInputs: number;
    readonlyInputs: number;
    buttons: number;
    enabledButtons: number;
    dropdowns: number;
    emptyDropdowns: number;
    tables: number;
    emptyTables: number;
    modals: number;
  };
}
