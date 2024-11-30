const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const translate = require("google-translate-api-x");
const unfilteredlanguages = require("./languages.json");

const inputFolder = "./en"; // Input folder with HTML files
const outputFolder = "./"; // Output folder for translated files

// Cache to avoid redundant translations
const translationCache = new Map();

// Function to translate text with caching
async function translateText(text, lang) {
  const cacheKey = `${lang}:${text}`;
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  // Avoid translating "evaluating.tools"
  if (text.toLowerCase().includes("evaluating.tools")) {
    const parts = text.split("evaluating.tools");
    const translatedParts = await Promise.all(
      parts.map((part, index) =>
        index === parts.length - 1
          ? Promise.resolve(part) // Keep the domain part unchanged
          : translate(part.trim(), { to: lang, forceTo: true }).then((res) => res.text)
      )
    );
    const result = translatedParts.join("evaluating.tools");
    translationCache.set(cacheKey, result);
    return result;
  }

  // Translate the text and cache it
  try {
    const result = await translate(text.trim(), { to: lang, forceTo: true });
    translationCache.set(cacheKey, result.text);
    return result.text;
  } catch (err) {
    console.error(`Error translating text "${text}" to "${lang}": ${err.message}`);
    return text; // Fallback to original text if translation fails
  }
}

// Function to construct canonical URLs
function constructCanonicalUrl(relativePath, lang) {
  let cleanPath = relativePath.replace(/\\/g, "/").replace(/\/+$/, ""); // Normalize path
  if (cleanPath === "." || cleanPath === "") cleanPath = ""; // Root path
  else if (!cleanPath.endsWith(".html")) cleanPath += "/"; // Add trailing slash if needed
  return `https://evaluating.tools/${lang}/${cleanPath}`;
}

// Function to translate an individual element's text
async function translateElementText(element, lang) {
  if (!element.textContent.trim() || element.textContent.trim().startsWith("©") || element.textContent.toLowerCase().includes("evaluating.tools")) {
    return;
  }

  try {
    if (element.childNodes && element.childNodes.length > 0) {
      for (const child of element.childNodes) {
        if (child.nodeType === 3) { // Node.TEXT_NODE
          const translatedText = await translateText(child.nodeValue.trim(), lang);
          child.nodeValue = translatedText;
        }
      }
    } else {
      const translatedText = await translateText(element.textContent.trim(), lang);
      element.textContent = translatedText;
    }
  } catch (err) {
    console.error(`Error translating element text "${element.textContent}" to "${lang}": ${err.message}`);
  }
}

// Function to handle <a> elements
async function translateAnchorElement(element, lang) {
  const originalHref = element.getAttribute("href");
  if (originalHref && originalHref.includes("/en/")) {
    const updatedHref = originalHref.replace("/en/", `/${lang}/`);
    element.setAttribute("href", updatedHref);
  }

  const text = element.textContent.trim();
  if (text) {
    const translatedText = await translateText(text, lang);
    element.textContent = translatedText;
  }
}

// Translate the content of an HTML file
async function translateHTML(filePath, relativePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const originalDom = new JSDOM(content);
  const document = originalDom.window.document;

  const elementsQuery = "h1, h2, h3, h4, span, a, button, p, label, option, div";

  // Update alternates for all languages
  for (const langObj of unfilteredlanguages.data) {
    const lang = langObj.code;
    const existingAltLink = document.querySelector(`link[rel="alternate"][hreflang="${lang}"]`);
    if (!existingAltLink) {
      const linkTag = document.createElement("link");
      linkTag.setAttribute("rel", "alternate");
      linkTag.setAttribute("hreflang", lang);
      linkTag.setAttribute("href", constructCanonicalUrl(relativePath, lang));
      document.head.appendChild(linkTag);
    }
  }

  // Loop through languages to create new files
  for (const langObj of unfilteredlanguages.data) {
    if (!langObj.createnew) continue;

    const lang = langObj.code;
    try {
      const translatedDom = new JSDOM(content);
      const translatedDocument = translatedDom.window.document;

      const htmlTag = translatedDocument.querySelector("html");
      if (htmlTag) htmlTag.setAttribute("lang", lang);

      let canonicalLink = translatedDocument.querySelector('link[rel="canonical"]');
      if (!canonicalLink) {
        canonicalLink = translatedDocument.createElement("link");
        translatedDocument.head.appendChild(canonicalLink);
      }
      canonicalLink.setAttribute("rel", "canonical");
      canonicalLink.setAttribute("href", constructCanonicalUrl(relativePath, lang));

      // Translate meta tags: og:title, og:description, og:url
      const metaOgTitle = translatedDocument.querySelector('meta[property="og:title"]');
      if (metaOgTitle) {
        const originalTitle = metaOgTitle.getAttribute("content");
        const translatedTitle = await translateText(originalTitle, lang);
        metaOgTitle.setAttribute("content", translatedTitle);
      }

      const metaOgDescription = translatedDocument.querySelector('meta[property="og:description"]');
      if (metaOgDescription) {
        const originalDescription = metaOgDescription.getAttribute("content");
        const translatedDescription = await translateText(originalDescription, lang);
        metaOgDescription.setAttribute("content", translatedDescription);
      }

      const metaOgUrl = translatedDocument.querySelector('meta[property="og:url"]');
      if (metaOgUrl) {
        metaOgUrl.setAttribute("content", constructCanonicalUrl(relativePath, lang));
      }

      // Translate <meta name="title"> and <meta name="description">
      const metaTitle = translatedDocument.querySelector('meta[name="title"]');
      if (metaTitle) {
        const originalTitle = metaTitle.getAttribute("content");
        const translatedTitle = await translateText(originalTitle, lang);
        metaTitle.setAttribute("content", translatedTitle);
      }

      const metaDescription = translatedDocument.querySelector('meta[name="description"]');
      if (metaDescription) {
        const originalDescription = metaDescription.getAttribute("content");
        const translatedDescription = await translateText(originalDescription, lang);
        metaDescription.setAttribute("content", translatedDescription);
      }

      const elements = translatedDocument.querySelectorAll(elementsQuery);
      for (const element of elements) {
        if (element.tagName.toLowerCase() === "a") {
          await translateAnchorElement(element, lang);
        } else {
          await translateElementText(element, lang);
        }
      }

      const langFolder = path.join(outputFolder, lang, relativePath);
      fs.mkdirSync(langFolder, { recursive: true });
      const outputFilePath = path.join(langFolder, path.basename(filePath));
      fs.writeFileSync(outputFilePath, translatedDom.serialize(), "utf8");
      console.log(`Translated: ${filePath} -> ${outputFilePath}`);
    } catch (err) {
      console.error(`Error processing file ${filePath} for language ${lang}: ${err.message}`);
    }
  }
}

// Recursive function to process folders
async function processFolder(folderPath, relativePath = "") {
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(folderPath, entry.name);
    const newRelativePath = path.join(relativePath, entry.name);

    if (entry.isDirectory()) {
      await processFolder(entryPath, newRelativePath);
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      await translateHTML(entryPath, path.dirname(newRelativePath));
    }
  }
}

// Main function
(async function main() {
  if (!fs.existsSync(inputFolder)) {
    console.error("Input folder does not exist.");
    return;
  }
  await processFolder(inputFolder);
  console.log("Translation process completed!");
})();