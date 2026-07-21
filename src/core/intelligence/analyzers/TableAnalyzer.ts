import type { Page } from "playwright";
import type { IntelligentTable } from "../ElementTypes";

export class TableAnalyzer {
  async analyze(page: Page): Promise<IntelligentTable[]> {
    return page.locator(
      'table, [role="table"], [role="grid"]'
    ).evaluateAll(elements =>
      elements.map((element, index) => {
        const htmlElement = element as HTMLElement;
        const style = window.getComputedStyle(htmlElement);

        const visible =
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          htmlElement.getBoundingClientRect().width > 0 &&
          htmlElement.getBoundingClientRect().height > 0;

        const headers = Array.from(
          element.querySelectorAll(
            "thead th, [role='columnheader']"
          )
        )
          .map(header => header.textContent?.trim() || "")
          .filter(Boolean);

        const rows = element.querySelectorAll(
          "tbody tr, [role='row']"
        );

        const firstRow = rows.item(0);

        const columnCount =
          headers.length ||
          firstRow?.querySelectorAll(
            "td, th, [role='gridcell'], [role='cell']"
          ).length ||
          0;

        const rowCount =
          element.tagName.toLowerCase() === "table"
            ? element.querySelectorAll("tbody tr").length
            : Math.max(
                0,
                element.querySelectorAll("[role='row']").length -
                  (headers.length > 0 ? 1 : 0)
              );

        const text = htmlElement.innerText.toLowerCase();

        return {
          index,
          visible,
          rowCount,
          columnCount,
          headers,
          empty:
            rowCount === 0 ||
            text.includes("no data") ||
            text.includes("no records") ||
            text.includes("nothing found")
        };
      })
    );
  }
}
