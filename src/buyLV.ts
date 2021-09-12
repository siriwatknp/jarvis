import * as functions from "firebase-functions";
import * as Line from "api/Line";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { waitFor } from "utils/waitFor";

puppeteer.use(StealthPlugin());

const NAMES = ["Nice Nano", "Pochette", "Mini Pochette"];
const PRODUCTS = [
  "https://th.louisvuitton.com/tha-th/products/nice-nano-monogram-nvprod2320034v",
  "https://th.louisvuitton.com/tha-th/products/pochette-accessoires-monogram-005656",
  "https://th.louisvuitton.com/tha-th/products/mini-pochette-accessoires-monogram-001025",
  // "https://th.louisvuitton.com/tha-th/products/multiple-wallet-monogram-other-nvprod3130181v", // for in-stock testing
];
const LOGIN_URL = "https://secure.louisvuitton.com/tha-th/mylv/overview";
const CART_URL = "https://secure.louisvuitton.com/tha-th/cart";

export const buyLV = functions
  .region("asia-southeast1")
  .runWith({ memory: "1GB", timeoutSeconds: 180 })
  .https.onRequest(async (request, response) => {
    const browser = await puppeteer.launch({
      // headless: process.env.NODE_ENV !== "development",
      // @ts-expect-error typing issues https://github.com/berstend/puppeteer-extra/issues/428
      headless: false,
      defaultViewport: { width: 1024, height: 600 },
    });

    const initialPage = await browser.newPage();
    await initialPage.goto(LOGIN_URL, {
      waitUntil: ["domcontentloaded", "networkidle0"],
    });

    await initialPage.waitForSelector("input#loginloginForm");
    await initialPage.type(
      "input#loginloginForm",
      functions.config().louisvuitton.username
    );
    await initialPage.type(
      "input#passwordloginForm",
      functions.config().louisvuitton.password
    );
    await initialPage.click("input#loginSubmit_");

    await initialPage.waitForNavigation({
      waitUntil: ["domcontentloaded", "networkidle0"],
    });

    const pages = await Promise.all(PRODUCTS.map(() => browser.newPage()));

    await Promise.all(
      pages.map(async (page, index) => {
        await page.goto(PRODUCTS[index]);
        const PRODUCT_NAME = NAMES[index];
        const result = await waitFor(
          async (retry) => {
            if (retry > 0) {
              await page.reload({
                waitUntil: ["domcontentloaded", "networkidle0"],
              });
            }
            return page.waitForSelector(".lv-stock-indicator.-available", {
              // button.lv-product-purchase-button:not([data-evt-action-ga='qbit_experience_back_in_stock'])
              timeout: 3000,
            });
          },
          { interval: 50, retryCount: 5 }
        );
        const lineReceivers = (
          functions.config().louisvuitton.line_receivers || ""
        ).split(",");
        console.info(
          `send line message to ${
            lineReceivers.length
          } people: ${lineReceivers.join(", ")}`
        );
        if (!result) {
          await Line.sendMessage(
            lineReceivers,
            `😢 ${PRODUCT_NAME} is not available!`
          );
        } else {
          await Line.sendMessage(
            lineReceivers,
            `🛍 ${PRODUCT_NAME} is here, SHOP NOW!`
          );
          // await page.click("button.lv-product-purchase-button");
        }
      })
    );

    await initialPage.waitForTimeout(10000);

    // TODO checkout
    // await page.goto(CART_URL);

    await browser.close();
    response.send("Done.");
  });
