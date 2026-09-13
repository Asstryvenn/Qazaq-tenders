"use strict";

const path = require("path");
const sharp = require("sharp");
const { mathjax } = require("mathjax-full/js/mathjax.js");
const { TeX } = require("mathjax-full/js/input/tex.js");
const { SVG } = require("mathjax-full/js/output/svg.js");
const { liteAdaptor } = require("mathjax-full/js/adaptors/liteAdaptor.js");
const { RegisterHTMLHandler } = require("mathjax-full/js/handlers/html.js");
const { AllPackages } = require("mathjax-full/js/input/tex/AllPackages.js");

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const doc = mathjax.document("", {
  InputJax: new TeX({ packages: AllPackages }),
  OutputJax: new SVG({ fontCache: "local" }),
});

async function render(name, latex) {
  const html = adaptor.outerHTML(doc.convert(latex, { display: true }));
  const start = html.indexOf("<svg");
  const end = html.indexOf("</svg>");
  let svg = html.slice(start, end + 6)
    .replace(/<\?xml[^>]*>/g, "")
    .replace(/currentColor/g, "#111827");
  if (!/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(svg)) {
    svg = svg.replace(/<svg /, '<svg xmlns="http://www.w3.org/2000/svg" ');
  }
  await sharp(Buffer.from(svg), { density: 320 })
    .png()
    .toFile(path.join(__dirname, name));
}

Promise.all([
  render("eq_tos.png", String.raw`\mathrm{TOS}=0.35M_{score}+0.30(100-CF_{risk})+0.15L_{score}+0.20(100-R_{legal})`),
  render("eq_profit.png", String.raw`\Pi=S-(C_{purchase}+C_{logistics}+C_{tax}+C_{bank}+C_{oper}+C_{penalty})`),
  render("eq_margin.png", String.raw`M_{rel}=\frac{\Pi}{S}\cdot100\%,\qquad M_{score}=\min\!\left(100,\max\!\left(0,\frac{M_{rel}}{20\%}\cdot100\right)\right)`),
  render("eq_cf.png", String.raw`CF_t=CF_0+\sum_{i=0}^{t}Inflow_i-\sum_{i=0}^{t}Outflow_i,\qquad Gap=\mathbb{1}\{\min_t CF_t<0\}`),
  render("eq_risk.png", String.raw`CF_{risk}=\begin{cases}\operatorname{clamp}\!\left((1-\frac{CF_{min}}{CF_0})\cdot45\right),&CF_{min}\ge0\\\operatorname{clamp}\!\left(50+0.35D+0.15T\right),&CF_{min}<0\end{cases}`),
  render("eq_logistics.png", String.raw`L_{score}=\max\!\left(0,100-\frac{Dist}{Dist_{max}}\cdot100\right),\qquad Pen=\min(S\cdot K_{delay}\cdot d_{late},\,0.10S)`),
]).catch((error) => {
  console.error(error);
  process.exit(1);
});
