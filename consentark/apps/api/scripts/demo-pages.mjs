#!/usr/bin/env node
/**
 * demo-pages.mjs — start the local demo pages (Acme price list + order
 * form) on DEMO_PAGES_PORT (default 8787, the port the --demo task
 * templates target). Safe by construction: nothing here is a real submit
 * endpoint; the form only echoes what it received. If the port is already
 * serving the demo pages, this script reports that and exits 0 — the
 * sandbox reuses the running server.
 */
import { createServer } from "node:http";
import { get } from "node:http";

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

const port = Number(process.env.DEMO_PAGES_PORT ?? 8787);

function probe() {
  return new Promise((resolve) => {
    get(`http://127.0.0.1:${port}/list`, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve(body.includes("Acme Supplies")));
    }).on("error", () => resolve(false));
  });
}

const already = await probe();
if (already) {
  console.log(`demo pages already serving on http://127.0.0.1:${port} (/list, /form) — reusing`);
  process.exit(0);
}

createServer((request, response) => {
  const path = (request.url ?? "/").split("?")[0];
  const body = path === "/list" ? LIST_PAGE : path === "/form" ? FORM_PAGE : ECHO_PAGE;
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
}).listen(port, "127.0.0.1", () => {
  console.log(`demo pages serving on http://127.0.0.1:${port} (/list, /form)`);
});
