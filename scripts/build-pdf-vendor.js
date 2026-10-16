"use strict";
const { build } = require("esbuild");
const { join } = require("node:path");
let bundle;
module.exports = function buildPdfVendor() {
  // Rebuild from the locked dependencies: the upstream prebuilt bundle embeds
  // older sanitizer code independently of the versions installed by npm.
  return bundle ||= build({
    absWorkingDir: join(__dirname, ".."),
    entryPoints: ["node_modules/html2pdf.js/src/index.js"],
    outfile: "vendor/html2pdf.bundle.min.js", bundle: true, minify: true,
    platform: "browser", format: "iife", globalName: "quotiniPdf",
    target: ["es2020"], legalComments: "linked", write: false,
    footer: { js: "window.html2pdf = quotiniPdf.default;" },
  }).then(result => Object.fromEntries(result.outputFiles.map(file => [file.path.split("/").pop().replace(".LEGAL.txt", ".LICENSE.txt"), Buffer.from(file.text.replaceAll("html2pdf.bundle.min.js.LEGAL.txt", "html2pdf.bundle.min.js.LICENSE.txt"))])));
};
