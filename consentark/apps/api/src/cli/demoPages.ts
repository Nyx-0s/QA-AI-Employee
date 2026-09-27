import { createServer, type Server } from "node:http";

/**
 * Demo pages (development aid — not part of the audited execution path):
 * two tiny local pages the `--demo` example tasks target. Safe by
 * construction — nothing here is a real submit endpoint; the form's submit
 * handler only echoes what it received.
 *
 * Page /list — a static price list to extract from (no submission at all).
 * Page /form — an order form with a submit button (gated when the
 *              employee's confirmBeforeSubmit is ON, which the Data Clerk
 *              template ships with).
 */

const LIST_PAGE = `<!doctype html>
<html>
  <head><title>Acme Price List</title></head>
  <body>
    <h1>Acme Supplies — Price List</h1>
    <table id="prices">
      <tr><th>Product</th><th>Price</th></tr>
      <tr><td>Blue Widget</td><td>4.50</td></tr>
      <tr><td>Red Gears</td><td>12.00</td></tr>
      <tr><td>Steel Bolts</td><td>1.20</td></tr>
      <tr><td>Copper Wire</td><td>7.75</td></tr>
    </table>
  </body>
</html>`;

const FORM_PAGE = `<!doctype html>
<html>
  <head><title>Acme Order Form</title></head>
  <body>
    <h1>Acme Supplies — Order Form</h1>
    <form id="order" onsubmit="document.getElementById('confirmation').textContent='ORDER RECEIVED';return false">
      <label>Item <input id="item" name="item" type="text"></label>
      <label>Quantity <input id="quantity" name="quantity" type="number"></label>
      <label>Email <input id="email" name="email" type="email"></label>
      <button id="place-order" type="submit">Place order</button>
    </form>
    <p id="confirmation" aria-live="polite"></p>
  </body>
</html>`;

const ECHO_PAGE = `<!doctype html>
<html>
  <body><h1>Order received</h1><p id="echo">OK</p></body>
</html>`;

function startDemoServer(port = 0): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      const path = (request.url ?? "/").split("?")[0];
      const body = path === "/list" ? LIST_PAGE : path === "/form" ? FORM_PAGE : ECHO_PAGE;
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(body);
    });
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address !== null ? address.port : port;
      resolve({ server, port: actualPort });
    });
  });
}

export const DEMO_PAGES = {
  describe(): string {
    return "http://127.0.0.1:<port>/list (price list) · /form (order form, GET-submit → echo page)";
  },
  listUrl(host = "127.0.0.1"): string {
    return `http://${host}:8787/list`;
  },
  formUrl(host = "127.0.0.1"): string {
    return `http://${host}:8787/form`;
  },
  start: startDemoServer,
};
